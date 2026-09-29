// 给 T2 文案输入框用：checkSigns(请求) 不抛错，回 { ok, error?, warnings[] }
// error = 超了规范（/api/read 会回 400、readSigns() 会抛 SignError），warnings = 没超但不好读，只提醒
// 软警告的出处：RPM Hire VMS 产品页（09-29 实查）—— 理想是 3 行、每行 8 个字符；每屏一般停 2 秒，4 行或闪烁 3 秒
// 思路来自 #20 的 vms.js（lead 的骨架），这里多了「整行是路名不算太长」和「非标准缩写」两条
import { normalizeRequest, signMessage, countWords, SignError } from "./signs.js";
import { roadAliases, oddAbbreviations } from "./rules.js";

export const SOFT = {
  lines: 3, // 每帧超过 3 行提醒
  chars: 8, // 每行超过 8 个字符提醒（整行是候选路名的不算：路名没法缩）
  frameS: 2, // 每帧至少停 2 秒
  frameS4: 3, // 4 行的帧至少停 3 秒
  secPerWord: 1, // 每个词约 1 秒（和 rules.js 的 notice 同一个假设）
};

const frameTime = (lines) => (lines.length >= 4 ? SOFT.frameS4 : SOFT.frameS);

export function checkSigns(request) {
  let req;
  try {
    req = normalizeRequest(request);
  } catch (e) {
    if (e instanceof SignError) return { ok: false, error: { code: e.code, msg: e.message }, warnings: [] };
    throw e;
  }
  const roadLines = new Set(roadAliases(req.roads).map((a) => a.toks.join(" ")));
  const isRoad = (line) => roadLines.has(line.replace(/['.]/g, ""));
  const warnings = [];
  req.signs.forEach((s, i) => {
    const warn = (code, msg) => warnings.push({ sign: i, code, msg });
    const words = countWords(signMessage(s));
    if (s.kind === "vms") {
      s.frames.forEach((f, j) => {
        if (f.length > SOFT.lines) warn("many_lines", `第 ${j + 1} 帧 ${f.length} 行，超过 ${SOFT.lines} 行不好读`);
        for (const line of f) {
          if (line.length > SOFT.chars && !isRoad(line)) warn("long_line", `「${line}」${line.length} 个字符，超过 ${SOFT.chars} 个不好读`);
        }
      });
      const need = s.frames.reduce((t, f) => t + frameTime(f), 0);
      if (s.frames.length > 1 && s.read_s < need) {
        warn("frames_too_fast", `两帧要轮一遍至少 ${need} 秒，这个车速下只能读 ${s.read_s} 秒，有人只看到一帧`);
      }
    }
    if (s.read_s < words * SOFT.secPerWord) {
      warn("short_read", `${words} 个词按每词 ${SOFT.secPerWord} 秒要 ${words * SOFT.secPerWord} 秒，只能读 ${s.read_s} 秒`);
    }
    const odd = oddAbbreviations([signMessage(s)], req.roads);
    if (odd.length) warn("odd_abbrev", `非标准缩写 ${odd.join(" ")}：游客可能看不懂`);
  });
  return { ok: true, warnings };
}
