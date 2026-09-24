import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const hx = process.env.HX_APP_ROOT || '/Applications/HBuilderX.app/Contents/HBuilderX';
const { transformSync } = require(`${hx}/plugins/uniapp-cli-vite/node_modules/esbuild`);
const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const modules = new Map();
// Execute the real UTS logic as JS; native compiler/layout verification remains separate.
function load(path, extra = '') {
  const key = path.replace(/\.uts$/, '');
  if (modules.has(key)) return modules.get(key);
  const module = { exports: {} };
  const { code } = transformSync(read(`${key}.uts`) + extra, { loader: 'ts', format: 'cjs' });
  vm.runInNewContext(code, {
    module, exports: module.exports, console,
    UTSJSONObject: class UTSJSONObject {},
    require: name => load(name.replace(/^@\//, '')),
  });
  modules.set(key, module.exports);
  return module.exports;
}
// Schema parsing is unrelated to ACP; keep MCP dependencies out of this harness.
modules.set('utils/mcpAskSchema', {});
modules.set('subpackages/utils/messageInfoClass', {});
const adapter = load('subpackages/utils/interventionAdapter');
const queue = load('subpackages/pages/chat-conversation-component/utils/mcpAskInterventionState');
const streamSource = read('utils/streamRequest.uts');
const streamStart = streamSource.indexOf('function isCompletedPayload(');
const streamEnd = streamSource.indexOf('/**\n * 从原始 SSE 文本块', streamStart);
assert.ok(streamStart >= 0 && streamEnd > streamStart);
const streamModule = { exports: {} };
vm.runInNewContext(transformSync(streamSource.slice(streamStart, streamEnd) +
  '\nexport { shouldSkipSsePayloadEmit, canCoalesceProcessingFrames };',
{ loader: 'ts', format: 'cjs' }).code, {
  module: streamModule, exports: streamModule.exports,
  ...load('utils/readRawField'),
});
const transport = streamModule.exports;

function permission(id, snake = false) {
  return {
    [snake ? 'session_id' : 'sessionId']: `session-${id}`,
    [snake ? 'tool_call' : 'toolCall']: {
      [snake ? 'tool_call_id' : 'toolCallId']: `tool-${id}`,
      title: '写入文件', kind: 'edit', rawInput: { path: 'example.txt' },
    },
    options: [{ [snake ? 'option_id' : 'optionId']: 'once', kind: 'allow_once', name: '允许一次' }],
    _meta: { nuwaclaw_intervention_id: `permission-${id}` },
  };
}

for (const field of ['request_permission_request', 'requestPermissionRequest']) {
  for (const placement of ['data', 'input', 'flat']) {
    const id = `${field}-${placement}`;
    test(`审批从传输到队列保留完整字段: ${id}`, () => {
      const request = permission(id, field.includes('_'));
      const body = placement === 'input'
        ? { result: { input: { [field]: request } } }
        : { [field]: request };
      const frame = placement === 'flat'
        ? { eventType: 'PROCESSING', ...body }
        : { eventType: 'PROCESSING', data: body };
      assert.equal(transport.shouldSkipSsePayloadEmit(frame), false, 'transport dropped approval');
      assert.equal(adapter.isAcpPermissionEvent(frame), true, 'approval not recognized');
      const interaction = adapter.extractAcpPermissionInteraction(frame);
      assert.equal(interaction.request.sessionId, `session-${id}`);
      assert.equal(interaction.request.toolCall.toolCallId, `tool-${id}`);
      assert.equal(interaction.request.options[0]?.optionId, 'once');
      assert.equal(interaction.id, `permission-${id}`);
      const normalized = adapter.normalizeAcpPermissionInteraction(interaction);
      const items = queue.getActiveInterventionQueue([{ id, acpPermissionInteractions: [normalized] }]);
      assert.equal(items.length, 1);
      assert.equal(items[0].kind, 'acp_permission');
      assert.equal(items[0].interaction.request.options[0].optionId, 'once');
    });
  }
}

test('驼峰审批帧不能被同 executeId 的下一条 PROCESSING 覆盖', () => {
  const previous = { eventType: 'PROCESSING', data: {
    executeId: 'same-execution', result: { input: { requestPermissionRequest: permission('coalesce') } },
  } };
  const next = { eventType: 'PROCESSING', data: { executeId: 'same-execution', status: 'EXECUTING' } };
  assert.equal(transport.canCoalesceProcessingFrames(JSON.stringify(previous), JSON.stringify(next)), false);
  assert.equal(transport.canCoalesceProcessingFrames(JSON.stringify(next), JSON.stringify(previous)), false);
  assert.equal(transport.canCoalesceProcessingFrames(JSON.stringify(next), JSON.stringify(next)), true);
});

test('PROCESSING input 直接携带 toolCall/options 的兼容格式', () => {
  const frame = { eventType: 'PROCESSING', data: {
    name: 'Backend.Sandbox.Event.RequestPermission', result: { input: permission('direct') },
  } };
  const interaction = adapter.extractAcpPermissionInteraction(frame);
  assert.equal(interaction.request.sessionId, 'session-direct');
  assert.equal(interaction.request.toolCall.toolCallId, 'tool-direct');
  assert.equal(interaction.request.options[0]?.optionId, 'once');
});

test('非审批帧不产生审批卡，心跳仍被过滤', () => {
  assert.equal(adapter.extractAcpPermissionInteraction({ eventType: 'PROCESSING', data: { text: 'normal' } }), null);
  assert.equal(transport.shouldSkipSsePayloadEmit({ eventType: 'HEART_BEAT' }), true);
});

for (const shape of ['dedicated', 'envelope', 'intervention']) {
  test(`原有事件格式仍能进入队列并在提交后关闭: ${shape}`, () => {
    const request = permission(shape);
    const frame = shape === 'dedicated'
      ? { eventType: 'ACP_REQUEST_PERMISSION', data: { request_permission_request: request } }
      : shape === 'envelope'
        ? { eventType: 'PROCESSING', data: {
          message_type: 'acpRequestPermission', sub_type: 'request_permission',
          data: { request_permission_request: request },
        } }
        : { eventType: 'ACP_REQUEST_PERMISSION', data: {
          _intervention: { id: `permission-${shape}`, acp: { request } },
        } };
    assert.equal(transport.shouldSkipSsePayloadEmit(frame), false);
    const normalized = adapter.normalizeAcpPermissionInteraction(adapter.extractAcpPermissionInteraction(frame));
    const messages = [{ id: shape, acpPermissionInteractions: [normalized] }];
    assert.equal(queue.getActiveInterventionQueue(messages)[0].interaction.request.options[0].optionId, 'once');
    normalized.responseStatus = 'submitted';
    assert.equal(queue.getActiveInterventionQueue(messages).length, 0);
  });
}
