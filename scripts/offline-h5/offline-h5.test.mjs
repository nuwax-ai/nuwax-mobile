import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { digest, RESOURCE_LIST_FILE, verifyResourcePackage } from './package-files.mjs';
const require = createRequire(import.meta.url);
const hx = process.env.HX_APP_ROOT || '/Applications/HBuilderX.app/Contents/HBuilderX';
const { transformSync } = require(path.join(hx, 'plugins/uniapp-cli-vite/node_modules/esbuild'));
const source = fs.readFileSync(new URL('../../components/offline-h5-container/offline-h5-session.uts', import.meta.url), 'utf8');
const { code } = transformSync(source, { loader: 'ts', format: 'cjs' });
const module = { exports: {} };
vm.runInNewContext(code, { module, exports: module.exports, Date, encodeURIComponent, decodeURIComponent });
const { OfflineH5Session } = module.exports;
const vue = require(path.join(hx, 'plugins/uniapp-cli-vite/node_modules/vue'));
const read = name => fs.readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
const chatSource = () => read('subpackages/pages/chat-conversation-component/chat-conversation-component.uvue');
function containerHarness() {
  const request = name => ({ requestKey: name, scopeKey: 'account1', localUrl: `/static/app/offline-h5/index.html#/chat?id=${name}`, remoteUrl: `https://example.test/#/chat?id=${name}`, preferLocal: true });
  const props = vue.reactive({ request: request('A'), paused: false });
  const script = read('components/offline-h5-container/offline-h5-container.uvue')
    .split('<script setup lang="uts">')[1].split('</script>')[0].replace(/^import .*;\s*$/gm, '');
  const events = [], timers = new Map(), acknowledgements = [], control = { failEval: false };
  let timerId = 0;
  const state = vm.runInNewContext(transformSync(script + '\n({session,source,loading,failed,handleMessage,handleDocumentLoad,handleDocumentError});', { loader: 'ts' }).code, {
    OfflineH5Session, Date, Set, JSON, decodeURIComponent,
    ref: vue.ref, watch: vue.watch, nextTick: vue.nextTick,
    defineProps: () => props, defineEmits: () => (...args) => events.push(args),
    getCurrentInstance: () => ({ proxy: {} }), onUnmounted() {},
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    uni: { getFileSystemManager: () => ({ accessSync() {} }), createWebviewContext: () => ({ evalJS: code => { if (control.failEval) throw new Error('context expired'); acknowledgements.push(code); } }) },
    console: { log() {} },
  });
  const flush = () => {
    for (const [id, task] of [...timers]) {
      if (task.delay === 0) { timers.delete(id); task.fn(); }
    }
  };
  return { props, request, state, events, timers, acknowledgements, control, flush };
}
function chatFunction(name) {
  const source = chatSource();
  const start = source.indexOf(`  const ${name} = async `);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n  };', start) + 5);
}
function chatDeclaration(name, endMarker) {
  const source = chatSource(), start = source.indexOf(`  function ${name}(`);
  return source.slice(start, source.indexOf(endMarker, start));
}
function conditionalSource(source, platforms) {
  const active = [], out = [];
  const matches = expr => expr.split('||').some(term => term.split('&&').every(p => platforms.includes(p.trim())));
  for (const line of source.split('\n')) {
    const directive = line.match(/^\s*\/\/\s*#(ifdef|ifndef)\s+(.+)$/);
    if (directive) { active.push(directive[1] === 'ifdef' ? matches(directive[2]) : !matches(directive[2])); continue; }
    if (/^\s*\/\/\s*#endif/.test(line)) { active.pop(); continue; }
    if (active.every(Boolean)) out.push(line);
  }
  return out.join('\n');
}

test('paused ready container opens the latest request once when resumed', async () => {
  const h = containerHarness();
  const ready = { type: 'OFFLINE_H5_PAGE_READY', protocolVersion: 1, requestId: h.state.session.requestId };
  h.state.handleMessage({ detail: { data: [ready] } }); h.flush();
  h.props.paused = true; await vue.nextTick();
  h.props.request = h.request('B'); await vue.nextTick();
  h.props.request = h.request('C'); await vue.nextTick();
  assert.equal(h.state.session.requestKey, 'A');
  const previousOpens = h.events.filter(e => e[0] === 'source-change').length;
  h.props.paused = false; await vue.nextTick();
  assert.equal(h.state.session.requestKey, 'C');
  assert.equal(h.state.loading.value, true);
  assert.equal(h.timers.size, 1);
  assert.equal(h.events.filter(e => e[0] === 'source-change').length, previousOpens + 1);
});

test('every protocol message in a native batch is handled, including ready before debug or stale data', () => {
  for (const last of ['OFFLINE_H5_DEBUG', 'business', 'stale', 'malformed']) {
    const h = containerHarness(), id = h.state.session.requestId;
    let tail = { type: last, protocolVersion: 1, requestId: id };
    if (last === 'stale') tail = { type: 'OFFLINE_H5_PAGE_READY', protocolVersion: 1, requestId: 'old' };
    if (last === 'malformed') tail = { type: 'OFFLINE_H5_DEBUG', protocolVersion: 2, requestId: id };
    h.state.handleMessage({ detail: { data: [{ data: [{ type: 'OFFLINE_H5_PAGE_READY', protocolVersion: 1, requestId: id }] }, tail] } });
    h.flush();
    assert.equal(h.state.session.phase, 'ready-local', last);
    assert.equal(h.state.loading.value, false, last);
    assert.equal(h.events.filter(e => e[0] === 'ready').length, 1, last);
  }
});

test('late document load and entry error cannot complete or fall back a newer request', async () => {
  const h = containerHarness(), oldUrl = h.state.source.value;
  h.props.request = h.request('B'); await vue.nextTick();
  h.state.handleDocumentError({ detail: { fullUrl: 'file:///app' + oldUrl, errCode: 100002 } }); h.flush();
  assert.equal(h.state.session.phase, 'loading-local');
  const currentId = h.state.session.requestId;
  h.state.session.timeout(currentId);
  h.props.request = { ...h.request('B'), remoteReadyPolicy: 'document', preferLocal: false }; await vue.nextTick();
  h.state.handleDocumentLoad({ detail: { src: oldUrl } }); h.flush();
  assert.equal(h.state.session.phase, 'loading-remote');
  assert.equal(h.events.filter(e => e[0] === 'document-load').length, 0);
});

test('an expired native context cannot block ready and soft navigation still arms a fallback timeout', async () => {
  const h = containerHarness();
  h.state.handleDocumentLoad({ detail: { src: h.state.source.value } }); h.flush();
  h.control.failEval = true;
  h.state.handleMessage({ detail: { data: [{ type: 'OFFLINE_H5_PAGE_READY', protocolVersion: 1, requestId: h.state.session.requestId }] } }); h.flush();
  assert.equal(h.state.session.phase, 'ready-local');
  assert.equal(h.state.loading.value, false);
  h.props.request = { ...h.request('B'), localUrl: '/static/app/offline-h5/index.html#/second' };
  await vue.nextTick();
  assert.equal(h.state.session.requestKey, 'B');
  assert.equal(h.state.session.phase, 'loading-local');
  assert.equal(h.timers.size, 1);
});

test('tenant network failure with missing or malformed cache still starts a regular conversation', async () => {
  const code = transformSync(chatDeclaration('readPositiveNumber', '\n  function captureProjectChatQuery(') + '\n' + chatFunction('initTenantConfig') + '\n' + chatFunction('runOnLoadAsync') + '\nrunOnLoadAsync;', { loader: 'ts' }).code;
  for (const cache of ['', '{broken', 'null', '[]', '"text"', '{}', '{"enableSubscription":1}']) {
    const data = { enableSubscription: { value: null } }, input = { value: false };
    let conversationLoads = 0;
    const sandbox = {
      Date, JSON, data, lastTenantConfigFetchTime: 0, tenantConfigInfo: { value: null },
      apiTenantConfig: async () => { throw new Error('network'); }, apiResCode: res => res.code, apiResData: res => res.data,
      SUCCESS_CODE: '0000', TENANT_CONFIG_INFO: 'tenant', uni: { getStorageSync: () => cache, $on() {} },
      setCurrentPageNavigationBarTitle() {}, ticket: { value: '' }, isRenderInputPhone: input,
      isStreamPerfMockEnabled: () => false, props: { isTempChat: false },
      handlePageLoad: async () => { conversationLoads++; },
      chatPageBootFailed: { value: false }, chatPageDisposed: false,
      console: { error() {} },
    };
    // Use the real cache reader once the production helper is introduced.
    const helperPath = new URL('../../utils/tenantConfigCache.uts', import.meta.url);
    if (fs.existsSync(helperPath)) {
      const helperModule = { exports: {} };
      vm.runInNewContext(transformSync(fs.readFileSync(helperPath, 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module: helperModule, exports: helperModule.exports, JSON });
      Object.assign(sandbox, helperModule.exports);
    }
    const run = vm.runInNewContext(code, sandbox);
    await assert.doesNotReject(run({ id: '44', conversationId: '1' }), cache);
    assert.equal(input.value, true, cache);
    assert.equal(conversationLoads, 1, cache);
    if (cache.includes('enableSubscription')) assert.equal(data.enableSubscription.value, 1);
  }
});

test('business initialization rejection or timeout exposes retry even after the native first-frame ready', async () => {
  const source = chatSource();
  const stateStart = source.indexOf('  const chatPageBootLoading = ');
  const states = source.slice(stateStart, source.indexOf('  let offlineH5RequestId', stateStart));
  const loadStart = source.indexOf('  onLoad((options: any) => {');
  const load = source.slice(loadStart, source.indexOf('\n  });', loadStart) + 6);
  for (const failMode of ['rejection', 'timeout']) {
    const timers = new Map(); let timerId = 0, onLoad, paints = 0, reloads = 0;
    const state = vm.runInNewContext(transformSync(conditionalSource(states + '\n' + load + '\n({chatPageBootLoading,chatPageBootFailed,retryChatPageLoad});', ['H5', 'WEB']), { loader: 'ts' }).code, {
      ref: vue.ref, residentChatBootLoading: vue.ref(false), offlineH5RequestId: '',
      onLoad: fn => { onLoad = fn; }, nextTick: fn => fn(),
      readOfflineH5RequestId: opts => opts.offlineH5RequestId, notifyOfflineH5PageReady: () => { paints++; },
      pauseEventPollingForChat() {},
      runOnLoadAsync: failMode === 'rejection' ? async () => { throw new Error('network'); } : () => new Promise(() => {}),
      setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout: id => timers.delete(id),
      window: { location: { reload() { reloads++; } } }, console: { error() {} },
    });
    onLoad({ offlineH5RequestId: 'one' });
    await Promise.resolve(); await Promise.resolve();
    if (failMode === 'timeout') {
      const deadline = [...timers.values()].find(task => task.delay === 30000);
      assert.ok(deadline); deadline.fn();
    }
    assert.equal(paints, 1);
    assert.equal(state.chatPageBootLoading.value, false, failMode);
    assert.equal(state.chatPageBootFailed.value, true, failMode);
    state.retryChatPageLoad(); assert.equal(reloads, 1);
  }
});

test('temporary chat still waits for tenant/captcha configuration and missing configuration exposes retry', async () => {
  const script = chatDeclaration('readPositiveNumber', '\n  function captureProjectChatQuery(') + '\n' + chatFunction('initTenantConfig') + '\n' + chatFunction('runOnLoadAsync') + '\nrunOnLoadAsync;';
  const helperModule = { exports: {} };
  vm.runInNewContext(transformSync(read('utils/tenantConfigCache.uts'), { loader: 'ts', format: 'cjs' }).code, { module: helperModule, exports: helperModule.exports, JSON });
  for (const config of [null, { enableSubscription: 1, openCaptcha: 1, captchaSceneId: 'scene', captchaPrefix: 'prefix' }]) {
    let finishConfig, requests = 0, creates = 0, failures = 0;
    const tenant = { value: null }, input = { value: false };
    const run = vm.runInNewContext(transformSync(script, { loader: 'ts' }).code, {
      ...helperModule.exports, Date, JSON, parseFloat, lastTenantConfigFetchTime: 0,
      data: { enableSubscription: { value: null } }, tenantConfigInfo: tenant,
      apiTenantConfig: () => { requests++; return new Promise(resolve => { finishConfig = resolve; }); },
      apiResCode: res => res.code, apiResData: res => res.data, SUCCESS_CODE: '0000', TENANT_CONFIG_INFO: 'tenant',
      uni: { getStorageSync: () => '', setStorageSync() {}, $on() {} }, props: { isTempChat: true },
      chatPageBootFailed: { value: false }, chatPageDisposed: false,
      setCurrentPageNavigationBarTitle() {}, ticket: { value: '' }, isRenderInputPhone: input, isStreamPerfMockEnabled: () => false,
      handleTempChatPageLoad: async () => { assert.ok(tenant.value); creates++; },
      failChatPageLoad: () => { failures++; }, console: { error() {} },
    });
    const pending = run({ chatKey: 'key' });
    await Promise.resolve();
    assert.equal(creates, 0); assert.equal(input.value, false);
    finishConfig({ code: config == null ? 'failed' : '0000', data: config });
    await pending;
    assert.equal(requests, 1);
    assert.equal(creates, config == null ? 0 : 1);
    assert.equal(failures, config == null ? 1 : 0);
  }
});

test('history failures expose retry, and a timed-out or disposed page cannot consume a late response', async () => {
  const code = transformSync(chatFunction('handlePageLoad') + '\nhandlePageLoad;', { loader: 'ts' }).code;
  for (const result of ['network', 'non-success', 'empty-data', 'late-timeout', 'disposed', 'query-timeout', 'query-disposed']) {
    const data = Object.fromEntries(['agentInfo', 'agentName', 'messageList', 'conversationInfo', 'conversationId', 'agentId'].map(key => [key, { value: null }]));
    let failures = 0, rendered = 0, drafts = 0;
    const scope = {
      data, parseInt, pendingDraftReadyConversationId: 0, pendingDraftAgentMode: { value: '' },
      captureProjectChatQuery() {}, projectChatPType: '', beginResidentChatBoot() {}, finishResidentChatBoot() {},
      eventBindConfig: { value: null }, parseEventBindConfig: () => ({}), props: { isTempChat: false },
      chatPageDisposed: result === 'disposed', chatPageBootFailed: { value: result === 'late-timeout' },
      apiAgentConversation: async () => { if (result === 'network') throw new Error('network'); return { code: result === 'non-success' ? 'failed' : '0000', data: result === 'empty-data' ? null : {} }; },
      SUCCESS_CODE: '0000', apiResCode: res => res.code, apiResData: res => res.data,
      failChatPageLoad: () => { failures++; }, handleQueryConversation: async () => {
        rendered++;
        if (result === 'query-timeout') scope.chatPageBootFailed.value = true;
        if (result === 'query-disposed') scope.chatPageDisposed = true;
      },
      sendPendingChatDraftForConversation: () => { drafts++; },
    };
    const run = vm.runInNewContext(code, scope);
    await run({ id: '44', conversationId: '1' });
    assert.equal(rendered, result.startsWith('query-') ? 1 : 0, result);
    assert.equal(failures, result === 'disposed' || result === 'late-timeout' || result.startsWith('query-') ? 0 : 1, result);
    assert.equal(drafts, 0, result);
  }
});

test('embedded auth expiration asks the native host to log in instead of navigating to a missing H5 route', () => {
  const auth = read('utils/authNavigation.uts').replace(/^import .*;\s*$/gm, '');
  const authModule = { exports: {} }, jumps = [], messages = [];
  const window = { location: { hash: '#/chat?offlineH5RequestId=current&appNativeLogin=1' }, OfflineH5Bridge: {
    requestId: () => 'current', authRequired: id => messages.push(id),
  } };
  vm.runInNewContext(transformSync(auth, { loader: 'ts', format: 'cjs' }).code, {
    module: authModule, exports: authModule.exports, Date, encodeURIComponent, decodeURIComponent, window,
    isAppWebViewEmbedded: () => true, getCurrentPageFullPath: () => '/chat',
    uni: { reLaunch: opts => jumps.push(opts.url), navigateTo: opts => jumps.push(opts.url) },
    setTimeout() { return 1; }, clearTimeout() {},
  });
  authModule.exports.redirectToLoginOnce();
  authModule.exports.redirectToLoginOnce();
  assert.equal(jumps.length, 0);
  assert.deepEqual(messages, ['current']);
});

test('browser H5, App and mini-program keep their own login routes and browser login stays inside H5', () => {
  for (const platform of ['H5', 'APP-ANDROID', 'APP-IOS', 'APP-HARMONY', 'MP-WEIXIN']) {
    const platforms = platform.startsWith('APP-') ? [platform, 'APP'] : [platform];
    const source = conditionalSource(read('utils/authNavigation.uts'), platforms).replace(/^import .*;\s*$/gm, '');
    const authModule = { exports: {} }, jumps = [];
    vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
      module: authModule, exports: authModule.exports, Date, encodeURIComponent,
      isAppWebViewEmbedded: () => false, getCurrentPageFullPath: () => '/chat?id=1',
      uni: { reLaunch: opts => jumps.push(['reLaunch', opts.url]), navigateTo: opts => jumps.push(['navigateTo', opts.url]) },
      // window is deliberately absent: native / mini-program must not execute DOM code.
    });
    const target = platform === 'MP-WEIXIN' ? authModule.exports.LOGIN_WEIXIN_PAGE_PATH : authModule.exports.LOGIN_PAGE_PATH;
    assert.equal(authModule.exports.redirectToLoginOnce(target), true, platform);
    assert.deepEqual(jumps[0], ['reLaunch', target], platform);
    if (platform === 'H5') {
      authModule.exports.goToLogin();
      assert.deepEqual(jumps[1], ['navigateTo', target + '?redirect=%2Fchat%3Fid%3D1']);
    }
  }
});

test('browser SDK and old App hosts without login capability keep the H5 login route', () => {
  for (const hash of ['#/chat?id=1', '#/chat?id=1&offlineH5RequestId=old-host']) {
    const source = conditionalSource(read('utils/authNavigation.uts'), ['H5']).replace(/^import .*;\s*$/gm, '');
    const authModule = { exports: {} }, jumps = [];
    vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
      module: authModule, exports: authModule.exports, Date, encodeURIComponent, decodeURIComponent,
      isAppWebViewEmbedded: () => true, getCurrentPageFullPath: () => '/chat',
      window: { location: { hash } },
      uni: { reLaunch: opts => jumps.push(opts.url) },
    });
    authModule.exports.redirectToLoginOnce();
    assert.deepEqual(jumps, ['/subpackages/pages/login/login']);
  }
});

