#!/usr/bin/env node
/**
 * 验证双向跳转脚本逻辑（与 index.html / nuwax config 内联脚本一致）
 * 用法: node scripts/verify-redirect-logic.mjs
 */

const agentDetailPathMobile = '/pages/agent-detail/agent-detail';
const chatTempPathMobile = '/pages/chat-temp/chat-temp';
const newAgentDetailPathMobile = '/subpackages' + agentDetailPathMobile;
const newChatTempPathMobile = '/subpackages' + chatTempPathMobile;

// 应用详情页路径
const appDetailsPathMobile = '/subpackages/pages/app-details/app-details';

function runRedirectLogic(protocol, host, href, hash, userAgent) {
  const baseUrl = protocol + '//' + host;
  const isMobile = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(userAgent);
  let replaceUrl = null;

  const location = {
    get protocol() { return protocol; },
    get host() { return host; },
    get href() { return href; },
    get hash() { return hash; },
    replace(url) { replaceUrl = url; },
  };

  // 兼容分包前的页面
  if (isMobile && href.includes('/m/#/pages/')) {
    let mHash = hash;
    if (hash.indexOf(agentDetailPathMobile) !== -1) {
      mHash = mHash.replace(agentDetailPathMobile, newAgentDetailPathMobile);
      replaceUrl = baseUrl + '/m/' + mHash;
      return replaceUrl;
    }
    if (hash.indexOf(chatTempPathMobile) !== -1) {
      mHash = mHash.replace(chatTempPathMobile, newChatTempPathMobile);
      replaceUrl = baseUrl + '/m/' + mHash;
      return replaceUrl;
    }
  }

  // PC 端访问 M 页面 => 跳转 PC
  if (!isMobile && href.includes('/m/')) {
    // 智能体详情页
    if (hash && hash.indexOf(agentDetailPathMobile) !== -1) {
      const matchId = hash.match(new RegExp('[?&]id=([^&#]+)'));
      const matchConversationId = hash.match(new RegExp('[?&]conversationId=([^&#]+)'));
      if (matchId && matchId[1]) {
        const agentId = matchId[1];
        if (matchConversationId && matchConversationId[1]) {
          const conversationId = matchConversationId[1];
          replaceUrl = baseUrl + '/home/chat/' + conversationId + '/' + agentId;
        } else {
          replaceUrl = baseUrl + '/agent/' + agentId;
        }
        return replaceUrl;
      }
    }

    console.log('应用详情页hash11111111', hash, hash.indexOf(appDetailsPathMobile));

    // 应用详情页
    if (hash && hash.indexOf(appDetailsPathMobile) !== -1) {
      const matchId = hash.match(new RegExp('[?&]id=([^&#]+)'));
      const matchConversationId = hash.match(new RegExp('[?&]conversationId=([^&#]+)'));

      console.log('应用详情页matchId11111111', matchId, matchConversationId);
      if (matchId && matchId[1]) {
        const agentId = matchId[1];
        if (matchConversationId && matchConversationId[1]) {
          const conversationId = matchConversationId[1];
          replaceUrl = baseUrl + '/app/chat/' + agentId + '/' + conversationId;
        } else {
          replaceUrl = baseUrl + '/app/' + agentId;
        }
        return replaceUrl;
      }
    }


    // 临时会话页
    if (hash && hash.indexOf(chatTempPathMobile) !== -1) {
      const matchChatTemp = hash.match(new RegExp('[?&]chatKey=([^&#]+)'));
      if (matchChatTemp && matchChatTemp[1]) {
        replaceUrl = baseUrl + '/chat-temp/' + matchChatTemp[1];
        return replaceUrl;
      }
    }
    replaceUrl = baseUrl + '/';
    return replaceUrl;
  }

  // 移动端访问 PC 页面 => 跳转 M
  if (isMobile && !href.includes('/m/')) {
    // 智能体详情页
    const matchAgent = href.match(new RegExp('/agent/([^/?#]+)'));
    if (matchAgent) {
      replaceUrl = baseUrl + '/m/#' + newAgentDetailPathMobile + '?id=' + matchAgent[1];
      return replaceUrl;
    }

    // 应用会话页 (这里必须要放在应用详情页匹配之前，否则会匹配到应用详情页)
    const matchAppChat = href.match(new RegExp('app/chat/([^/]+)/([^/]+)'));
    if (matchAppChat) {
      const agentId = matchAppChat[1];
      const conversationId = matchAppChat[2];
      replaceUrl = baseUrl + '/m/#' + appDetailsPathMobile + '?id=' + agentId + '&conversationId=' + conversationId;
      return replaceUrl;
    }

    // 应用详情页
    const matchAppDetails = href.match(new RegExp('/app/([^/?#]+)'));
    if (matchAppDetails) {
      replaceUrl = baseUrl + '/m/#' + appDetailsPathMobile + '?id=' + matchAppDetails[1];
      return replaceUrl;
    }

    // 临时会话页
    const matchChatTemp = href.match(new RegExp('/chat-temp/([^/?#]+)'));
    if (matchChatTemp) {
      replaceUrl = baseUrl + '/m/#' + newChatTempPathMobile + '?chatKey=' + matchChatTemp[1];
      return replaceUrl;
    }
    const matchHomeChat = href.match(new RegExp('home/chat/([^/]+)/([^/]+)'));
    if (matchHomeChat) {
      const conversationId = matchHomeChat[1];
      const agentId = matchHomeChat[2];
      replaceUrl = baseUrl + '/m/#' + newAgentDetailPathMobile + '?id=' + agentId + '&conversationId=' + conversationId;
      return replaceUrl;
    }
    replaceUrl = baseUrl + '/m/';
    return replaceUrl;
  }

  return replaceUrl;
}

