// 端到端：引擎 + api 模块的 askPersonas / askAdvisor（MOCK：关键词规则）跑通 docs/arch/4-ai-flow.md 全流程，
// 并固定演示三幕（docs/2-plan.md）：① 改一句屏上的字排队变短 ② 两个施工叠加有冲突成本 ③ 错开日期冲突成本归零。
// 数字来自方格路网 + 规则估算，只断言方向和关系，不断言具体数值。
import { ok, t, done, wsA, wsB, WHEN } from './_t.mjs';
import { makeGrid, loadNetwork, runScenario, conflictCost, advise, shiftWorksite, affected, buildCard, capFactors } from '../public/js/index.js';
import { askPersonas, askAdvisor } from '../../api/public/js/persona.js';
import { validateCard } from '../../api/src/app.js';

const { network, flows } = makeGrid();
const net = loadNetwork(network);
const ask = (card, o) => askPersonas(card, { ...(o || {}), force: 'rule' });
const advisor = s => askAdvisor(s, { force: 'rule' });

await t('engine cards pass api validation', async () => {
  const cases = [wsA(), wsA([['USE', 'RUSSELL ST', 'SAVE 4 MIN']]), wsB(), wsA([['X']], { closes: { lanes: 2 } })];
  const cards = cases.flatMap(ws => affected(net, flows, ws, WHEN, capFactors(net, [ws])).map(ap => buildCard(ap, ws, { queue_m: 1234 })));
  const bad = cards.map(validateCard).filter(v => !v.ok);
  ok(cards.length === 4 && bad.length === 0, `引擎造的 ${cards.length} 张场景卡都通过 api 的 validateCard${bad.length ? '：' + JSON.stringify(bad[0].issues) : ''}`);
});

await t('act 1: one line of VMS text', async () => {
  const plain = await runScenario({ network: net, flows, when: WHEN, worksites: [wsA([['ROADWORK', 'AHEAD']])], ask });
  const named = await runScenario({ network: net, flows, when: WHEN, worksites: [wsA([['USE', 'RUSSELL ST', 'SAVE 4 MIN']])], ask });
  const p = plain.approaches[0], n = named.approaches[0];
  ok(n.queue_m < p.queue_m && named.delay_min < plain.delay_min,
    `第一幕：屏上从 ROADWORK AHEAD 改成 USE RUSSELL ST / SAVE 4 MIN，排队 ${p.queue_m} → ${n.queue_m} 米，总延误 ${plain.delay_min} → ${named.delay_min} 车·分钟`);
  ok(n.routes.find(r => r.name === 'Russell St').share > p.routes.find(r => r.name === 'Russell St').share, '被点名的 Russell St 分到的车变多');
  ok(p.src === 'rule' && p.calib.method === 'two_point' && p.calib.raw_detour > p.calib.detour, `MOCK：规则估算，两点校准把表态压下来（${p.calib.raw_detour} → ${p.calib.detour}）`);
  ok(Object.keys(n.by_type).length === 4 && n.by_type.commuter.detour > n.by_type.delivery.detour, '分人群：通勤司机比送货司机绕得多');
  ok(p.rounds === 2 && plain.hot[0].name === 'La Trobe St', '排队看得见 → 问了第 2 轮；最堵的是 La Trobe St');
});

await t('act 1 across the day', async () => {
  for (const when of [{ date: '2026-10-06', hour: 8 }, WHEN]) {
    const p = await runScenario({ network: net, flows, when, worksites: [wsA([['ROADWORK', 'AHEAD']])], ask });
    const n = await runScenario({ network: net, flows, when, worksites: [wsA([['USE', 'RUSSELL ST', 'SAVE 4 MIN']])], ask });
    ok(n.delay_min < p.delay_min && n.approaches[0].queue_m < p.approaches[0].queue_m, `${when.hour} 点高峰：点名 Russell St 后延误 ${p.delay_min} → ${n.delay_min}、排队 ${p.approaches[0].queue_m} → ${n.approaches[0].queue_m} 米`);
  }
  const noon = { date: '2026-10-06', hour: 12 };
  const p12 = await runScenario({ network: net, flows, when: noon, worksites: [wsA([['ROADWORK', 'AHEAD']])], ask });
  ok(p12.approaches[0].queue_m === 0, '中午不堵：没有排队（这时劝人绕路只会更慢，是真实效果，不是 bug）');
  const adv = await advise({ network: net, flows, when: noon, worksites: [wsA([['ROADWORK', 'AHEAD']], { time: { from: '2026-10-05', to: '2026-10-09', hours: [11, 14] } })], ask, askAdvisor: advisor });
  ok(!adv.options.some(o => o.suggestion.kind === 'text'), '中午绕行并不更快：规则顾问不再建议「改字劝人绕」');
  ok(adv.options.every(o => o.skipped || o.better === (o.delta_min < 0)), '每个改法都标了 better（引擎重算后真变好才算）');
});