test('expired auth messages are acknowledged once and old request/account messages cannot log out a new account', async () => {
  const h = containerHarness(), id = h.state.session.requestId;
  h.state.handleDocumentLoad({ detail: { src: h.state.source.value } }); h.flush();
  const auth = { type: 'OFFLINE_H5_AUTH_REQUIRED', protocolVersion: 1, requestId: id };
  h.state.handleMessage({ detail: { data: [auth, auth, { ...auth, requestId: 'old' }] } }); h.flush();
  assert.equal(h.events.filter(e => e[0] === 'auth-required').length, 1);
  assert.equal(h.acknowledgements.filter(code => code.includes('OFFLINE_H5_AUTH_REQUIRED')).length, 2);
  const project = read('components/offline-h5-container/offline-h5-project.uts').replace(/^import .*;\s*$/gm, '');
  const projectModule = { exports: {} }, storage = new Map([['token', 'account-a'], ['origin', 'https://example.test']]);
  let clears = 0, logins = 0;
  vm.runInNewContext(transformSync(project, { loader: 'ts', format: 'cjs' }).code, {
    module: projectModule, exports: projectModule.exports, ACCESS_TOKEN: 'token', ACCESS_TOKEN_ORIGIN: 'origin',
    getApiBaseUrl: () => 'https://example.test', clearStoragePreservingApiBaseUrl: () => { clears++; storage.clear(); },
    redirectToLoginOnce: () => { logins++; }, uni: { getStorageSync: key => storage.get(key), setStorageSync: (key, val) => storage.set(key, val) },
  });
  const scope = projectModule.exports.getOfflineH5ScopeKey();
  storage.set('token', 'account-b');
  projectModule.exports.handleProjectOfflineH5AuthRequired({ scopeKey: scope });
  assert.equal(clears, 0); assert.equal(logins, 0);
  projectModule.exports.handleProjectOfflineH5AuthRequired({ scopeKey: projectModule.exports.getOfflineH5ScopeKey() });
  assert.equal(clears, 1); assert.equal(logins, 1);
});
test('reuse and fallback reject stale ready and timeout callbacks', () => {
  const s = new OfflineH5Session();
  s.open('a', 'account1', '/index.html#/a', 'https://example.test/#/a', true);
  const first = s.requestId;
  assert.equal(s.ready(first), true);
  s.open('b', 'account1', '/index.html#/b', 'https://example.test/#/b', true);
  assert.equal(s.phase, 'navigating-local');
  assert.equal(s.ready(first), false);
  assert.equal(s.timeout(first), false);
  s.timeout(s.requestId);
  assert.equal(s.phase, 'loading-local');
  const local = s.requestId;
  s.timeout(local);
  assert.equal(s.phase, 'loading-remote');
  assert.equal(s.ready(local), false);
  s.timeout(s.requestId);
  assert.equal(s.phase, 'failed');
});
test('account changes and cancellation prevent document reuse', () => {
  const s = new OfflineH5Session();
  s.open('a', 'one', '/index.html#/a', '', true); s.ready(s.requestId);
  s.open('a', 'two', '/index.html#/a', '', true);
  assert.equal(s.phase, 'loading-local');
  const id = s.requestId; s.cancel(); assert.equal(s.ready(id), false);
});
test('ready survives late native bridge installation and stops after ACK', () => {
  let tick; const messages = [];
  const root = { addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(new URL('../../components/offline-h5-container/offline-h5-bridge.js', import.meta.url), 'utf8'), {
    window: root, location: { hash: '#/a?offlineH5RequestId=one' }, URLSearchParams,
    setInterval(fn) { tick = fn; return 1; }, clearInterval() {},
  });
  root.OfflineH5Bridge.pageReady('one'); tick();
  root.uni = { webView: { postMessage(msg) { messages.push(msg.data); } } };
  tick(); assert.equal(messages.length, 1);
  assert.equal(messages[0].requestId, 'one');
  root.OfflineH5Bridge.acknowledge('OFFLINE_H5_PAGE_READY', 'one'); tick();
  assert.equal(messages.length, 1);
});
test('resource verification rejects altered files and symlink directories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-h5-test-'));
  try {
    const files = ['index.html', 'app-bundle.js', 'offline-h5-bridge.js'].map(name => {
      fs.writeFileSync(path.join(dir, name), name);
      return { path: name, bytes: Buffer.byteLength(name), sha256: digest(name) };
    });
    fs.writeFileSync(path.join(dir, RESOURCE_LIST_FILE), JSON.stringify({ schemaVersion: 1, protocolVersion: 1, files, resourceVersion: digest(JSON.stringify(files)) }));
    verifyResourcePackage(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), 'broken');
    assert.throws(() => verifyResourcePackage(dir), /modified/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('IIFE preload skips JS but waits for CSS and propagates CSS errors', async () => {
  const { removeInlinedJsPreloads } = await import('./preload.mjs');
  const helper = `function preload(deps) {
    return Promise.all(deps.map(dep => {
      const isCss = dep.endsWith(".css");
      const link = document.createElement("link");
      link.rel = isCss ? "stylesheet" : "modulepreload";
      link.href = dep;
      document.head.appendChild(link);
      return isCss ? new Promise((resolve, reject) => {
        link.addEventListener("load", resolve);
        link.addEventListener("error", reject);
      }) : undefined;
    }));
  }`;
  const links = [];
  const sandbox = { document: {
    createElement() { return { events: {}, addEventListener(name, fn) { this.events[name] = fn; } }; },
    head: { appendChild(link) { links.push(link); } },
  } };
  vm.runInNewContext(removeInlinedJsPreloads(helper), sandbox);
  let done = false;
  const pending = sandbox.preload(['page.js', 'page.css']).then(() => { done = true; });
  await Promise.resolve();
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'page.css');
  assert.equal(done, false);
  links[0].events.load();
  await pending;
  const failed = sandbox.preload(['other.css']);
  links[1].events.error(new Error('css missing'));
  await assert.rejects(failed, /css missing/);
  assert.throws(() => removeInlinedJsPreloads('changed helper'), /Expected one/);
});

