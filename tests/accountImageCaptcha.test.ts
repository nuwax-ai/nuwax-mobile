import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiImageCaptcha, apiLogin, apiSendCode } from "../servers/account.uts";
import { LoginFieldType, SendCode } from "../types/interfaces/login.uts";

const request = vi.hoisted(() => vi.fn());
vi.mock("../servers/useRequest", () => ({ default: request }));

beforeEach(() =>
  request.mockReset().mockResolvedValue({ code: "0000", data: null }),
);

describe("图形验证码接口与 UTS 请求序列化", () => {
  it("通过游客可用 GET 接口取图片", async () => {
    const response = {
      code: "0000",
      data: { captchaId: "id", image: "data:image/png;base64,test" },
    };
    request.mockResolvedValueOnce(response);
    expect(await apiImageCaptcha()).toBe(response);
    expect(request).toHaveBeenCalledWith({
      url: "/api/user/captcha/image",
      method: "GET",
      suppressErrorToast: true,
    });
  });

  it("密码登录同时携带图形和阿里云参数，保留统一账号字段", async () => {
    const params = new LoginFieldType();
    Object.assign(params, {
      phoneOrEmail: "user@example.com",
      password: "password",
      captchaId: "image-id",
      captchaCode: " Ab12 ",
      captchaVerifyParam: "aliyun-token",
    });
    await apiLogin(params);
    expect(JSON.parse(JSON.stringify(request.mock.calls[0][0].data))).toEqual({
      phoneOrEmail: "user@example.com",
      emailOrPhone: "user@example.com",
      password: "password",
      captchaVerifyParam: "aliyun-token",
      captchaId: "image-id",
      captchaCode: "Ab12",
    });
  });

  it.each(["phone", "email"])(
    "%s 发码序列化图形参数，保留 type 与阿里云参数",
    async (target) => {
      const params = new SendCode();
      Object.assign(params, {
        [target]: target === "phone" ? "13800138000" : "user@example.com",
        captchaId: "image-id",
        captchaCode: "Cd34",
        captchaVerifyParam: "aliyun-token",
      });
      await apiSendCode(params);
      expect(JSON.parse(JSON.stringify(request.mock.calls[0][0].data))).toEqual(
        {
          type: "LOGIN_OR_REGISTER",
          [target]: params[target as "phone" | "email"],
          captchaVerifyParam: "aliyun-token",
          captchaId: "image-id",
          captchaCode: "Cd34",
        },
      );
    },
  );

  it("关闭开关时请求不增加空图形字段", async () => {
    await apiLogin(new LoginFieldType());
    await apiSendCode(new SendCode());
    for (const [options] of request.mock.calls) {
      expect(options.data).not.toHaveProperty("captchaId");
      expect(options.data).not.toHaveProperty("captchaCode");
    }
  });

  it("接口拒绝仍交给调用方处理", async () => {
    request.mockRejectedValueOnce(new Error("network"));
    await expect(apiImageCaptcha()).rejects.toThrow("network");
  });
});
