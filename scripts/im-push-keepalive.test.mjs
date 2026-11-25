import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const bridge = read('../uni_modules/nuwax-push-keepalive/utssdk/app-android/index.uts');
const client = read('../utils/im/imPushClient.uts');
const appManifest = read('../AndroidManifest.xml');
const runtime = read('../uni_modules/nuwax-push-keepalive/utssdk/app-android/src/com/nuwax/pushkeepalive/PushRuntime.kt');
const service = read('../uni_modules/nuwax-push-keepalive/utssdk/app-android/src/com/nuwax/pushkeepalive/PushKeepAliveService.kt');
const headless = read('../uni_modules/nuwax-push-keepalive/utssdk/app-android/src/com/nuwax/pushkeepalive/ImHeadlessPush.kt');
function evaluate(source, globals) {
  const context = vm.createContext({ console: { log() {}, warn() {} }, ...globals });
  vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*;?$/gm, '').replace(/^export /gm, '')), context);
  return context;
}

test('missing Activity and rejected start remain retryable; only accepted requests return true', () => {
  let activity = null;
  let reject = true;
  let resolved = true;
  const ctx = evaluate(bridge, {
    UTSAndroid: { getUniActivity: () => activity },
    Intent: class { setClassName() {} },
  });
  assert.equal(ctx.ensurePushKeepAlive(), false);
  activity = { startService() { if (reject) throw new Error('background restricted'); return resolved ? {} : null; } };
  assert.equal(ctx.ensurePushKeepAlive(), false);
  reject = false; resolved = false;
  assert.equal(ctx.ensurePushKeepAlive(), false);
  resolved = true;
  assert.equal(ctx.ensurePushKeepAlive(), true);
});

test('DCloud receiver stays enabled and its action bridge is installed before Getui initialization', () => {
  assert.doesNotMatch(appManifest, /DCloudUniPush\.UniPushIntentService/);
  assert.doesNotMatch(appManifest, /NuwaxUniPushIntentService/);
  assert.doesNotMatch(runtime, /setComponentEnabledSetting|registerPushIntentService/);
  assert.match(runtime, /PushActionHolder/);
  assert.match(runtime, /getGTCallBack/);
  assert.match(runtime, /setPushAction\(action\)/);
  assert.match(runtime, /ImHeadlessPush\.receive\(app, raw, null\)/);
  assert.ok(service.indexOf('PushRuntime.installDCloudBridge') < service.indexOf('PushManager.getInstance().initialize'));
  const bind = client.slice(client.indexOf('export function bindImPushClient'), client.indexOf('/**\n * 取 cid 并上报'));
  assert.ok(bind.indexOf('preparePushReceiver()') < bind.indexOf('if (pushBound)'));
  assert.ok(bind.indexOf('preparePushReceiver()') < bind.indexOf('registerPushListener()'));
  const cid = client.slice(client.indexOf('export function syncImPushClientId'), client.indexOf('/**\n * 确保拿到推送 cid'));
  assert.ok(cid.indexOf('preparePushReceiver()') < cid.indexOf('uni.getPushClientId'));
});

test('headless delivery treats an uninitialized uni-app Activity as no foreground Activity', () => {
  assert.match(headless, /runCatching \{ UTSAndroid\.getUniActivity\(\) != null \}\.getOrDefault\(false\)/);
  assert.doesNotMatch(headless, /if \(UTSAndroid\.getUniActivity\(\) != null\)/);
});

test('headless delivery applies the payload unread count through DCloud badge helper', () => {
  assert.match(headless, /private const val BADGE_HELPER = "uts\.sdk\.modules\.DCloudUniPush\.BadgeHelper"/);
  assert.match(headless, /invokeMember\(manager, "createNotification", context, message\)\s+applyBadge\(context, envelope, title\)/);
  assert.match(headless, /field\(envelope, "badge"\)\.toIntOrNull\(\)\?\.takeIf \{ it >= 0 \}/);
  assert.match(headless, /invokeMember\(helper, "sendBadgeNumber", context, count, options\)/);
  assert.match(read('../App.uvue'), /setAppIconBadgeSuppressed\(true\)/);
  assert.match(read('../App.uvue'), /setAppIconBadgeSuppressed\(false\);\s+clearAppIconBadge\(\)/);
});