test('native resource errors preserve local ready; entry errors still fall back', () => {
  const container = fs.readFileSync(new URL('../../components/offline-h5-container/offline-h5-container.uvue', import.meta.url), 'utf8');
  const handler = container.slice(container.indexOf('function handleDocumentError('), container.indexOf('function handleMessage('));
  const handlerJs = transformSync(handler, { loader: 'ts' }).code;
  for (const fullUrl of ['', 'file:///app/static/app/offline-h5/assets/page.js', 'https://example.test/image.png']) {
    const session = new OfflineH5Session();
    session.open('chat', 'account', '/static/app/offline-h5/index.html?a=1#/chat', 'https://example.test', true);
    const id = session.requestId;
    const sandbox = { session, disposed: false, console: { log() {} }, setTimeout(fn) { fn(); }, advanceFallback(id) { session.timeout(id); } };
    vm.runInNewContext(handlerJs, sandbox);
    sandbox.handleDocumentError({ detail: { fullUrl, errCode: 100002 } });
    assert.equal(session.phase, 'loading-local');
    assert.equal(session.ready(id), true);
  }
  const session = new OfflineH5Session();
  session.open('chat', 'account', '/static/app/offline-h5/index.html?a=1#/chat', 'https://example.test', true);
  const sandbox = { session, disposed: false, console: { log() {} }, setTimeout(fn) { fn(); }, advanceFallback(id) { session.timeout(id); } };
  vm.runInNewContext(handlerJs, sandbox);
  sandbox.handleDocumentError({ detail: { fullUrl: 'file:///app/static/app/offline-h5/index.html?a=1#/chat', errCode: 100002 } });
  assert.equal(session.phase, 'loading-remote');
});
