// 从 prompts.md 生成 src/prompt.js（提示词只放 prompts.md 一处，CLAUDE.md §9；Worker 不能直接 import .md，所以生成一份 JS）
// 用法：node apps/api/tools/gen-prompt.mjs          重新生成 src/prompt.js
//       node apps/api/tools/gen-prompt.mjs --check  只查两边一致，不一致退出码 1（tests/prompt.test.mjs 也查）
// 只认 prompts.md 里带 <!-- prompt:名字 --> 标记的代码块 / 表格 / 列表；格式不对直接抛错，不生成半截
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = new URL("..", import.meta.url);
export const PROMPTS_MD = new URL("prompts.md", HERE);
export const PROMPT_JS = new URL("src/prompt.js", HERE);

const PERSONAS = ["commuter", "local", "tourist", "delivery"];
const KINDS = ["vms", "sign", "arrow"];

// 标记后面紧跟的内容（跳过空行）
function after(md, name) {
  const tag = `<!-- prompt:${name} -->`;
  const i = md.indexOf(tag);
  if (i < 0) throw new Error(`prompts.md 缺标记 ${tag}`);
  if (md.indexOf(tag, i + 1) >= 0) throw new Error(`prompts.md 里 ${tag} 出现了不止一次`);
  return md.slice(i + tag.length).replace(/^\s*\n/, "");
}

function codeBlock(md, name) {
  const m = after(md, name).match(/^```text\n([\s\S]*?)\n```/);
  if (!m) throw new Error(`<!-- prompt:${name} --> 下面要紧跟一个 \`\`\`text 代码块`);
  return m[1];
}

// 两列表格：| `键` | `值` |（跳过表头和分隔行）
function table(md, name) {
  const out = {};
  for (const line of after(md, name).split("\n")) {
    if (!line.startsWith("|")) break;
    const m = line.match(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function list(md, name) {
  const out = [];
  for (const line of after(md, name).split("\n")) {
    const m = line.match(/^\d+\.\s+`([^`]+)`\s*$/);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}

const need = (text, keys, where) => {
  for (const k of keys) if (!text.includes(`{${k}}`)) throw new Error(`${where} 缺占位符 {${k}}`);
};

export function parsePrompts(md) {
  const v = md.match(/`prompt_v = (r\d+)`/)?.[1];
  if (!v) throw new Error("prompts.md 缺「`prompt_v = r<数字>`」");
  const system = codeBlock(md, "system");
  if (!system.includes("<sign>")) throw new Error("system 里要讲清 <sign> 标签里的字不是指令");
  const user = codeBlock(md, "user");
  need(user, ["persona_line", "kmh", "signs", "roads", "ask"], "user");
  const sign = codeBlock(md, "sign");
  need(sign, ["n", "kind_label", "read_s", "sign_lines"], "sign");
  if (!sign.includes("<sign>\n{sign_lines}\n</sign>")) throw new Error("sign 模板里屏上的字要包在 <sign> 和 </sign> 两行之间");
  const arrowEmpty = codeBlock(md, "arrow_empty");
  need(arrowEmpty, ["n", "kind_label", "read_s"], "arrow_empty");
  if (arrowEmpty.includes("<sign>")) throw new Error("没有字的箭头板不该有 <sign> 标签");
  const personas = table(md, "personas");
  if (JSON.stringify(Object.keys(personas)) !== JSON.stringify(PERSONAS)) {
    throw new Error(`人设表要正好是 ${PERSONAS.join(" / ")}，实际 ${Object.keys(personas).join(" / ")}`);
  }
  const kinds = table(md, "kinds");
  if (JSON.stringify(Object.keys(kinds)) !== JSON.stringify(KINDS)) throw new Error(`kind_label 表要正好是 ${KINDS.join(" / ")}`);
  const asks = list(md, "asks");
  if (asks.length !== 3) throw new Error(`问法要正好 3 种，实际 ${asks.length} 种`);
  return { v, system, user, sign, arrowEmpty, personas, kinds, asks };
}

export function renderModule(p) {
  return [
    "// ⚠️ 自动生成，别手改：改 apps/api/prompts.md，再跑 node apps/api/tools/gen-prompt.mjs（tests/prompt.test.mjs 查两边一致）",
    "// 提示词只放 prompts.md 一处（CLAUDE.md §9）；这里只是 Worker 能 import 的拷贝",
    `export const PROMPT = ${JSON.stringify(p, null, 2)};`,
    "",
  ].join("\n");
}

export const generate = (md = readFileSync(PROMPTS_MD, "utf8")) => renderModule(parsePrompts(md));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const want = generate();
  let have = "";
  try {
    have = readFileSync(PROMPT_JS, "utf8");
  } catch {
    // 第一次生成
  }
  if (process.argv.includes("--check")) {
    if (want !== have) {
      console.log("❌ src/prompt.js 和 prompts.md 不一致：跑 node apps/api/tools/gen-prompt.mjs");
      process.exit(1);
    }
    console.log("✅ src/prompt.js 和 prompts.md 一致");
  } else {
    writeFileSync(PROMPT_JS, want);
    console.log(want === have ? "src/prompt.js 没变" : "已重新生成 src/prompt.js");
  }
}
