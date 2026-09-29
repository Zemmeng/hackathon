// 端到端（D-0929-1435 版）：createEngine + MOCK 读数器跑通 docs/arch/4-ai-flow.md 全流程，固定演示三幕（docs/2-plan.md），
// 再在 T3 的真路网（apps/roads/public/cbd/）上跑一遍：能加载、单次 evaluate < 100 毫秒、第一幕方向成立。
// 数字来自假设参数 + 关键词读数，只断言方向和关系，不断言具体数值。T5 的 readSigns() 到了以后换掉 mockReadSigns 再跑一遍。
import { readFileSync, existsSync } from 'node:fs';
import { ok, t, done, wsA, wsB, WHEN } from './_t.mjs';
import { makeGrid, createEngine, mockReadSigns, advise, mockAdvise, shiftWorksite, windowWhens, affected, capFactors, loadNetwork } from '../public/js/index.js';

const { network, flows } = makeGrid();
const eng = createEngine({ network, flows, readSigns: mockReadSigns });
const run = async plan => { await eng.prepare(plan); return eng.evaluate(plan); };

await t('act 1: one line of VMS text', async () => {
  for (const when of [{ date: '2026-10-06', hour: 8 }, WHEN]) {
    const p = await run({ when, worksites: [wsA([['ROADWORK', 'AHEAD']])] });
    const n = await run({ when, worksites: [wsA([['USE', 'RUSSELL ST', 'SAVE 4 MIN']])] });
    ok(n.delay_min < p.delay_min && n.approaches[0].queue_m < p.approaches[0].queue_m,
      `第一幕 ${when.hour} 点：屏上从 ROADWORK AHEAD 改成 USE RUSSELL ST / SAVE 4 MIN，总延误 ${p.delay_min} → ${n.delay_min}，排队 ${p.approaches[0].queue_m} → ${n.approaches[0].queue_m} 米`);
    ok(n.approaches[0].routes.find(r => r.name === 'Russell St').share > p.approaches[0].routes.find(r => r.name === 'Russell St').share, `${when.hour} 点：被点名的 Russell St 分到的车变多`);
  }
  const n = await run({ when: WHEN, worksites: [wsA([['USE', 'RUSSELL ST', 'SAVE 4 MIN']])] });
  const b = n.approaches[0].by_type;
  ok(b.commuter.detour > b.delivery.detour && b.commuter.told.includes('Russell St'), '分人群：通勤司机比送货司机绕得多；读数说屏点名了 Russell St');
  ok(n.calib.method === 'two_point' && n.calib.src === 'rule', 'MOCK：两点校准用的是规则读数（界面标「估算」）');
});

await t('sign position matters', async () => {
  const late = wsA([['USE', 'SPRING ST']]); late.equipment[0].at_m = 300; // Spring St 在施工前 400 米拐，屏在 300 米：看到时已经拐不过去
  const early = wsA([['USE', 'SPRING ST']]); early.equipment[0].at_m = 500;
  const sp = r => r.approaches[0].routes.find(x => x.name === 'Spring St').share;
  const a = await run({ when: WHEN, worksites: [late] }), b = await run({ when: WHEN, worksites: [early] });
  ok(sp(b) > sp(a) && a.approaches[0].routes.find(x => x.name === 'Spring St').turn_m === 400, `屏摆在拐口之后不起作用：屏在 300 米时 Spring St 分到 ${sp(a)}，挪到 500 米后 ${sp(b)}`);
});

await t('act 2 and 3: two worksites', async () => {
  const a = wsA([['USE', 'RUSSELL ST', 'SAVE 4 MIN']]);
  await eng.prepare({ when: WHEN, worksites: [a, wsB()] }, { whens: windowWhens([a, wsB()], [17]) });
  const c = eng.conflict(a, wsB(), { hours: [17] });
  ok(c.overlap && c.cost > 0 && c.cost < 20 * (c.a + c.b), `第二幕（A 点名 Russell St，绕行正好经过 B）：A ${c.a} + B ${c.b} ≠ A+B ${c.ab}，冲突成本 ${c.cost}（${c.whens} 个时刻）`);
  const bs = shiftWorksite(wsB(), 5);
  await eng.prepare({ when: WHEN, worksites: [a, bs] }, { whens: windowWhens([a, bs], [17]) });
  const s = eng.conflict(a, bs, { hours: [17] });
  ok(!s.overlap && s.cost === 0, `第三幕：B 推迟 5 天，冲突成本 ${s.cost}`);
});

