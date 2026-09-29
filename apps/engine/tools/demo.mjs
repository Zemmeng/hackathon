// demo.mjs —— 把演示三幕 + 规划顾问跑一遍，打印数字（D-0929-1435 版：读数用引擎自带的 MOCK 读数器，不联网、不花钱）
// 用法：node apps/engine/tools/demo.mjs [--real] [--params apps/params/public/params.json]
//   --params：用 T12 的参数文件（缺项、不合格的逐项回退到假设值，开头会打出哪几项用了文件里的数）
//   默认：方格路网（Hoddle Grid 街名、假设车流）；--real 另在 T3 真路网（apps/roads/public/cbd/）上跑第一幕
// 数字来自假设参数 + 关键词读数，只用来看方向和量级，不能当结论。T5 的 readSigns() 到了换掉 mockReadSigns。
import { readFileSync } from 'node:fs';
import { makeGrid, createEngine, mockReadSigns, advise, mockAdvise, shiftWorksite, windowWhens, affected, capFactors, TYPES, applyParams } from '../public/js/index.js';

const pct = x => (x * 100).toFixed(1) + '%';
const when = { date: '2026-10-06', hour: 17 };
const A = frames => ({ id: 'A', name: 'La Trobe St westbound lane closure', links: ['L-n0_6-n0_5'], closes: { lanes: 1 },
  time: { from: '2026-10-05', to: '2026-10-09', hours: [7, 19] },
  equipment: [{ id: 'vms1', type: 'vms', at_m: 300, frames }, { id: 's1', type: 'sign', at_m: 100, text: 'RIGHT LANE CLOSED' }] });
const B = { id: 'B', name: 'Lonsdale St westbound lane closure', links: ['L-n1_6-n1_5'], closes: { lanes: 1 },
  time: { from: '2026-10-07', to: '2026-10-12', hours: [7, 19] }, equipment: [{ id: 'vmsB', type: 'vms', at_m: 300, frames: [['ROADWORK', 'AHEAD']] }] };

const pi = process.argv.indexOf('--params');
const params = pi > 0 ? applyParams(JSON.parse(readFileSync(process.argv[pi + 1], 'utf8'))) : applyParams(null);
if (pi > 0) {
  const u = params.used, fromFile = [u.mix === 'params' && 'mix', u.anchors === 'params' && 'anchors',
    ...TYPES.flatMap(t => Object.entries(u.persona[t]).filter(([, v]) => v !== 'default').map(([k, v]) => `${t}.${k}${v === 'sign_trust' ? '(sign_trust)' : ''}`))].filter(Boolean);
  console.log(`参数：${process.argv[pi + 1]} · 用了文件里的 ${fromFile.join(' ') || '（没有）'}${u.errors.length ? ' · 不合格：' + u.errors.join('；') : ''}\n`);
}

