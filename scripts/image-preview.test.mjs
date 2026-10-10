import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../utils/appWebViewImagePreview.uts', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/^export /gm, '');

function createPreviewHarness() {
  const previews = [];
  const context = vm.createContext({
    getApiBaseUrl: () => 'https://api.example.test',
    ACCESS_TOKEN: 'ACCESS_TOKEN',
    translateFn: () => '图片预览失败',
    emptyI18nParams: () => ({}),
    uni: { previewImage: options => previews.push(options), showToast() {} },
    window: { location: { protocol: 'https:', host: 'site.example.test', origin: 'https://site.example.test' } },
  });
  vm.runInContext(stripTypeScriptTypes(source), context);
  return { context, previews };
}

test('App 预览按 URL 选中正确图片，但向原生 API 传索引', () => {
  const { context, previews } = createPreviewHarness();
  context.previewImageCompat(['/api/f/one', '/api/f/two'], '/api/f/two');
  assert.equal(previews.length, 1);
  assert.equal(previews[0].current, 1);
  assert.deepEqual(Array.from(previews[0].urls), [
    'https://api.example.test/api/f/one',
    'https://api.example.test/api/f/two',
  ]);
});

test('原生临时路径不会被误拼成站点 URL', () => {
  const { context, previews } = createPreviewHarness();
  for (const path of [
    '_doc/uniapp_temp/1.jpg',
    'uniapp://cache/1.jpg',
    'internal://cache/1.jpg',
    '/storage/emulated/0/DCIM/1.jpg',
    '/data/user/0/app/cache/1.jpg',
    '/var/mobile/Containers/Data/1.jpg',
    'content://media/1',
  ]) {
    assert.equal(context.normalizePreviewImageUrl(path), path);
    context.previewImageCompat([path], path);
    assert.equal(previews.at(-1).urls[0], path);
  }
});

test('空列表不调用原生预览', () => {
  const { context, previews } = createPreviewHarness();
  context.previewImageCompat([], '');
  assert.equal(previews.length, 0);
});

test('首页 App 附件预览等待鉴权图片下载，并按选中项打开', async () => {
  const component = readFileSync(new URL('../components/conversation-input/chat-upload-image/chat-upload-image.uvue', import.meta.url), 'utf8');
  const start = component.indexOf('  const onPreview = async');
  let snippet = component.slice(start, component.indexOf('\n  };', start) + 5);
  snippet = snippet.replace(/\/\/ #ifndef APP[\s\S]*?\/\/ #endif/g, '');
  const opened = [], loading = [];
  const files = [
    { url: '/api/f/first', type: 'image/jpeg' },
    { url: '/api/f/second', type: 'image/jpeg' },
  ];
  const context = vm.createContext({
    props: { files },
    isImageFile: () => true,
    fileUrl: file => file.url,
    isAuthProtectedFileUrl: url => url.startsWith('/api/f/'),
    resolvedProtectedImages: new Map(),
    resolveProtectedImage: async url => 'file:///cache/' + url.split('/').at(-1),
    normalizePreviewImageUrl: url => url,
    previewImageCompat: (urls, current) => opened.push({ urls: Array.from(urls), current }),
    uni: { showLoading: () => loading.push('show'), hideLoading: () => loading.push('hide'), showToast() {} },
  });
  const onPreview = vm.runInContext(stripTypeScriptTypes(snippet) + '\nonPreview', context);
  await onPreview(files[1]);
  assert.deepEqual(opened, [{ urls: ['file:///cache/first', 'file:///cache/second'], current: 'file:///cache/second' }]);
  assert.deepEqual(loading, ['show', 'hide']);
});
