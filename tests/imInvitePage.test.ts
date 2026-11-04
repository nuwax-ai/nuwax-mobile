import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { imInviteReturnPath, planImInvite } from "../utils/imInviteEntry.uts";

const source = readFileSync("subpackages/pages/im-invite/im-invite.uvue", "utf8")
  .split('<script setup lang="uts">')[1].split("</script>")[0];
const ok = (data: unknown) => ({ code: "0000", data });
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const route = "/subpackages/pages/im-invite/im-invite";

function setup(options: { app?: boolean; token?: string; search?: string; outer?: string; embedded?: boolean } = {}) {
  const script = source
    .replace(/\/\/ #ifdef APP\n([\s\S]*?)\/\/ #endif/g, (_, body) => options.app ? body : "")
    .replace(/\/\/ #ifdef H5 \|\| WEB\n([\s\S]*?)\/\/ #endif/g, (_, body) => options.app ? "" : body)
    .replace(/^import .+;\s*$/gm, "");
  const detail = vi.fn().mockResolvedValue(ok({ convId: "9007199254740993", convType: 2, name: "群 & 交流", avatar: "/a.png?x=1&y=2" }));
  const p2p = vi.fn().mockResolvedValue(ok({ convId: "9007199254740993", convType: 1 }));
  const agent = vi.fn().mockResolvedValue(ok({ convId: "9007199254740993", convType: 1 }));
  const enter = vi.fn().mockResolvedValue(ok({ convId: "9007199254740993", convType: 4 }));
  const redirect = vi.fn(); const login = vi.fn(); const native = vi.fn().mockReturnValue(true);
  const sdk = vi.fn().mockResolvedValue(true);
  const scope = { stamp: "first-session", origin: "https://fixture.example", token: options.token ?? "fixture-token" };
  const clear = vi.fn(() => { scope.stamp = "cleared"; });
  let load: (params: object) => void = () => {}; let unload: () => void = () => {};
  const page = runInNewContext(transformSync(script + "\n({continueInvite,state,errorText});", {loader:"ts"}).code, {
    Error,
    ref: <T>(value: T) => ({value}), computed: (getter: () => unknown) => ({get value(){return getter()}}),
    onLoad: (callback: typeof load) => { load = callback; }, onUnload: (callback: typeof unload) => { unload = callback; },
    apiImConvDetail: detail, apiImCreateP2pConversation: p2p, apiImCreateAgentConversation: agent, apiImSpaceEnter: enter,
    apiResCode: (response: any) => response?.code, apiResData: (response: any) => response?.data,
    apiResMessage: (response: any) => response?.message ?? "",
    SUCCESS_CODE:"0000",USER_NO_LOGIN:"4010",REDIRECT_LOGIN:"4011",IM_TOKEN_INVALID:"IM_10401",IM_AUTH_REDIRECT:"IM_10402",
    ACCESS_TOKEN:"ACCESS_TOKEN",getImSessionStamp:()=>scope.stamp,getApiBaseUrl:()=>scope.origin,clearStoragePreservingApiBaseUrl:clear,
    redirectToLoginOnce:login,LOGIN_PAGE_PATH:"/subpackages/pages/login/login",imInviteReturnPath,planImInvite,
    useI18n:()=>({t:(key:string)=>key}),emptyI18nParams:()=>({}),isNativeAppWebView:()=>options.embedded??false,
    ensureAppWebViewNavigationReady:sdk,navigateViaWebViewSdk:native,
    window:{location:{hash:"#"+route+(options.search??""),search:options.outer??""}},
    uni:{getStorageSync:()=>scope.token,setStorageSync:(_key:string,value:string)=>{scope.token=value},redirectTo:redirect},
  });
  return {...page,detail,p2p,agent,enter,redirect,login,native,sdk,scope,clear,load,unload,apis:[detail,p2p,agent,enter]};
}

describe("真实 IM 承接页脚本", () => {
  it.each([false,true])("H5 / APP=%s 详情鉴权后进入精确会话，保留 convType 和编码", async app => {
    const p=setup({app});p.load({convId:"9007199254740993"});await settle();
    expect(p.detail).toHaveBeenCalledExactlyOnceWith("9007199254740993",route+"?convId=9007199254740993",true,true);
    expect(p.redirect.mock.calls[0][0].url).toBe("/pages/message/chat?convId=9007199254740993&convType=2&name=%E7%BE%A4%20%26%20%E4%BA%A4%E6%B5%81&avatar=%2Fa.png%3Fx%3D1%26y%3D2");
  });
  it.each([["userId","p2p","1"],["agentId","agent","1"],["spaceId","enter","4"]])("%s 使用自己的 API，目标会话取服务端返回",async(key,api,type)=>{
    const p=setup();p.load({[key]:"9007199254740995"});await settle();
    expect(p[api]).toHaveBeenCalledExactlyOnceWith("9007199254740995",route+"?"+key+"=9007199254740995",true,true);
    expect(p.redirect.mock.calls[0][0].url).toContain("convId=9007199254740993&convType="+type);
  });
  it("invite+groupNo 只预填邀请群号，不发加入或会话 API",async()=>{
    const p=setup({search:"?invite=0-01&groupNo=42"});p.load({});await settle();
    expect(p.redirect.mock.calls[0][0].url).toBe("/subpackages/pages/im-join-group/im-join-group?groupNo=001");
    for(const api of p.apis)expect(api).not.toHaveBeenCalled();
  });
  it.each(["convId","userId","agentId","spaceId"])("invite+%s 明确拒绝且零 API/导航",async key=>{
    const p=setup({search:"?invite=42&"+key+"=7"});p.load({});await settle();
    expect(p.state.value).toBe("unsupported");for(const api of p.apis)expect(api).not.toHaveBeenCalled();
    expect(p.redirect).not.toHaveBeenCalled();expect(p.login).not.toHaveBeenCalled();
  });
  it("无效高优先级不退到其他目标",async()=>{
    const p=setup({search:"?convId=invalid&spaceId=42"});p.load({});await settle();
    expect(p.state.value).toBe("invalid");for(const api of p.apis)expect(api).not.toHaveBeenCalled();
  });
  it.each(["4010","4011","IM_10401","IM_10402"])("当前会话的%s 才清理旧登录并保留完整回跳",async code=>{
    const p=setup({search:"?convId=7&opaque=a%2525#pane",outer:"?tracking=keep%26value"});
    p.detail.mockResolvedValue({code,data:null,message:"/login?local=1&redirect=%2Fm%2F"});p.load({convId:"999"});await settle();
    expect(p.state.value).toBe("auth");expect(p.clear).toHaveBeenCalledOnce();
    expect(p.login).toHaveBeenCalledExactlyOnceWith("/subpackages/pages/login/login?local=1&redirect=%2Fm%2F",route+"?convId=7&opaque=a%2525&tracking=keep%26value");
    expect(p.redirect).not.toHaveBeenCalled();
  });
  it("原生匿名回登录，不请求 API",async()=>{
    const p=setup({app:true,token:""});p.load({spaceId:"42"});await settle();
    expect(p.login).toHaveBeenCalledExactlyOnceWith("/subpackages/pages/login/login",route+"?spaceId=42");for(const api of p.apis)expect(api).not.toHaveBeenCalled();
  });
  it("业务失权停在错误态，手动重试成功才导航",async()=>{
    const p=setup();p.detail.mockResolvedValueOnce({code:"IM_10403",message:"没有访问权限",data:null});p.load({convId:"9007199254740993"});await settle();
    expect(p.state.value).toBe("error");expect(p.errorText.value).toBe("没有访问权限");expect(p.login).not.toHaveBeenCalled();expect(p.redirect).not.toHaveBeenCalled();
    await p.continueInvite();expect(p.redirect).toHaveBeenCalledOnce();
  });
  it.each([{convId:"7",convType:2},{convId:"9007199254740993"},{convId:"9007199254740993",convType:9}])("错误详情响应不误开其他会话 %j",async response=>{
    const p=setup();p.detail.mockResolvedValue(ok(response));p.load({convId:"9007199254740993"});await settle();
    expect(p.state.value).toBe("error");expect(p.redirect).not.toHaveBeenCalled();
  });
  it("详情允许当前服务端SYSTEM=3，不改写成单聊",async()=>{
    const p=setup();p.detail.mockResolvedValue(ok({convId:"9007199254740993",convType:3}));p.load({convId:"9007199254740993"});await settle();
    expect(p.redirect.mock.calls[0][0].url).toContain("convId=9007199254740993&convType=3");
  });
  it("团队缺省类型只按团队回退，不猜成单聊",async()=>{
    const p=setup();p.enter.mockResolvedValueOnce(ok({convId:"9007199254740993"}));p.load({spaceId:"42"});await settle();
    expect(p.redirect.mock.calls[0][0].url).toContain("convType=4");
    p.redirect.mockClear();p.enter.mockResolvedValue(ok({convId:"9007199254740993",convType:1}));await p.continueInvite();expect(p.redirect).not.toHaveBeenCalled();
  });
  it.each(["stamp","origin","unload"])("%s 变化后迟到鉴权失败不能清新会话或跳登录",async kind=>{
    const p=setup();let resolve:(value:unknown)=>void=()=>{};p.detail.mockImplementation(()=>new Promise(r=>{resolve=r}));p.load({convId:"7"});
    if(kind==="stamp")p.scope.stamp="new-session";else if(kind==="origin")p.scope.origin="https://other.example";else p.unload();
    resolve({code:"4010",data:null});await settle();expect(p.clear).not.toHaveBeenCalled();expect(p.login).not.toHaveBeenCalled();expect(p.redirect).not.toHaveBeenCalled();
  });
  it("原生桥等待期间换账号不发旧导航",async()=>{
    const p=setup({embedded:true});let resolve:(value:boolean)=>void=()=>{};p.sdk.mockImplementation(()=>new Promise(r=>{resolve=r}));p.load({convId:"9007199254740993"});await settle();
    p.scope.stamp="new-session";resolve(true);await settle();expect(p.native).not.toHaveBeenCalled();expect(p.redirect).not.toHaveBeenCalled();
  });
  it("桥失败可重试；在途重复点击不并发",async()=>{
    const p=setup({embedded:true});p.sdk.mockResolvedValueOnce(false);p.load({convId:"9007199254740993"});p.continueInvite();await settle();
    expect(p.detail).toHaveBeenCalledOnce();expect(p.state.value).toBe("error");await p.continueInvite();expect(p.native).toHaveBeenCalledOnce();expect(p.state.value).toBe("handed");
  });
});

it("下游加群表单接受 PC 的1~19位短群号，拒绝超长",()=>{
  const join=readFileSync("subpackages/pages/im-join-group/im-join-group.uvue","utf8");
  const start=join.indexOf("function isGroupNoValid(");const end=join.indexOf("\n  /**",start);
  const validate=runInNewContext(transformSync(join.slice(start,end)+"\nisGroupNoValid;",{loader:"ts"}).code);
  expect(validate("1")).toBe(true);expect(validate("001")).toBe(true);expect(validate("1234567890123456789")).toBe(true);expect(validate("12345678901234567890")).toBe(false);
});
