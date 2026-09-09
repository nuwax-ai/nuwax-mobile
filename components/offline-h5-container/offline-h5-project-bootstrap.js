/* 项目运行环境适配。仅派生本地包引用，不影响线上浏览器页面。 */
(function () {
  if (location.protocol !== 'file:') return;
  var bridge = window.OfflineH5Bridge;
  try {
    var apiBase = new URLSearchParams(location.search).get('apiBase') || '';
    var server = new URL(apiBase);
    if (!/^https?:$/.test(server.protocol) || server.username || server.password || server.search || server.hash || server.pathname !== '/') throw new Error('invalid server');
    var options = new URLSearchParams(location.hash.split('?').slice(1).join('?'));
    // 每次新文档都替换环境，避免同一 file origin 下残留其他服务器或账号的登录态。
    localStorage.setItem('NUWAX_API_BASE_URL', server.origin);
    localStorage.setItem('ACCESS_TOKEN', options.get('accessToken') || '');
    localStorage.setItem('ACCESS_TOKEN_ORIGIN', server.origin);
  } catch (_) {
    bridge.fail(bridge.requestId(), 'runtime-configuration-failed');
  }
})();
