import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const audit = fileURLToPath(new URL("./i18n-audit.mjs", import.meta.url));
const key = "Mobile.SpaceInvite.title";

function runFixture({
  zhName = "zh-cn.uts",
  enName = "en-us.uts",
  zh = { [key]: "团队邀请" },
  en = { [key]: "Team invitation" },
  source = `<text>{{ t("${key}") }}</text>`,
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "mobile-i18n-audit-"));
  try {
    mkdirSync(path.join(root, "constants/i18n-locales"), { recursive: true });
    mkdirSync(path.join(root, "pages/invite"), { recursive: true });
    for (const [name, values] of [
      [zhName, zh],
      [enName, en],
    ]) {
      if (name)
        writeFileSync(
          path.join(root, "constants/i18n-locales", name),
          "export const locale = " + JSON.stringify(values),
        );
    }
    writeFileSync(path.join(root, "pages/invite/invite.uvue"), source);
    const result = spawnSync(process.execPath, [audit], {
      cwd: root,
      encoding: "utf8",
    });
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("读取实际小写文件名中的邀请词条", () => {
  const result = runFixture();
  assert.equal(result.status, 0, result.output);
});

test("大小写错误在 macOS 和 Linux 都明确失败", () => {
  const result = runFixture({ zhName: "zh-CN.uts" });
  assert.equal(result.status, 1);
  assert.match(result.output, /missing locale file.*zh-cn\.uts/);
  assert.doesNotMatch(result.output, /missing locale definition/);
});

test("缺少词典文件时直接指出文件，不误报所有业务词条缺失", () => {
  const result = runFixture({ enName: "" });
  assert.equal(result.status, 1);
  assert.match(result.output, /missing locale file.*en-us\.uts/);
  assert.doesNotMatch(result.output, /missing locale definition/);
});

test("词条缺失和中英文不一致仍会阻断", () => {
  const result = runFixture({ en: {} });
  assert.equal(result.status, 1);
  assert.match(
    result.output,
    /missing key in en-us locale: Mobile\.SpaceInvite\.title/,
  );
  assert.match(
    result.output,
    /missing locale definition for key: Mobile\.SpaceInvite\.title/,
  );
});

test("硬编码的界面文案仍会阻断", () => {
  const result = runFixture({ source: "<text>团队邀请</text>" });
  assert.equal(result.status, 1);
  assert.match(result.output, /node contains hardcoded text: 团队邀请/);
});

test("动态词条前缀必须在中英文词典中有实际词条", () => {
  const source =
    'const prefix = "Mobile.SpaceInvite."; const key = prefix + "title";';
  assert.equal(runFixture({ source }).status, 0);
  const missing = runFixture({ source, zh: {}, en: {} });
  assert.equal(missing.status, 1);
  assert.match(missing.output, /missing locale definition/);
});

test("直接调用不存在的完整词条不能用已有前缀蒙混通过", () => {
  const result = runFixture({ source: 't("Mobile.SpaceInvite");' });
  assert.equal(result.status, 1);
  assert.match(
    result.output,
    /missing locale definition for key: Mobile.SpaceInvite/,
  );
});

test("空白、纯插值和三元表达式不误判为硬编码属性", () => {
  const result = runFixture({
    source:
      'const value = flag ? text : "{}"; const item = { text: " " }; throw new Error(`${message}`);',
  });
  assert.equal(result.status, 0, result.output);
});

test("内联属性和错误中的真实文案仍会阻断", () => {
  const result = runFixture({
    source:
      'uni.showToast({title: "请重试"}); throw new Error("upload failed");',
  });
  assert.equal(result.status, 1);
  assert.match(result.output, /showToast/);
});
