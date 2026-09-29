// 测试小工具：ok() 记一条断言；t() 包住一段异步测试，抛异常算失败；done() 打「N passed, M failed」并按结果退出
let P = 0, F = 0;
export function ok(cond, msg) {
  if (cond) { P++; console.log('✅ ' + msg); } else { F++; console.log('❌ ' + msg); }
}
export async function t(name, fn) {
  try { await fn(); } catch (e) { F++; console.log(`❌ ${name} 抛异常：${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`); }
}
export function done() {
  console.log(`${P} passed, ${F} failed`);
  process.exit(F ? 1 : 0);
}
// 施工 A：La Trobe St 西行、Russell St 到 Swanston St 之间封 1 条车道（方格路网）
export function wsA(frames = [['ROADWORK', 'AHEAD']], extra = {}) {
  return {
    id: 'A', links: ['L-n0_6-n0_5'], closes: { lanes: 1 }, time: { from: '2026-10-05', to: '2026-10-09', hours: [7, 19] },
    equipment: [{ id: 'vms1', type: 'vms', at_m: 300, frames }, { id: 's1', type: 'sign', at_m: 100, text: 'RIGHT LANE CLOSED' }],
    ...extra,
  };
}
// 施工 B：Lonsdale St 西行、同一段封 1 条车道（A 的绕行车都要经过这里）
export function wsB(extra = {}) {
  return {
    id: 'B', links: ['L-n1_6-n1_5'], closes: { lanes: 1 }, time: { from: '2026-10-07', to: '2026-10-12', hours: [7, 19] },
    equipment: [{ id: 'vmsB', type: 'vms', at_m: 300, frames: [['ROADWORK', 'AHEAD']] }],
    ...extra,
  };
}
export const WHEN = { date: '2026-10-06', hour: 17 }; // 周二晚高峰
