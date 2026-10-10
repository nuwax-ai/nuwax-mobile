import { describe, expect, it } from "vitest";
import {
  ImageCaptchaChallenge,
  imageCaptchaValidationKey,
  isImageCaptchaEnabled,
} from "../utils/imageCaptcha.uts";

describe("租户图形验证码开关", () => {
  it.each([null, {}, { openCaptcha: 1 }, { openImageCaptcha: 0 }])(
    "未开启时保持既有登录流程 %j",
    (config) => {
      expect(isImageCaptchaEnabled(config as any)).toBe(false);
      expect(imageCaptchaValidationKey(false, "", "")).toBe("");
    },
  );

  it.each([1, "1"])("图形开关 %j 独立于阿里云开关", (openImageCaptcha) => {
    expect(
      isImageCaptchaEnabled({ openImageCaptcha, openCaptcha: 0 } as any),
    ).toBe(true);
  });

  it("阻止未加载图片和空白输入；接受包含字母的验证码", () => {
    expect(imageCaptchaValidationKey(true, "", "AB12")).toBe(
      "Mobile.Auth.imageCaptchaLoadFailed",
    );
    expect(imageCaptchaValidationKey(true, "id", "  ")).toBe(
      "Mobile.Auth.imageCaptchaRequired",
    );
    expect(imageCaptchaValidationKey(true, "id", " Ab12 ")).toBe("");
  });
});

describe("一次性图形挑战", () => {
  it("换图开始立即清空旧 ID、图片和输入，加载期间不可复用", () => {
    const challenge = new ImageCaptchaChallenge();
    challenge.complete(challenge.begin(), "old", "data:image/png;base64,old");
    challenge.captchaCode = "AB12";
    challenge.begin();
    expect(challenge).toMatchObject({
      captchaId: "",
      captchaCode: "",
      image: "",
      loading: true,
    });
    expect(
      imageCaptchaValidationKey(
        true,
        challenge.captchaId,
        challenge.captchaCode,
      ),
    ).toBe("Mobile.Auth.imageCaptchaLoadFailed");
  });

  it("连续换图只接收最后一次，旧请求失败不能擦除新挑战", () => {
    const challenge = new ImageCaptchaChallenge();
    const oldSeq = challenge.begin();
    const newSeq = challenge.begin();
    expect(challenge.complete(newSeq, "new", "new-image")).toBe(true);
    expect(challenge.complete(oldSeq, "", "")).toBe(false);
    expect(challenge).toMatchObject({
      captchaId: "new",
      image: "new-image",
      loading: false,
    });
  });

  it("旧请求先返回也不能结束当前加载", () => {
    const challenge = new ImageCaptchaChallenge();
    const oldSeq = challenge.begin();
    const newSeq = challenge.begin();
    expect(challenge.complete(oldSeq, "old", "old-image")).toBe(false);
    expect(challenge.loading).toBe(true);
    challenge.complete(newSeq, "new", "new-image");
    expect(challenge.captchaId).toBe("new");
  });

  it.each([
    ["id", ""],
    ["", "image"],
    ["", ""],
  ])("缺失 ID 或图片视为加载失败 %j %j", (id, image) => {
    const challenge = new ImageCaptchaChallenge();
    challenge.complete(challenge.begin(), id, image);
    expect(challenge).toMatchObject({
      captchaId: "",
      image: "",
      loading: false,
    });
  });

  it("卸载后忽略迟到响应；重挂必须用新挑战", () => {
    const challenge = new ImageCaptchaChallenge();
    const seq = challenge.begin();
    challenge.invalidate();
    expect(challenge.complete(seq, "expired", "expired-image")).toBe(false);
    const fresh = challenge.begin();
    challenge.complete(fresh, "fresh", "fresh-image");
    expect(challenge).toMatchObject({ captchaId: "fresh", captchaCode: "" });
  });
});