await t('step 7: advisor re-runs every suggestion', async () => {
  const res = await advise(eng, { when: WHEN, worksites: [wsA(), wsB()] }, { askAdvisor: mockAdvise, hours: [17] });
  ok(res.options.length >= 2 && res.options.every(o => o.skipped || (Number.isFinite(o.delta_min) && o.result && o.better === (o.delta_min < 0))), `MOCK 顾问给出 ${res.options.length} 个改法（${res.options.map(o => o.suggestion.kind).join(' / ')}），每个都由引擎重算并标 better`);
  const shift = res.options.find(o => o.suggestion.kind === 'shift');
  const c = eng.conflict(wsA(), wsB(), { hours: [17] });
  ok(shift && shift.better && Math.abs(-shift.delta_min - c.cost) <= Math.max(5, 0.05 * c.cost), `错开日期的好处 ≈ 冲突成本（${-shift?.delta_min} vs ${c.cost}）：改前改后用同一段时间比`);
  const noon = { date: '2026-10-06', hour: 12 };
  const calm = await advise(eng, { when: noon, worksites: [wsA([['ROADWORK', 'AHEAD']], { time: { from: '2026-10-05', to: '2026-10-09', hours: [11, 14] } })] }, { askAdvisor: mockAdvise });
  ok(!calm.options.some(o => o.suggestion.kind === 'text'), '中午不堵、绕行不更快：MOCK 顾问不建议改字劝人绕');
});

await t('real CBD network (T3)', async () => {
  const dir = new URL('../../roads/public/cbd/', import.meta.url);
  if (!existsSync(new URL('network.json', dir))) { ok(false, '找不到 apps/roads/public/cbd/network.json'); return; }
  const rn = JSON.parse(readFileSync(new URL('network.json', dir), 'utf8'));
  const rf = JSON.parse(readFileSync(new URL('flows.json', dir), 'utf8'));
  const real = createEngine({ network: rn, flows: rf, readSigns: mockReadSigns });
  const link = 'l2177124610_2190478926'; // Bourke Street 东行，两车道，17 点约 1300 veh/h
  ok(real.net.links.has(link) && real.net.links.get(link).name === 'Bourke Street', '真路网：加载 1513 个路段，演示路段 Bourke Street 东行在里面');
  const [ap] = affected(real.net, rf, { id: 'R', links: [link], closes: { lanes: 1 } }, WHEN, capFactors(real.net, [{ links: [link], closes: { lanes: 1 } }]));
  ok(ap && ap.alts.length >= 2 && ap.volume > 0, `真路网第 ① 步：${ap.alts.length} 条绕行（${ap.alts.map(r => r.name).join(' / ')}），受影响 ${ap.volume} veh/h`);
  const best = ap.alts[0].name.split(' ')[0].toUpperCase();
  const mk = fr => ({ id: 'R', links: [link], closes: { lanes: 1 }, time: { from: '2026-10-05', to: '2026-10-09', hours: [7, 19] },
    equipment: [{ id: 'vms1', type: 'vms', at_m: Math.round(ap.alts[0].diverge_m) + 100, frames: fr }] });
  const pPlan = { when: WHEN, worksites: [mk([['ROADWORK', 'AHEAD']])] }, nPlan = { when: WHEN, worksites: [mk([['USE', best.slice(0, 10), 'SAVE 3 MIN']])] };
  await real.prepare(pPlan); await real.prepare(nPlan);
  const t0 = performance.now();
  const p = real.evaluate(pPlan);
  const ms = performance.now() - t0;
  const n = real.evaluate(nPlan);
  ok(ms < 100 && p.links.length === rn.links.length, `真路网单次 evaluate ${ms.toFixed(1)} 毫秒（目标 < 100），结果覆盖全部 ${p.links.length} 个路段`);
  ok(p.delay_min > 0 && n.approaches[0].routes[1].share > p.approaches[0].routes[1].share && n.approaches[0].queue_m <= p.approaches[0].queue_m,
    `真路网第一幕：屏上点名 ${ap.alts[0].name}，它分到的车 ${p.approaches[0].routes[1].share} → ${n.approaches[0].routes[1].share}，排队 ${p.approaches[0].queue_m} → ${n.approaches[0].queue_m} 米`);
});

done();
