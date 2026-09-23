import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const hx = process.env.HX_APP_ROOT || '/Applications/HBuilderX.app/Contents/HBuilderX';
const { transformSync } = require(`${hx}/plugins/uniapp-cli-vite/node_modules/esbuild`);

// 执行真实详情初始化代码，隔离其后的消息渲染/网络副作用。
const source = fs.readFileSync(new URL('../subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts', import.meta.url), 'utf8');
const start = source.indexOf('  async handleQueryConversation(');
const end = source.indexOf('    // 如果变量参数存在', start);
assert.ok(start >= 0 && end > start);
const compiled = transformSync(`class Service { ${source.slice(start, end)} } } globalThis.Service = Service;`, { loader: 'ts' }).code;
class SelectedComponent {
  constructor(id, type) { this.id = id; this.type = type; }
}
function setup() {
  const sandbox = {
    apiResData: response => response.data,
    readRawField: (value, key) => value[key],
    parseManualComponents: value => value,
    DefaultSelectedEnum: { Yes: 'Yes' },
    AgentSelectedComponentInfo: SelectedComponent,
  };
  vm.runInNewContext(compiled, sandbox);
  const service = new sandbox.Service();
  service.data = {};
  for (const key of ['isLoadingConversation', 'conversationInfo', 'agentInfo', 'agentId', 'conversationId', 'isSuggest', 'manualComponents', 'selectedComponents']) {
    service.data[key] = { value: null };
  }
  service.toAgentJson = value => value;
  service.syncCalledTrialCount = () => {};
  return service;
}
function response(id, defaultId = 1) {
  return { data: { id, agentId: 10, agent: { manualComponents: [
    { id: defaultId, type: 'Plugin', defaultSelected: 'Yes' },
    { id: 2, type: 'Mcp', defaultSelected: 'No' },
  ] } } };
}

test('first details initialize defaults even with conversationId already assigned', async () => {
  const service = setup();
  service.data.conversationId.value = 100;
  await service.handleQueryConversation(response(100));
  assert.equal(service.data.selectedComponents.value[0].id, 1);
});

test('home tools and explicit empty selection survive repeated details, including new tool metadata', async () => {
  const service = setup();
  await service.handleQueryConversation(response(100));
  const homeTools = [new SelectedComponent(2, 'Mcp')];
  service.data.selectedComponents.value = homeTools;
  await service.handleQueryConversation(response(100, 3));
  assert.equal(service.data.selectedComponents.value, homeTools);
  assert.equal(service.data.manualComponents.value[0].id, 3);
  const deselected = [];
  service.data.selectedComponents.value = deselected;
  await service.handleQueryConversation(response(100));
  assert.equal(service.data.selectedComponents.value, deselected);
});

test('switching conversations resets defaults instead of leaking previous tools', async () => {
  const service = setup();
  await service.handleQueryConversation(response(100));
  service.data.selectedComponents.value = [new SelectedComponent(2, 'Mcp')];
  service.data.conversationId.value = 101;
  await service.handleQueryConversation(response(101, 3));
  assert.equal(service.data.selectedComponents.value.length, 1);
  assert.equal(service.data.selectedComponents.value[0].id, 3);
});

test('detail toolbar reads restored parent selection and writes user toggles back', () => {
  const inputSource = fs.readFileSync(new URL('../components/conversation-input/conversation-input.uvue', import.meta.url), 'utf8');
  const begin = inputSource.indexOf('  const handleToggleSelectComponent = ');
  const finish = inputSource.indexOf('  // 监听 props.defaultSelectedComponents', begin);
  assert.ok(begin >= 0 && finish > begin);
  const code = transformSync(inputSource.slice(begin, finish) + '\nglobalThis.toggleTool = handleToggleSelectComponent; globalThis.isSelected = isSharedHomeToolSelected;', { loader: 'ts' }).code;
  const parent = [new SelectedComponent(7934, 'Skill')];
  const sandbox = {
    props: { defaultSelectedComponents: parent },
    selectedComponents: { value: [] }, // 模拟 Android 内嵌页监听尚未同步的旧副本
    usesHomeLayout: { value: true },
    isHomeScene: { value: false },
    AgentSelectedComponentInfo: SelectedComponent,
    emit(event, components) {
      assert.equal(event, 'onSelectedComponentsChange');
      sandbox.props.defaultSelectedComponents = components;
    },
  };
  vm.runInNewContext(code, sandbox);
  assert.equal(sandbox.isSelected({ id: 7934 }), true);
  sandbox.toggleTool(new SelectedComponent(8166, 'Skill'));
  assert.deepEqual(Array.from(sandbox.props.defaultSelectedComponents, x => x.id), [7934, 8166]);
  sandbox.toggleTool(new SelectedComponent(7934, 'Skill'));
  assert.deepEqual(Array.from(sandbox.props.defaultSelectedComponents, x => x.id), [8166]);
});
