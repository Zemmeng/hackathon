// cards.js —— 第 ② 步：写出一类路人「路上看到了什么」的场景卡（交给 askPersonas，格式见 docs/contract.md「路人 agent」）。
// 只放司机真看得到的：按先后顺序的标志、屏上原文、车速下能读几秒、能走哪几条路、平时各要多久、前面排多长。
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

export const MAX_SIGNS = 6; // api 的 validateCard 最多收 6 块；施工方案最多 10 件设备，多的只留离施工最近的 6 块
export const round1 = x => Math.round(x * 10) / 10;
export const bucket = (x, step) => Math.round((Number(x) || 0) / step) * step;

export function signsFor(ap, ws) {
  return (ws.equipment || [])
    .filter(e => (e.type === 'vms' || e.type === 'sign' || e.type === 'arrow') && (!e.dir || e.dir === ap.dir))
    .map(e => (e.type === 'vms'
      ? { m: e.at_m, kind: 'vms', read_s: readSeconds(ap.kmh, e.char_mm), frames: e.frames }
      : { m: e.at_m, kind: e.type, text: e.text }))
    .sort((a, b) => b.m - a.m)
    .slice(-MAX_SIGNS);
}

export function cardRoutes(ap) {
  // turn_m：这条绕行在施工起点上游多少米拐出去（司机开到那里看得到路口）；屏摆在拐口之后，看到时已经拐不过去了
  return [ap.stay, ...ap.alts].filter(Boolean).map(r => ({
    id: r.id, name: cleanName(r.name), usual_min: round1(r.usual_min),
    ...(r.id !== 'stay' && Number.isFinite(r.diverge_m) ? { turn_m: Math.round(r.diverge_m) } : {}),
    ...(r.truck === false ? { truck: false } : {}),
  }));
}

export function buildCard(ap, ws, { queue_m = 0 } = {}) {
  return {
    trip: { on: cleanName(ap.street), dir: ap.dir, to: cleanName(ap.to), kmh: ap.kmh },
    signs: signsFor(ap, ws),
    routes: cardRoutes(ap),
    queue_m: bucket(queue_m, 100),
  };
}