const base = 'https://testagent.xspaceagi.com';

const cases = [
  {
    name: '移动端打开 H5 会话详情 /home/chat/1534879/1602 → M 端会话页',
    protocol: 'https:',
    host: 'testagent.xspaceagi.com',
    href: base + '/home/chat/1534879/1602',
    hash: '',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
    expect: base + '/m/#/subpackages/pages/agent-detail/agent-detail?id=1602&conversationId=1534879',
  },
  {
    name: 'PC 打开 M 端会话链接（带 conversationId）→ /home/chat/conversationId/agentId',
    protocol: 'https:',
    host: 'testagent.xspaceagi.com',
    href: base + '/m/#/subpackages/pages/agent-detail/agent-detail?id=1602&conversationId=1534879',
    hash: '#/subpackages/pages/agent-detail/agent-detail?id=1602&conversationId=1534879',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
    expect: base + '/home/chat/1534879/1602',
  },
  {
    name: 'PC 打开 M 端仅智能体（无 conversationId）→ /agent/agentId',
    protocol: 'https:',
    host: 'testagent.xspaceagi.com',
    href: base + '/m/#/subpackages/pages/agent-detail/agent-detail?id=1602',
    hash: '#/subpackages/pages/agent-detail/agent-detail?id=1602',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
    expect: base + '/agent/1602',
  },
  {
    name: '移动端打开 /agent/1602 → M 端智能体详情（无会话）',
    protocol: 'https:',
    host: 'testagent.xspaceagi.com',
    href: base + '/agent/1602',
    hash: '',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
    expect: base + '/m/#/subpackages/pages/agent-detail/agent-detail?id=1602',
  },
  {
    name: '移动端打开未知 PC 路径 → /m/ 首页',
    protocol: 'https:',
    host: 'testagent.xspaceagi.com',
    href: base + '/other',
    hash: '',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
    expect: base + '/m/',
  },
];

let passed = 0;
let failed = 0;

for (const c of cases) {
  const got = runRedirectLogic(c.protocol, c.host, c.href, c.hash, c.userAgent);
  const ok = got === c.expect;
  if (ok) {
    passed++;
    console.log('✓', c.name);
  } else {
    failed++;
    console.log('✗', c.name);
    console.log('  期望:', c.expect);
    console.log('  实际:', got);
  }
}

console.log('\n' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed > 0 ? 1 : 0);
