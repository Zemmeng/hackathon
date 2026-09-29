// 读 wrangler.jsonc：去掉 // 和 /* */ 注释、尾逗号（跳过字符串里的内容）再 JSON.parse。tests/config.test.mjs 和 tools/precompute.mjs 共用
export function parseJsonc(text) {
  let out = "";
  let i = 0;
  let str = false;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (str) {
      out += c;
      if (c === "\\") {
        out += n;
        i += 2;
        continue;
      }
      if (c === '"') str = false;
      i++;
      continue;
    }
    if (c === '"') {
      str = true;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i = text.indexOf("*/", i + 2) + 2;
      continue;
    }
    out += c;
    i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}
