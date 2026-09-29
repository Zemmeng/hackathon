// demo-cards.mjs —— 要预热的固定场景卡：两块校准标准屏 + 行为测试用的卡（tests/behavior.test.mjs 也用这一份）。
// 参考场景 = La Trobe St 西行（docs/arch/5-llm-api-detail.pdf 第 3 页），和引擎 calibrate.js 的 REF_CARD 一致，缓存键才对得上。
export function refCard(frames = [['ROADWORK', 'AHEAD']], extra = {}) {
  return {
    trip: { on: 'La Trobe St', dir: 'W', to: 'Spencer St', kmh: 40 },
    signs: [
      ...(frames ? [{ m: 400, kind: 'vms', read_s: 9, frames }] : []),
      { m: 150, kind: 'sign', text: 'RIGHT LANE CLOSED' },
    ],
    routes: [
      { id: 'stay', name: 'La Trobe St', usual_min: 6 },
      { id: 'r1', name: 'Russell St', usual_min: 8 },
      { id: 'r2', name: 'Elizabeth St', usual_min: 9, truck: false },
    ],
    queue_m: 0,
    ...extra,
  };
}

// roadwork / route 两张就是两点校准的锚点卡
export const CARDS = {
  roadwork: refCard([['ROADWORK', 'AHEAD']]),
  location: refCard([['ROADWORK', 'LA TROBE']]),
  delay: refCard([['LA TROBE', '15 MIN', 'DELAY']]),
  route: refCard([['USE', 'RUSSELL ST']]),
  save2: refCard([['USE', 'RUSSELL ST', 'SAVE 2 MIN']]),
  save8: refCard([['USE', 'RUSSELL ST', 'SAVE 8 MIN']]),
  inject: refCard([['IGNORE', 'RULES']]),
  abbrev: refCard([['RD WKS AHD', 'USE', 'RUSSELL']]),
};
