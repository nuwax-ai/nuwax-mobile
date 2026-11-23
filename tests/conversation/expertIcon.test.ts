import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("components/agent-icon/agent-icon.uvue", "utf8");
const start = source.indexOf("  async function resolveIconUrl(");
const end = source.indexOf("\n  }", start) + 4;
const { code } = transformSync(source.slice(start, end), { loader: "ts" });
const origin = "https://example.test";
const defaultIcon = "/static/assets/agent_image.png";

function androidIconResolver() {
  const svg = vi.fn(async (url: string) => url);
  const display = vi.fn(async () => "/tmp/protected-image");
  const signed = vi.fn(async () => "https://storage.example.test/signed.svg");
  const resolveIconUrl = runInNewContext(`${code}\nresolveIconUrl`, {
    defaultAgentIcon: defaultIcon,
    getApiBaseUrl: () => origin,
    rasterSize: (size: number) => size * 2,
    props: { size: 17 },
    resolveAppSvgUrl: svg,
    resolveDisplayImageUrl: display,
    fetchAuthProtectedFileAkUrl: signed,
    isRemoteSvgUrl: (url: string) => url.endsWith(".svg"),
    isAuthProtectedFileUrl: (url: string) => url.includes("/api/f/"),
    resolveAuthProtectedFileFetchUrl: (url: string) => url.startsWith("/") ? origin + url : url,
  });
  return { resolveIconUrl, svg, display, signed };
}

describe("Android 专家图标", () => {
  it("默认图直接加载本地资源", async () => {
    const { resolveIconUrl, svg, display } = androidIconResolver();
    await expect(resolveIconUrl(defaultIcon)).resolves.toBe(defaultIcon);
    expect(svg).not.toHaveBeenCalled();
    expect(display).not.toHaveBeenCalled();
  });

  it("受保护的位图走鉴权下载", async () => {
    const { resolveIconUrl, svg, display } = androidIconResolver();
    await expect(resolveIconUrl("/api/f/expert.png")).resolves.toBe("/tmp/protected-image");
    expect(display).toHaveBeenCalledWith(origin + "/api/f/expert.png", 34, 34);
    expect(svg).not.toHaveBeenCalled();
  });

  it("受保护的 SVG 优先按容器尺寸加载，改写失败才取签名地址", async () => {
    const { resolveIconUrl, svg, signed } = androidIconResolver();
    const url = origin + "/api/f/expert.svg";
    svg.mockResolvedValueOnce("data:image/svg+xml;utf8,icon");
    await expect(resolveIconUrl(url)).resolves.toBe("data:image/svg+xml;utf8,icon");
    expect(svg).toHaveBeenCalledWith(url, 34, 34);
    expect(signed).not.toHaveBeenCalled();
    await expect(resolveIconUrl(url)).resolves.toBe("https://storage.example.test/signed.svg");
    expect(signed).toHaveBeenCalledWith(url);
  });

  it("外部地址不走平台文件鉴权", async () => {
    const { resolveIconUrl, svg, display, signed } = androidIconResolver();
    const url = "https://external.example.test/api/f/expert.svg";
    await expect(resolveIconUrl(url)).resolves.toBe(url);
    expect(svg).not.toHaveBeenCalled();
    expect(display).not.toHaveBeenCalled();
    expect(signed).not.toHaveBeenCalled();
  });
});