const { network, flows } = makeGrid();
const eng = createEngine({ network, flows, readSigns: mockReadSigns, params });
const c0 = (await eng.prepare({ when, worksites: [A([['ROADWORK', 'AHEAD']])] })).calib;
console.log(`方格路网（假设车流）· ${when.date} ${when.hour}:00 · 读数 = MOCK 关键词规则 · 两点校准 A ${c0.A} / B ${c0.B}（ROADWORK AHEAD → ${pct(c0.lo_detour)}，USE RUSSELL ST → ${pct(c0.hi_detour)}）\n`);
console.log('第一幕：设备和位置不动，只改屏上的字（La Trobe St 西行封 1 条车道）');
for (const fr of [[['ROADWORK', 'AHEAD']], [['USE', 'RUSSELL ST', 'SAVE 4 MIN']]]) {
  const plan = { when, worksites: [A(fr)] };
  await eng.prepare(plan);
  const r = eng.evaluate(plan), a = r.approaches[0];
  console.log(`  「${fr.flat().join(' / ')}」 排队 ${a.queue_m} 米 · 总延误 ${r.delay_min} 车·分钟 · 绕行 ${pct(1 - a.share.stay)}`);
  for (const t of TYPES) {
    const x = a.by_type[t], y = r.by_type[t];
    console.log(`      ${t.padEnd(8)} 被说动 ${pct(x.informed)} · 绕行 ${pct(x.detour)} · 人均多花 ${y.per_capita_min} 分钟 · ${x.reading?.why ?? ''}`);
  }
}
const a = A([['USE', 'RUSSELL ST', 'SAVE 4 MIN']]);
const W = windowWhens([a, B], [17]);
await eng.prepare({ when, worksites: [a, B] }, { whens: W });
const c = eng.conflict(a, B, { whens: W });
console.log(`\n第二幕：再加附近另一个施工（Lonsdale St 西行，和 A 有 3 天重叠），晚高峰合计\n  A ${c.a} + B ${c.b} = ${c.a + c.b}，一起算 ${c.ab} 车·分钟 → 冲突成本 ${c.cost}`);
const bs = shiftWorksite(B, 5);
const W2 = windowWhens([a, bs], [17]);
await eng.prepare({ when, worksites: [a, bs] }, { whens: W2 });
const s = eng.conflict(a, bs, { whens: W2 });
console.log(`\n第三幕：B 推迟 5 天\n  A ${s.a} + B ${s.b}，一起算 ${s.ab} → 冲突成本 ${s.cost}`);
const adv = await advise(eng, { when, worksites: [A([['ROADWORK', 'AHEAD']]), B] }, { askAdvisor: mockAdvise, hours: [17] });
console.log(`\n规划顾问（MOCK 规则）：每个改法都用引擎重算\n  现在：${adv.before.delay_min} 车·分钟（${adv.whens} 个晚高峰时刻合计）`);
for (const o of adv.options) console.log(`  · ${o.suggestion.kind}：${o.suggestion.why} → ${o.delay_min ?? '-'}（${o.delta_min >= 0 ? '+' : ''}${o.delta_min ?? o.skipped}）${o.better ? '' : ' 不建议'}`);

if (process.argv.includes('--real')) {
  const dir = new URL('../../roads/public/cbd/', import.meta.url);
  const rn = JSON.parse(readFileSync(new URL('network.json', dir), 'utf8'));
  const rf = JSON.parse(readFileSync(new URL('flows.json', dir), 'utf8'));
  const real = createEngine({ network: rn, flows: rf, readSigns: mockReadSigns, params });
  const link = 'l2177124610_2190478926';
  const [ap] = affected(real.net, rf, { id: 'R', links: [link], closes: { lanes: 1 } }, when, capFactors(real.net, [{ links: [link], closes: { lanes: 1 } }]));
  const best = ap.alts[0];
  console.log(`\n真路网（T3，${rn.links.length} 个路段）：Bourke Street 东行封 1 条车道，17 点 ${ap.volume} veh/h，绕行：${ap.alts.map(r => `${r.name}（拐口 ${Math.round(r.diverge_m)} 米）`).join(' / ')}`);
  for (const fr of [[['ROADWORK', 'AHEAD']], [['USE', best.name.split(' ')[0].toUpperCase().slice(0, 10), 'SAVE 3 MIN']]]) {
    const plan = { when, worksites: [{ id: 'R', links: [link], closes: { lanes: 1 }, time: { from: '2026-10-05', to: '2026-10-09', hours: [7, 19] },
      equipment: [{ id: 'vms1', type: 'vms', at_m: Math.round(best.diverge_m) + 100, frames: fr }] }] };
    await real.prepare(plan);
    const t0 = performance.now();
    const r = real.evaluate(plan);
    console.log(`  「${fr.flat().join(' / ')}」 排队 ${r.approaches[0].queue_m} 米 · 总延误 ${r.delay_min} 车·分钟 · ${best.name} 分到 ${pct(r.approaches[0].routes[1].share)} · evaluate ${(performance.now() - t0).toFixed(1)} 毫秒`);
  }
}
