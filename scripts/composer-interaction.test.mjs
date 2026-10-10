import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

function load(file, names, globals = {}) {
  let source = readFileSync(new URL('../utils/' + file + '.uts', import.meta.url), 'utf8');
  source = source.replace(/\/\/ #ifndef H5 \|\| WEB[\s\S]*?\/\/ #endif/g, '');
  source = stripTypeScriptTypes(source).replace(/export /g, '');
  const context = vm.createContext({ ...globals });
  vm.runInContext(source, context);
  return Object.fromEntries(names.map(name => [name, context[name]]));
}
const { detectComposerQuickTrigger: detect } = load('composerQuickTrigger', ['detectComposerQuickTrigger']);
const { computeComposerKeyboardCover: cover } = load('composerKeyboardLayout', ['computeComposerKeyboardCover']);

test('共同触发边界、权限及选区', () => {
  for (const text of ['/', '@', '＠文件', '你好 /技能', '\n@文档', '\t/skill', '/usr']) {
    assert.ok(detect(text, text.length, 0, false, true, true), text);
  }
  for (const text of ['abc/', 'a@b.com', 'https://a', '/usr/bin', '@a/b', '@a b', '/a\n', '']) {
    assert.equal(detect(text, text.length, 0, false, true, true), null, text);
  }
  assert.equal(detect('@', 1, 1, false, true, true), null);
  assert.equal(detect('@', 1, 0, true, true, true), null);
  assert.equal(detect('@', 1, 0, false, true, false), null);
  assert.equal(detect('/', 1, 0, false, false, true), null);
  assert.equal(detect('前文 @文 后文', 5, 0, false, true, true).start, 3);
});

test('键盘补偿不重复叠加 resize/pan', () => {
  assert.equal(cover(300, 800, 500, 0, false), 0);
  assert.equal(cover(300, 800, 800, 0, false), 300);
  assert.equal(cover(300, 800, 600, 0, false), 100);
  assert.equal(cover(300, 800, 800, 300, false), 0);
  assert.equal(cover(300, 800, 800, 0, true), 0);
  assert.equal(cover(0, 800, 800, 0, false), 0);
});

function harness() {
  const handlers = {}, dom = {}, queue = new Map();
  let seq = 0;
  const q = {
    root: { innerHTML: '', addEventListener(k, fn) { dom[k] = fn; }, removeEventListener(k) { delete dom[k]; } },
    on(k, fn) { handlers[k] = fn; }, off(k) { delete handlers[k]; },
    getSelection: () => ({ index: 1, length: 0 }),
    getContents: () => ({ ops: [{ insert: '/\n' }] }), getText: () => '/\n',
  };
  return { q, handlers, dom,
    globals: { setTimeout(fn) { queue.set(++seq, fn); return seq; }, clearTimeout(id) { queue.delete(id); } },
    flush() { for (const [id, fn] of queue) { queue.delete(id); fn(); } },
  };
}

for (const native of [false, true]) test(`${native ? '原生' : 'H5/离线'}观察器来源与组合输入`, () => {
  const h = harness(), reports = [], windowEvents = {};
  const globals = { ...h.globals, document: { querySelector: () => ({ __quill: h.q }) }, window: { innerWidth: 316, innerHeight: 30, addEventListener(k, fn) { windowEvents[k] = fn; }, removeEventListener(k) { delete windowEvents[k]; } }, triggerEvent: (name, data) => { assert.equal(name, 'input'); reports.push(data.delta.__nuwaxComposer); } };
  const api = load('composerEditorObserver', ['observeWebComposer', 'buildComposerEditorObserverScript'], globals);
  let cleanup;
  if (native) vm.runInNewContext(api.buildComposerEditorObserverScript(true), globals);
  else cleanup = api.observeWebComposer(h.q, state => reports.push(state));
  h.handlers['text-change']({}, {}, 'user'); h.handlers['selection-change']();
  h.q.__nuwaxRequestLayout(); h.flush();
  assert.equal(reports.at(-1).reason, 'edit');
  assert.equal(reports.at(-1).text, '/');
  h.dom.paste(); h.handlers['text-change']({}, {}, 'user'); h.flush();
  assert.equal(reports.at(-1).reason, 'paste');
  h.handlers['text-change']({}, {}, 'api'); h.flush();
  assert.equal(reports.at(-1).reason, 'programmatic');
  h.dom.compositionstart(); h.handlers['text-change']({}, {}, 'user'); h.flush();
  assert.equal(reports.at(-1).composing, true);
  h.dom.compositionend(); h.flush();
  assert.equal(reports.at(-1).reason, 'edit');
  assert.equal(reports.at(-1).composing, false);
  h.dom.keydown({ key: 'Escape' }); h.flush();
  assert.equal(reports.at(-1).reason, 'dismiss');
  h.handlers['selection-change'](); h.flush();
  assert.equal(reports.at(-1).reason, 'selection');
  if (native) {
    globals.window.innerWidth = 0;
    globals.window.innerHeight = 0;
    h.dom.compositionend(); h.flush();
    assert.equal(reports.at(-1).viewportCollapsed, true);
    assert.equal(reports.at(-1).reason, 'viewport-check');
    windowEvents.resize(); h.flush();
    assert.equal(reports.at(-1).reason, 'viewport-check');
    globals.window.innerWidth = 316;
    globals.window.innerHeight = 30;
    h.handlers['text-change']({}, {}, 'user'); h.flush();
    assert.equal(reports.at(-1).viewportCollapsed, false);
  }
  if (cleanup) { cleanup(); assert.equal(Object.keys(h.handlers).length, 0); }
});

test('根节点即 ql-container，事务只写一次且光标定位到 chip 后', () => {
  let writes = 0, cursor = -1, actualChange;
  const q = { getContents: () => ({ ops: [{ insert: '前 /查 后\n' }] }), history: { cutoff() {} },
    updateContents(change) { writes++; actualChange = change; }, setSelection(index) { cursor = index; } };
  const globals = { document: { querySelector(selector) { assert.ok(selector.includes('#chat-input-editor.ql-container')); return { __quill: q }; } }, window: {} };
  const api = load('editorAtomicReplacement', ['resolveWebComposerQuill', 'applyEditorAtomicReplacementInWeb', 'buildEditorAtomicReplacementScript'], globals);
  assert.equal(api.resolveWebComposerQuill(), q);
  const payload = { expected: '前 /查 后', cursor: 4, change: { ops: [{ retain: 2 }, { delete: 2 }, { insert: { mention: { id: '1', name: '技能' } } }, { insert: ' ' }] } };
  assert.equal(api.applyEditorAtomicReplacementInWeb(q, payload), true);
  assert.equal(writes, 1); assert.equal(cursor, 4); assert.deepEqual(actualChange, payload.change);
  assert.equal(api.applyEditorAtomicReplacementInWeb(q, { ...payload, expected: '过期文本' }), false);
  assert.equal(writes, 1);
  vm.runInNewContext(api.buildEditorAtomicReplacementScript(payload), { document: { querySelector: () => ({ __quill: q }) }, window: {} });
  assert.equal(writes, 2); assert.equal(cursor, 4);
});

test('组件状态机：关闭不删草稿、重新聚焦不重开、离开选区关闭', () => {
  const source = readFileSync(new URL('../components/conversation-input/conversation-input.uvue', import.meta.url), 'utf8');
  const extract = name => {
    const start = source.indexOf('  function ' + name + '(');
    assert.ok(start >= 0);
    return stripTypeScriptTypes(source.slice(start, source.indexOf('\n  }', start) + 4));
  };
  const opened = [], closed = [], layoutRepairs = [];
  const context = vm.createContext({
    applyEditorLayout() {},
    detectComposerQuickTrigger: detect, syncingEditorContent: false, removingQuickTriggerText: false,
    isHomeScene: { value: true }, props: { enableSkillAt: true, allowExpertSelection: true },
    editorIndexedText: '@文', editorInputCursor: 2, quickTriggerStart: -1, quickTriggerEnd: -1,
    openQuickPopup(mode, keyword) { opened.push([mode, keyword]); }, closeQuickPopup() { closed.push(true); },
    syncIOSHomeEditorViewport() { layoutRepairs.push(true); },
  });
  vm.runInContext(extract('syncQuickPopupFromText') + extract('handleComposerEditorState') + extract('dismissQuickPopup'), context);
  const state = { text: '@文', cursor: 2, length: 0, composing: false, reason: 'edit' };
  context.handleComposerEditorState(state);
  context.handleComposerEditorState({ ...state, cursor: -1, reason: 'layout' });
  assert.equal(closed.length, 0);
  assert.deepEqual(opened, [['expert', '文']]);
  context.dismissQuickPopup();
  assert.equal(context.editorIndexedText, '@文');
  context.handleComposerEditorState({ ...state, reason: 'selection' });
  assert.equal(opened.length, 1);
  context.handleComposerEditorState({ ...state, cursor: 0, reason: 'selection' });
  assert.equal(closed.length, 2);
  for (const reason of ['paste', 'programmatic', 'dismiss']) context.handleComposerEditorState({ ...state, reason });
  assert.equal(opened.length, 1);
  context.isHomeScene.value = false;
  context.handleComposerEditorState(state);
  assert.deepEqual(opened.at(-1), ['file', '文']);
  context.isHomeScene.value = true;
  context.props.allowExpertSelection = false;
  context.handleComposerEditorState(state);
  assert.equal(opened.length, 2);
  context.handleComposerEditorState({ ...state, viewportCollapsed: true, composing: true });
  assert.equal(layoutRepairs.length, 0);
  context.handleComposerEditorState({ ...state, viewportCollapsed: true });
  assert.equal(layoutRepairs.length, 1);
  assert.equal(context.editorIndexedText, '@文');
});

test('两种原生宿主的键盘脚本：iOS 只传高度，三平台组合均可解析', () => {
  const { buildComposerKeyboardResolverScript } = load('composerKeyboardLayout', ['buildComposerKeyboardResolverScript']);
  for (const file of ['components/resident-chat-shell/resident-chat-shell.uvue', 'subpackages/pages/agent-detail/agent-detail.uvue']) {
    const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    const start = source.indexOf('\tfunction buildKeyboardHeightInjectCode(');
    const raw = source.slice(start, source.indexOf('\n\t}', start) + 3);
    for (const platform of ['APP-ANDROID', 'APP-IOS', 'APP-HARMONY']) {
      let active = true; const stack = [];
      const filtered = raw.split('\n').filter(line => {
        const match = line.match(/\/\/ #(ifdef|ifndef) (.*)/);
        if (match) { stack.push(active); const includes = match[2].split(' || ').includes(platform); active = active && (match[1] === 'ifdef' ? includes : !includes); return false; }
        if (line.includes('// #endif')) { active = stack.pop(); return false; }
        return active;
      }).join('\n');
      const context = vm.createContext({ buildComposerKeyboardResolverScript, uni: { getStorageSync: () => 360 }, latestInjectedKeyboardHeight: 0 });
      vm.runInContext(stripTypeScriptTypes(filtered), context);
      for (const height of [0, 320]) for (const dom of [false, true]) for (const emit of [false, true]) {
        const generated = context.buildKeyboardHeightInjectCode(height, 24, dom, emit);
        new vm.Script(generated);
        if (platform === 'APP-IOS') {
          assert.doesNotMatch(generated, /__nuwaxKb(?:ApplyCover|LockDoc|PredictOpen|UnlockPage|ResolveCover|SyncNav)/);
          assert.doesNotMatch(generated, /querySelectorAll\('\.keyboard-cover'\)|window\.scrollTo\(/);
        }
        if (platform === 'APP-HARMONY') assert.ok(generated.includes('window.__nuwaxKbPredictOpen=function(){};'));
      }
    }
  }
});
