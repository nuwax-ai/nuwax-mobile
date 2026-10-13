import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
// 仅供本地验证，参数为 HBuilderX 编译后的 H5 目录；不会转发真实 API。
if (!process.argv[2]) throw new Error('Usage: node tests/fixtures/idp-server.mjs <HBuilderX web output>');
const root = path.resolve(process.argv[2]);
const providers = [
  {id:'101',type:'CAS',name:'企业 CAS',wechatMode:null},
  {id:'102',type:'OAUTH2',name:'飞书',wechatMode:null},
  {id:'103',type:'WECHAT',name:'微信',wechatMode:'QRCODE'},
  {id:'104',type:'WECHAT',name:'微信内授权',wechatMode:'OA'},
];
let state = {auto:null,listFailure:false,verifyFailure:false,identityFailure:false,unbindFailure:true,
  identities:[{id:'9007199254740993',idpId:'101',providerName:'企业 CAS',externalUserName:'测试账号',externalIdMasked:'te***st'}],events:[]};
const mime = {'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
http.createServer(async(req,res) => {
  const url = new URL(req.url,'http://127.0.0.1:18765');
  function json(data,code='0000',message='') { res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code,message,data})); }
  if (url.pathname === '/_fixture') {
    if(req.method==='POST') { let body='';for await(const chunk of req)body+=chunk;Object.assign(state,JSON.parse(body)); }
    return json(state);
  }
  if(url.pathname.startsWith('/api/')) {
    state.events.push({method:req.method,path:url.pathname,query:Object.fromEntries(url.searchParams)});
    if(url.pathname==='/api/auth/idp/list') return json({items:providers,autoRedirectIdpId:state.auto},state.listFailure?'5000':'0000');
    if(url.pathname==='/api/user/getLoginInfo') return json({id:'100',userId:'100',userName:'本地验证账号',nickname:'本地验证账号',userPhone:'13800000000'},state.verifyFailure?'4010':'0000');
    if(url.pathname==='/api/user/identity/list') return json(state.identities,state.identityFailure?'5000':'0000',state.identityFailure?'账号绑定读取失败':'');
    if(url.pathname.startsWith('/api/user/identity/unbind/')) {
      if(state.unbindFailure) return json(null,'4000','请先设置密码，保留至少一种登录方式');
      state.identities=state.identities.filter(i=>i.id!==url.pathname.split('/').at(-1));return json(null);
    }
    if(url.pathname==='/api/auth/idp/authorize'||url.pathname.startsWith('/api/user/identity/bind/')) {
      const target=url.searchParams.get('redirect');
      if(!target?.startsWith('/m/#/'))return json(null,'4000');
      res.writeHead(302,{location:target});return res.end();
    }
    if(url.pathname==='/api/tenant/config')return json({name:'本地登录验证',siteName:'本地登录验证',enableSmsLogin:true});
    if(url.pathname.includes('/i18n/'))return json([]);
    return json({records:[],list:[],total:0});
  }
  try {
    const relative=decodeURIComponent(url.pathname).replace(/^\/m\/?/,'');
    const file=path.resolve(root,relative||'index.html');
    if(!file.startsWith(root+'/')) { res.writeHead(403);return res.end(); }
    const content=await fs.readFile(file);
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
    res.setHeader('Cache-Control','no-store');res.end(content);
  } catch {res.writeHead(404);res.end('not found');}
}).listen(18765,'127.0.0.1',()=>console.log('IdP fixture: http://127.0.0.1:18765/m/ (local simulated API only)'));
