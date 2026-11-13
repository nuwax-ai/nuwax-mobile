import { describe, expect, it } from "vitest";
import {
  classifyOemPushVendor,
  computeManualSettingsRequired,
  PushBackgroundPolicyInput,
  resolvePushSystemVendor,
} from "@/utils/push/pushBackgroundPolicy.uts";

describe("Android background push vendor classification", () => {
  it.each([
    ["HUAWEI", "HUAWEI", "huawei"],
    ["HONOR", "HONOR", "honor"],
    ["Xiaomi", "Redmi", "xiaomi"],
    ["Xiaomi", "POCO", "xiaomi"],
    ["OPPO", "OPPO", "oppo"],
    ["realme", "realme", "oppo"],
    ["OnePlus", "OnePlus", "oppo"],
    ["vivo", "iQOO", "vivo"],
  ])("maps %s/%s to %s", (manufacturer, brand, expected) => {
    expect(classifyOemPushVendor(manufacturer, brand)).toBe(expected);
  });

  it("uses FCM only after OEM classification", () => {
    expect(resolvePushSystemVendor("samsung", "samsung", "available")).toBe("fcm");
    expect(resolvePushSystemVendor("samsung", "samsung", "unavailable")).toBe("none");
    expect(resolvePushSystemVendor("unknown", "unknown", "unknown")).toBe("unknown");
    expect(resolvePushSystemVendor("Xiaomi", "POCO", "unavailable")).toBe("xiaomi");
  });
});

describe("Android background push manual setup policy", () => {
  const policy = (
    vendorPushAvailable: boolean = false,
    notificationEnabled: boolean = true,
    batteryOptimizationSupported: boolean = true,
    batteryOptimizationIgnored: boolean | null = true,
    backgroundRestrictedSupported: boolean = true,
    backgroundRestricted: boolean | null = false,
    manualSetupAcknowledged: boolean = true,
  ): PushBackgroundPolicyInput => new PushBackgroundPolicyInput(
    vendorPushAvailable,
    notificationEnabled,
    batteryOptimizationSupported,
    batteryOptimizationIgnored,
    backgroundRestrictedSupported,
    backgroundRestricted,
    manualSetupAcknowledged,
  );

  it("does not require setup when a system push channel is available", () => {
    expect(computeManualSettingsRequired(policy(true, false))).toBe(false);
  });

  it.each([
    [policy(false, false), "notifications disabled"],
    [policy(false, true, true, false), "battery optimization active"],
    [policy(false, true, true, true, true, true), "background restricted"],
  ])("requires setup when %s", (input) => {
    expect(computeManualSettingsRequired(input as PushBackgroundPolicyInput)).toBe(true);
  });

  it("ignores unsupported system checks", () => {
    expect(computeManualSettingsRequired(
      policy(false, true, false, null, false, null, true),
    )).toBe(false);
  });

  // 可测项全通过即「已优化」，不要求用户再点「我已完成」——否则设置完回到页面仍显示需要设置。
  it("does not require setup once measurable checks pass, acknowledged or not", () => {
    expect(computeManualSettingsRequired(policy(false, true, true, true, true, false, false))).toBe(false);
    expect(computeManualSettingsRequired(policy(false, true, true, true, true, false, true))).toBe(false);
  });
});
