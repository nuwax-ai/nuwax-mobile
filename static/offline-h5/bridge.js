/* 项目内离线 H5 协议 v1。此脚本不读取登录态、不理解业务路由、不探测 DOM。 */
(function (root) {
  'use strict';
  var pending = Object.create(null);
  var navigator = null;
  var navigationId = '';
  var interval;
  function currentRequestId() {
    var query = location.hash.split('?').slice(1).join('?');
    return new URLSearchParams(query).get('offlineH5RequestId') || '';
  }
  function send(type, requestId, code) {
    if (!requestId) return;
    var key = type + ':' + requestId;
    pending[key] = { type: type, protocolVersion: 1, requestId: requestId, code: code || '', attempts: 0 };
    flush();
  }
  function flush() {
    Object.keys(pending).forEach(function (key) {
      var message = pending[key];
      if (++message.attempts > 120) { delete pending[key]; return; }
      try {
        // 未确认收到前持续重发，桥尚未安装时不做“已发送”去重。
        if (root.uni && root.uni.webView) root.uni.webView.postMessage({ data: {
          type: message.type, protocolVersion: 1, requestId: message.requestId, code: message.code
        } });
      } catch (_) {}
    });
  }
  root.OfflineH5Bridge = {
    protocolVersion: 1,
    requestId: currentRequestId,
    registerNavigator: function (handler) { navigator = handler; },
    pageReady: function (requestId) { send('OFFLINE_H5_PAGE_READY', requestId); },
    fail: function (requestId, code) { send('OFFLINE_H5_ERROR', requestId, code); },
    debug: function (requestId, code) { send('OFFLINE_H5_DEBUG', requestId, code); },
    acknowledge: function (type, requestId) { delete pending[type + ':' + requestId]; },
    navigate: function (request) {
      navigationId = request.requestId;
      var id = navigationId;
      send('OFFLINE_H5_DEBUG', id, 'navigate-received');
      if (!navigator) { send('OFFLINE_H5_ERROR', id, 'navigator-unavailable'); return; }
      Promise.resolve().then(function () {
        if (navigationId !== id) return;
        return navigator(request.route, id, function () { return navigationId === id; });
      }).then(function () {
        send('OFFLINE_H5_DEBUG', id, 'navigate-settled');
      }).catch(function (e) {
        if (navigationId === id) send('OFFLINE_H5_ERROR', id, 'navigation-failed:' + (e && e.message ? e.message : 'unknown'));
      });
    },
    dispose: function () { clearInterval(interval); pending = Object.create(null); navigationId = ''; }
  };
  interval = setInterval(flush, 250);
  root.addEventListener('pagehide', root.OfflineH5Bridge.dispose);
})(window);