await t('sign position matters (turn_m)', async () => {
  const late = wsA([['USE', 'SPRING ST']]); // Spring St 在施工前 400 米拐，屏只在 300 米：看到时已经拐不过去
  late.equipment[0].at_m = 300;
  const early = wsA([['USE', 'SPRING ST']]);
  early.equipment[0].at_m = 500;
  const a = (await runScenario({ network: net, flows, when: WHEN, worksites: [late], ask })).approaches[0];
  const b = (await runScenario({ network: net, flows, when: WHEN, worksites: [early], ask })).approaches[0];
  const sp = x => x.routes.find(r => r.name === 'Spring St').share;
  ok(a.card.routes.find(r => r.name === 'Spring St').turn_m === 400, '场景卡带上每条绕行路线在施工前多少米拐（turn_m）');
  ok(sp(b) > sp(a), `屏摆在拐口之后不起作用：屏在 300 米时 Spring St 分到 ${sp(a)}，挪到 500 米后 ${sp(b)}`);
});

await t('act 2 and 3: two worksites', async () => {
  const a = wsA([['USE', 'RUSSELL ST', 'SAVE 4 MIN']]);
  const c = await conflictCost({ network: net, flows, a, b: wsB(), ask, hours: [17] });
  ok(c.overlap && c.cost > 0 && c.cost < 10 * (c.a + c.b), `第二幕（A 屏上点名 Russell St，绕行正好经过 B）：A ${c.a} + B ${c.b} ≠ A+B ${c.ab}，冲突成本 ${c.cost} 车·分钟（${c.whens} 个时刻；上限 10 倍防离谱）`);
  const s = await conflictCost({ network: net, flows, a, b: shiftWorksite(wsB(), 5), ask, hours: [17] });
  ok(!s.overlap && s.cost === 0, `第三幕：B 推迟 5 天，冲突成本 ${s.cost}`);
});

await t('step 7: advisor re-runs every suggestion', async () => {
  const res = await advise({ network: net, flows, when: WHEN, worksites: [wsA(), wsB()], ask, askAdvisor: advisor, hours: [17] });
  ok(res.src === 'rule' && res.options.length >= 2 && res.options.length <= 3, `规划顾问（规则版）给出 ${res.options.length} 个改法：${res.options.map(o => o.suggestion.kind).join(' / ')}`);
  ok(res.options.every(o => Number.isFinite(o.delay_min) && Number.isFinite(o.delta_min) && o.result), '每个改法都由引擎重算：有前后对比的总延误');
  const shift = res.options.find(o => o.suggestion.kind === 'shift');
  const text = res.options.find(o => o.suggestion.kind === 'text');
  ok(shift && shift.better && text && text.better, `错开日期、改屏上的字都让整段时间的总延误下降（${shift?.delta_min} / ${text?.delta_min} 车·分钟）`);
  const c = await conflictCost({ network: net, flows, a: wsA(), b: wsB(), ask, whens: res.whens ? undefined : undefined, hours: [17] });
  ok(Math.abs(-shift.delta_min - c.cost) <= Math.max(5, 0.05 * c.cost), `错开日期的好处 ≈ 冲突成本（${-shift.delta_min} vs ${c.cost}）：改前改后用同一段时间比，挪出去的那几天也算`);
});

done();
