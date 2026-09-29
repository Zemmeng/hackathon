// vms.js —— 屏上文字规范（纯函数，不碰 DOM）。T2 的文案输入框、Worker 的 400 校验、规则兜底共用这一份。
// 出处（docs/arch/5-llm-api-detail.pdf 第 3 页）：RPM VMS 产品页（每帧 4 行 × 10 字符）；WA VMS 指南 §1.4 §2.3.2 §7.4；NSW TS 00198 §8.1
// 用法：const r = checkVms([['USE', 'RUSSELL ST', 'SAVE 8 MIN']], { read_s: 9 });  r.ok / r.errors / r.warnings / r.frames（已规范化）
// errors 里的 code 是 ASCII 短码，msg 是给人看的中文；有 error 时 Worker 直接回 400。

export const VMS = {
  maxFrames: 2, // 最多 2 帧（默认 1 帧）
  maxLines: 4, warnLines: 3, // 每帧最多 4 行，超过 3 行给警告
  maxChars: 10, warnChars: 8, // 每行最多 10 个字符，超过 8 个给警告
  maxWords: 8, // 所有帧合计 ≤ 8 个词
  warnWordLen: 8, // 除地名外每个词 ≤ 8 个字符（程序认不出地名，只给警告）
  frameMinS: 3, // 两帧时每帧至少停 3 秒
  signMaxChars: 40, // 普通标志牌 / 箭头板上的字
};

// 只许大写字母、数字、空格和少量标点。尖括号进不来：屏上文字会被包在 <sign>…</sign> 里交给大模型当数据
const CHARSET = /^[A-Z0-9 .,'&/:+\-]*$/;

export function normLine(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

export function normFrames(frames) {
  if (!Array.isArray(frames)) return [];
  return frames.map(f => (Array.isArray(f) ? f.map(normLine) : []));
}

export function words(frames) {
  return normFrames(frames).flat().join(' ').split(' ').filter(Boolean);
}

export function checkVms(frames, { read_s } = {}) {
  const errors = [], warnings = [];
  const err = (code, msg) => errors.push({ code, msg });
  const warn = (code, msg) => warnings.push({ code, msg });
  if (!Array.isArray(frames) || frames.length === 0) {
    err('no_frames', '屏上至少要有 1 帧');
    return { ok: false, errors, warnings, frames: [] };
  }
  if (frames.length > VMS.maxFrames) err('too_many_frames', `最多 ${VMS.maxFrames} 帧，现在 ${frames.length} 帧`);
  const out = normFrames(frames);
  out.forEach((f, i) => {
    const raw = frames[i];
    if (!Array.isArray(raw) || raw.length === 0) { err('empty_frame', `第 ${i + 1} 帧是空的`); return; }
    if (raw.length > VMS.maxLines) err('too_many_lines', `第 ${i + 1} 帧 ${raw.length} 行，最多 ${VMS.maxLines} 行`);
    else if (raw.length > VMS.warnLines) warn('many_lines', `第 ${i + 1} 帧 ${raw.length} 行，超过 ${VMS.warnLines} 行不好读`);
    f.forEach((line, j) => {
      if (typeof raw[j] !== 'string') { err('not_text', `第 ${i + 1} 帧第 ${j + 1} 行不是文字`); return; }
      if (!line) err('empty_line', `第 ${i + 1} 帧第 ${j + 1} 行是空的`);
      if (line.length > VMS.maxChars) err('line_too_long', `「${line}」${line.length} 个字符，每行最多 ${VMS.maxChars} 个`);
      else if (line.length > VMS.warnChars) warn('long_line', `「${line}」${line.length} 个字符，超过 ${VMS.warnChars} 个不好读`);
      if (!CHARSET.test(line)) err('bad_char', `「${line}」里有不允许的字符（只能用大写字母、数字、空格和 . , ' & / : + -）`);
    });
  });
  const ws = words(out);
  if (ws.length > VMS.maxWords) err('too_many_words', `所有帧合计 ${ws.length} 个词，最多 ${VMS.maxWords} 个`);
  for (const w of ws) if (w.length > VMS.warnWordLen) warn('long_word', `「${w}」超过 ${VMS.warnWordLen} 个字符（地名可以例外）`);
  if (out.length === 2 && Number.isFinite(read_s) && read_s < VMS.frameMinS * 2) {
    warn('frames_too_fast', `两帧每帧至少要停 ${VMS.frameMinS} 秒，这个车速下只能读 ${read_s} 秒`);
  }
  return { ok: errors.length === 0, errors, warnings, frames: out };
}

// 普通标志牌、箭头板上的字：非空、≤ 40 字符、同一套字符集
export function checkSignText(text) {
  const errors = [];
  if (typeof text !== 'string') {
    errors.push({ code: 'not_text', msg: '标志牌上的字不是文字' });
    return { ok: false, errors, text: '' };
  }
  const t = normLine(text);
  if (!t) errors.push({ code: 'empty_sign', msg: '标志牌上的字是空的' });
  if (t.length > VMS.signMaxChars) errors.push({ code: 'sign_too_long', msg: `标志牌上的字最多 ${VMS.signMaxChars} 个字符` });
  if (!CHARSET.test(t)) errors.push({ code: 'bad_char', msg: `「${t}」里有不允许的字符` });
  return { ok: errors.length === 0, errors, text: t };
}