function clientGate(vendor = 'none') {
  let now = 20_000, attempts = 0, accepted = false;
  const section = client.slice(client.indexOf('let pushKeepAliveRequestedAt'), client.indexOf('/**\n * 绑定推送消息监听'));
  const ctx = evaluate(section, {
    Date: { now: () => now }, Build: { MANUFACTURER: 'fixture', BRAND: 'fixture' },
    classifyOemPushVendor: () => vendor,
    ensurePushKeepAlive: () => { attempts++; return accepted; },
  });
  return { run: () => ctx.ensurePushKeepAliveIfNoVendorChannel(), count: () => attempts,
    accept: () => { accepted = true; }, advance: () => { now += 10_001; } };
}

test('a failed start does not latch success and a later foreground can request recovery', () => {
  const gate = clientGate();
  gate.run(); gate.accept(); gate.run();
  assert.equal(gate.count(), 2);
  gate.run(); assert.equal(gate.count(), 2);
  gate.advance(); gate.run(); assert.equal(gate.count(), 3);
});

test('vendor devices do not start the ordinary keepalive service', () => {
  const gate = clientGate('huawei');
  gate.run(); gate.advance(); gate.run();
  assert.equal(gate.count(), 0);
});

test('native session starts only after identity binding and follows the account preference', () => {
  const storage = new Map([['token', 'fixture-token'], ['origin', 'https://service.example']]);
  const calls = [];
  let origin = 'https://service.example';
  const ctx = evaluate(read('../utils/im/imPushPreference.uts'), {
    ACCESS_TOKEN: 'token', ACCESS_TOKEN_ORIGIN: 'origin', IM_PUSH_PREFERENCES_KEY: 'preferences',
    getApiBaseUrl: () => origin, getImPushEnvironment: () => 'production',
    getImSessionStamp: () => storage.get('token'), UTSJSONObject: class {},
    Build: { MANUFACTURER: 'samsung', BRAND: 'samsung' }, classifyOemPushVendor: () => 'none',
    syncNativePushSession: (...args) => calls.push(args), eventBus: { emit() {} },
    uni: { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value) },
  });
  assert.equal(ctx.readImPushEnabled(), false);
  assert.equal(calls.length, 0);
  assert.equal(ctx.bindImPushPreferenceUser('7'), true);
  assert.deepEqual(calls.at(-1), ['7', 'production', true, true]);
  ctx.writeImPushEnabled(false);
  assert.deepEqual(calls.at(-1), ['7', 'production', false, true]);
  storage.set('token', 'rotated-token');
  assert.equal(ctx.writeImPushEnabled(true), false);
  ctx.bindImPushPreferenceUser('7');
  assert.deepEqual(calls.at(-1), ['7', 'production', false, true]);
  ctx.bindImPushPreferenceUser('8');
  assert.deepEqual(calls.at(-1), ['8', 'production', true, true]);
  const count = calls.length;
  origin = 'https://another-service.example';
  assert.equal(ctx.bindImPushPreferenceUser('9'), false);
  assert.equal(calls.length, count);
  assert.equal(JSON.stringify(calls).includes('token'), false);
});

test('session invalidation closes native delivery before asynchronous logout listeners run', () => {
  const order = [];
  const ctx = evaluate(read('../utils/im/imSessionScope.uts'), {
    ACCESS_TOKEN: 'token', ACCESS_TOKEN_ORIGIN: 'origin', readStorageString: () => 'fixture',
    clearNativePushSession: () => order.push('native cleared'),
    eventBus: { emit: name => order.push(name) },
  });
  const before = ctx.getImSessionStamp();
  ctx.invalidateImSession();
  assert.notEqual(ctx.getImSessionStamp(), before);
  assert.deepEqual(order, ['native cleared', 'im_session_cleared']);
});

test('turning off native delivery persists the gate before stopping the service', () => {
  const order = [];
  const app = { stopService: () => order.push('stop') };
  const ctx = evaluate(bridge, {
    UTSAndroid: { getAppContext: () => app, getUniActivity: () => null },
    Intent: class { setClassName() {} },
    PushDeliverySession: { sync: () => order.push('sync'), clear: () => order.push('clear') },
  });
  ctx.syncNativePushSession('7', 'production', false, true);
  ctx.clearNativePushSession();
  assert.deepEqual(order, ['sync', 'stop', 'clear', 'stop']);
});
