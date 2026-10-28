import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EspProvisioningPhaseEnum } from "@/types/enums/espProvisioning.uts";
import { PROVISION_TERMINAL_PAGE } from "@/utils/provisionSession.uts";

const terminalPath = "/subpackages/pages/terminal/terminal";
const progressPath = "subpackages/pages/provision/provision-progress/provision-progress";
const progressSource = readFileSync(`${progressPath}.uvue`, "utf8");

function setup(source: string, context: Record<string, unknown>, expose: string) {
  const script = source.match(/<script setup lang="uts">([\s\S]*?)<\/script>/)![1]
    .replace(/^\s*import .+;\s*$/gm, "");
  return runInNewContext(transformSync(`${script}\n;({${expose}});`, { loader: "ts" }).code, context);
}

function progress(routes = ["pages/tab-shell/tab-shell", terminalPath.slice(1), "entry", "wifi", progressPath], returnUrl = terminalPath) {
  const controller = {
    phase: { value: EspProvisioningPhaseEnum.SUCCESS }, error: { value: null },
    connectedSsid: { value: "test-wifi" }, deviceInfo: { value: { serialNumber: "NX-test" } },
    getBoundBindingId: () => "42",
  };
  let backPress: () => boolean = () => false;
  const unmounted: (() => void)[] = [];
  const fail = { errMsg: "navigation:fail", errCode: 1 };
  const finish = (options: any) => options.success?.({ errMsg: "navigation:ok" });
  const uni = {
    navigateBack: vi.fn((options: any) => backPress() ? options.fail?.(fail) : finish(options)),
    redirectTo: vi.fn((options: any) => options.url === terminalPath ? finish(options) : options.fail?.(fail)),
    reLaunch: vi.fn((options: any) => options.url.startsWith("/subpackages/") ? finish(options) : options.fail?.(fail)),
    switchTab: vi.fn((options: any) => options.fail?.(fail)),
    showToast: vi.fn(), showModal: vi.fn(),
  };
  const context = {
    ref: (value: unknown) => ({ value }),
    computed: (get: () => unknown) => ({ get value() { return get(); } }),
    watch: vi.fn(), onLoad: vi.fn(), onUnmounted: (fn: () => void) => unmounted.push(fn),
    onBackPress: (fn: () => boolean) => { backPress = fn; },
    emptyI18nParams: () => ({}), translateFn: (key: string) => key,
    EspProvisioningPhaseEnum, PROVISION_TERMINAL_PAGE,
    useEspProvisioning: () => controller,
    releaseEspProvisioning: vi.fn(), clearProvisionSession: vi.fn(),
    getProvisionReturnUrl: () => returnUrl, getReprovisionTarget: () => null,
    getCurrentPages: () => routes.map(route => ({ route })),
    apiVoxDeviceBindingDetail: vi.fn().mockResolvedValue({ code: "0000", data: { bindingStatus: "BOUND" } }),
    apiResCode: (res: any) => res.code, apiResData: (res: any) => res.data, SUCCESS_CODE: "0000",
    switchMainTab: (options: any) => uni.switchTab(options), uni,
    setTimeout, clearTimeout, setInterval, clearInterval, console: { error: vi.fn() },
  };
  const page = setup(progressSource, context, "onDone, leaveProvision, startOnlinePolling, onlineCheckFailed, deviceOnline, returnFailed");
  return { ...context, page, controller, unmount: () => unmounted.forEach(fn => fn()) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("配网完成返回终端", () => {
  it("入口的默认返回地址是已注册的普通分包页", () => {
    const config = runInNewContext(`(${readFileSync("pages.json", "utf8")})`);
    const registered = config.subPackages.flatMap((pack: any) => pack.pages.map((page: any) => `/${pack.root}/${page.path}`));
    expect(PROVISION_TERMINAL_PAGE).toBe(terminalPath);
    expect(registered).toContain(PROVISION_TERMINAL_PAGE);
    expect(config.tabBar.list.map((tab: any) => `/${tab.pagePath}`)).not.toContain(PROVISION_TERMINAL_PAGE);
    const setProvisionReturnUrl = vi.fn();
    setup(readFileSync("subpackages/pages/provision/provision-entry/provision-entry.uvue", "utf8"), {
      ref: (value: unknown) => ({ value }), useEspProvisioning: () => ({}),
      onLoad: (fn: (options: unknown) => void) => fn({}), onReady: vi.fn(),
      setProvisionReturnUrl, PROVISION_TERMINAL_PAGE,
    }, "");
    expect(setProvisionReturnUrl).toHaveBeenCalledWith(terminalPath);
  });

  it("确认上线后先展示成功，1.5 秒后退回已有终端页并清理配网页", async () => {
    const p = progress();
    p.page.startOnlinePolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.page.deviceOnline.value).toBe(true);
    expect(p.uni.showToast).toHaveBeenCalledWith(expect.objectContaining({ icon: "success" }));
    vi.advanceTimersByTime(1499);
    expect(p.uni.navigateBack).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(p.uni.navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 3 }));
    expect(p.uni.switchTab).not.toHaveBeenCalled();
    expect(p.uni.reLaunch).not.toHaveBeenCalled();
    expect(p.releaseEspProvisioning).toHaveBeenCalledTimes(1);
    expect(p.clearProvisionSession).toHaveBeenCalledTimes(1);
    p.page.onDone();
    expect(p.uni.navigateBack).toHaveBeenCalledTimes(1);
  });

  it("30 秒未上线时保持待确认，点击手动返回仍回到终端", async () => {
    const p = progress();
    p.apiVoxDeviceBindingDetail.mockResolvedValue({ code: "0000", data: { bindingStatus: "PENDING" } });
    p.page.startOnlinePolling();
    await vi.advanceTimersByTimeAsync(30000);
    expect(p.page.onlineCheckFailed.value).toBe(true);
    expect(p.uni.navigateBack).not.toHaveBeenCalled();
    p.page.onDone();
    expect(p.uni.navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 3 }));
  });

  it("页面栈没有终端时打开已注册的分包页面", () => {
    const p = progress([progressPath]);
    p.page.onDone();
    expect(p.uni.redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: terminalPath }));
    expect(p.uni.switchTab).not.toHaveBeenCalled();
  });

  it("栈内返回失败时改为打开分包终端页", () => {
    const p = progress();
    p.uni.navigateBack.mockImplementationOnce((options: any) => options.fail({ errMsg: "navigateBack:fail" }));
    p.page.onDone();
    expect(p.uni.redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: terminalPath }));
  });

  it("跳转最终失败后显示手动返回入口，允许重新尝试", () => {
    const p = progress([progressPath]);
    p.page.deviceOnline.value = true;
    p.uni.redirectTo.mockImplementationOnce((options: any) => options.fail({ errMsg: "redirectTo:fail" }));
    p.page.onDone();
    expect(p.page.returnFailed.value).toBe(true);
    // 求值成功态内真实的手动返回条件，避免错误后仍无可操作入口。
    const successView = progressSource.slice(progressSource.indexOf('v-else-if="isSuccess && deviceOnline"'));
    const visible = successView.match(/<view v-if="([^"]+)"[^>]*@tap="onDone"/)!;
    expect(runInNewContext(visible[1], { returnFailed: p.page.returnFailed.value })).toBe(true);
    p.page.onDone();
    expect(p.uni.redirectTo).toHaveBeenCalledTimes(2);
    expect(p.page.returnFailed.value).toBe(false);
  });

  it("进行中取消配网回终端时，程序返回不会再被离开确认拦截", () => {
    const p = progress();
    p.controller.phase.value = EspProvisioningPhaseEnum.CHECKING_STATUS;
    p.page.leaveProvision();
    expect(p.uni.navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 3 }));
    expect(p.uni.redirectTo).not.toHaveBeenCalled();
    expect(p.uni.showModal).not.toHaveBeenCalled();
  });

  it("换 Wi-Fi 场景取消时仍返回对应绑定记录的详情页", () => {
    const url = "/subpackages/pages/terminal/terminal-device-detail?bindingId=42";
    const p = progress(undefined, url);
    p.page.leaveProvision();
    expect(p.uni.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url }));
    expect(p.uni.navigateBack).not.toHaveBeenCalled();
  });

  it("成功提示期间卸载页面会取消自动跳转", async () => {
    const p = progress();
    p.page.startOnlinePolling();
    await vi.advanceTimersByTimeAsync(0);
    p.unmount();
    vi.advanceTimersByTime(1500);
    expect(p.uni.navigateBack).not.toHaveBeenCalled();
    expect(p.uni.redirectTo).not.toHaveBeenCalled();
  });
});
