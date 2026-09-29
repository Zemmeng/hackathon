// cards.js —— 第 ② 步用的小工具：读屏秒数、路名清洗。请求本身在 reading.js（D-0929-1435 的「读数请求」）。
// 读屏秒数 = 能看清的距离 ÷ 车速（WA VMS 指南 §7.4：字高 320 mm 约 200 米看得清，200 mm 约 100 米）。

export function legibleM(char_mm = 320) {
  return char_mm >= 320 ? 200 : char_mm >= 200 ? 100 : 60;
}

export function readSeconds(kmh, char_mm = 320) {
  return Math.round(legibleM(char_mm) / (Math.max(5, kmh) / 3.6));
}

// 路名进提示词：只留 api 认的字符，最长 40
export function cleanName(s) {
  const t = String(s ?? '').replace(/[^A-Za-z0-9 .,'&/()-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return t || 'Unnamed road';
}

export const round1 = x => Math.round(x * 10) / 10;
export const bucket = (x, step) => Math.round((Number(x) || 0) / step) * step;
