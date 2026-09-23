/** IIFE 已内联 JS 分块，只保留 Vite 的 CSS 预加载和完成/失败等待。 */
export function removeInlinedJsPreloads(bundle) {
  let count = 0;
  const result = bundle.replace(
    /((?:const|let|var)\s+([\w$]+)\s*=\s*document\.createElement\("link"\);\s*)(?:return\s+)?\2\.rel\s*=\s*([\w$]+)\s*\?\s*"stylesheet"\s*:\s*(?:"modulepreload"|[\w$]+)/g,
    (match, declaration, link, isCss) => {
      count++;
      return `if (!${isCss}) return;\n${match}`;
    },
  );
  // 上游 helper 形态变化时中止打包，不能静默交付仍请求 file:// JS 的资源包。
  if (count !== 1) throw new Error(`Expected one Vite preload helper, found ${count}`);
  return result;
}
