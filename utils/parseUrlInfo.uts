/**
 * URL 解析工具（兼容 H5 & 微信小程序）
 */
export interface ParseUrlResult {
  path: string;
  query: Record<string, string>;
}

/**
 * 从 url 中解析 path 和指定 query 参数
 * @param input url 字符串（完整 url / 相对路径 / query）
 * @param pickKeys 需要提取的 query key（不传则全部返回）
 */
export function parseUrlInfo(
  input: string,
  pickKeys?: string[],
): ParseUrlResult {
  if (!input) {
    return { path: "", query: {} };
  }

  // 统一 decode（避免多次 decode）
  let decoded = input;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    decoded = input;
  }

  let path = "";
  let queryStr = "";

  // 1️⃣ 完整 URL（https://xxx.com/xx?a=1）
  if (/^https?:\/\//i.test(decoded)) {
    const [p, q = ""] = decoded.split("?");
    path = p.replace(/^https?:\/\/[^/]+/, "");
    queryStr = q;
  }
  // 2️⃣ 相对路径（/xx/yy?a=1）
  else if (decoded.includes("?")) {
    const [p, q] = decoded.split("?");
    path = p;
    queryStr = q;
  }
  // 3️⃣ 仅 path
  else if (decoded.startsWith("/")) {
    path = decoded;
  }
  // 4️⃣ 仅 query（a=1&b=2）
  else {
    queryStr = decoded;
  }

  // 解析 query
  const query: Record<string, string> = {};
  if (queryStr) {
    queryStr.split("&").forEach((item) => {
      if (!item) return;
      const [k, v = ""] = item.split("=");
      if (!k) return;

      // 二次保护 decode
      try {
        query[k] = decodeURIComponent(v);
      } catch {
        query[k] = v;
      }
    });
  }

  // 只取指定 key
  if (pickKeys?.length) {
    const picked: Record<string, string> = {};
    pickKeys.forEach((k) => {
      if (query[k] !== undefined) {
        picked[k] = query[k];
      }
    });
    return { path, query: picked };
  }

  return { path, query };
}



/**
 * 从 URL 或字符串中获取文件名
 * @param input URL 或 文件名
 * @returns 文件名
 */
export function getFileName(input: string): string {
  if (!input) return '';

  // 去掉 query 参数
  const withoutQuery = input.split('?')[0];

  // 取最后一个 /
  const lastSlashIndex = withoutQuery.lastIndexOf('/');
  const fileName =
    lastSlashIndex !== -1
      ? withoutQuery.slice(lastSlashIndex + 1)
      : withoutQuery;

  // 解码（防止中文被 encode）
  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}