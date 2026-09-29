// demo.mjs —— 在方格路网上把演示三幕 + 规划顾问跑一遍，打印数字（MOCK：路人选择用 api 模块的关键词规则，不联网、不花钱）
// 用法：node apps/engine/tools/demo.mjs [--cards out/cards.json]
//   --cards：把这次用到的场景卡写成 JSON，给 node apps/api/tools/prewarm.mjs --cards 预热用
// 数字来自假设的方格路网和规则估算，只用来看方向和量级，不能当结论。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { makeGrid, loadNetwork, runScenario, conflictCost, advise, shiftWorksite } from '../public/js/index.js';
import { askPersonas, askAdvisor } from '../../api/public/js/persona.js';

const args = process.argv.slice(2);
const cardsOut = args.includes('--cards') ? args[args.indexOf('--cards') + 1] : null;
const used = [];
const ask = (card, o) => { used.push(card); return askPersonas(card, { ...(o || {}), force: 'rule' }); };
const { network, flows } = makeGrid();
const net = loadNetwork(network);
const when = { date: '2026-10-06', hour: 17 };
const A = frames => ({ id: 'A', name: 'La Trobe St westbound lane closure', links: ['L-n0_6-n0_5'], closes: { lanes: 1 },
  time: { from: '2026-10-05', to: '2026-10-09', hours: [7, 19] },
  equipment: [{ id: 'vms1', type: 'vms', at_m: 300, frames }, { id: 's1', type: 'sign', at_m: 100, text: 'RIGHT LANE CLOSED' }] });
const B = { id: 'B', name: 'Lonsdale St westbound lane closure', links: ['L-n1_6-n1_5'], closes: { lanes: 1 },
  time: { from: '2026-10-07', to: '2026-10-12', hours: [7, 19] }, equipment: [{ id: 'vmsB', type: 'vms', at_m: 300, frames: [['ROADWORK', 'AHEAD']] }] };
const pct = x => (x * 100).toFixed(1) + '%';

console.log(`方格路网（Hoddle Grid 街名，假设车流）· ${when.date} ${when.hour}:00 · 路人选择 = 关键词规则（MOCK）\n`);
console.log('第一幕：设备和位置不动，只改屏上的字（La Trobe St 西行封 1 条车道）');
for (const fr of [[['ROADWORK', 'AHEAD']], [['USE', 'RUSSELL ST', 'SAVE 4 MIN']]]) {
  const r = await runScenario({ network: net, flows, when, worksites: [A(fr)], ask });
  const a = r.approaches[0];
  console.log(`  「${fr.flat().join(' / ')}」 排队 ${a.queue_m} 米 · 总延误 ${r.delay_min} 车·分钟 · 绕行 ${pct(1 - a.share.stay)}（表态 ${pct(a.calib.raw_detour)} → 校准 ${pct(a.calib.detour)}）· 问了 ${a.rounds} 轮`);
  for (const [t, x] of Object.entries(a.by_type)) console.log(`      ${t.padEnd(8)} 绕行 ${pct(x.detour)} · 每辆多花 ${x.extra_min} 分钟 · ${x.why}`);
}
console.log('\n第二幕：再加附近另一个施工（Lonsdale St 西行，和 A 有 3 天重叠），晚高峰合计');
const a = A([['USE', 'RUSSELL ST', 'SAVE 4 MIN']]);
const c = await conflictCost({ network: net, flows, a, b: B, ask, hours: [17] });
console.log(`  A ${c.a} + B ${c.b} = ${c.a + c.b}，一起算 ${c.ab} 车·分钟 → 冲突成本 ${c.cost}`);
console.log('\n第三幕：B 推迟 5 天');
const s = await conflictCost({ network: net, flows, a, b: shiftWorksite(B, 5), ask, hours: [17] });
console.log(`  A ${s.a} + B ${s.b}，一起算 ${s.ab} → 冲突成本 ${s.cost}`);
console.log('\n规划顾问（规则版）：每个改法都用引擎重算');
const adv = await advise({ network: net, flows, when, worksites: [A([['ROADWORK', 'AHEAD']]), B], ask, askAdvisor: x => askAdvisor(x, { force: 'rule' }), hours: [17] });
console.log(`  现在：${adv.before.delay_min} 车·分钟（${adv.whens} 个晚高峰时刻合计）`);
for (const o of adv.options) console.log(`  · ${o.suggestion.kind}：${o.suggestion.why} → ${o.delay_min ?? '-'}（${o.delta_min >= 0 ? '+' : ''}${o.delta_min ?? o.skipped}）`);

if (cardsOut) {
  mkdirSync(dirname(cardsOut), { recursive: true });
  const uniq = [...new Map(used.map(cd => [JSON.stringify(cd), cd])).values()];
  writeFileSync(cardsOut, JSON.stringify({ cards: uniq.map((card, i) => ({ name: `demo-${i + 1}`, card })) }, null, 1) + '\n');
  console.log(`\n用到的 ${uniq.length} 张场景卡写到 ${cardsOut}（给 prewarm --cards 用）`);
}
