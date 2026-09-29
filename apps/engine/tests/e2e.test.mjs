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

await t('act 2 and 3: two worksites', async () => {
  const a = wsA([['USE', 'RUSSELL ST', 'SAVE 4 MIN']]);
  const c = await conflictCost({ network: net, flows, a, b: wsB(), ask, hours: [17] });
  ok(c.overlap && c.cost > 0, `第二幕：A ${c.a} + B ${c.b} ≠ A+B ${c.ab}，冲突成本 ${c.cost} 车·分钟（${c.whens} 个时刻）`);
  const s = await conflictCost({ network: net, flows, a, b: shiftWorksite(wsB(), 5), ask, hours: [17] });
  ok(!s.overlap && s.cost === 0, `第三幕：B 推迟 5 天，冲突成本 ${s.cost}`);
});

await t('step 7: advisor re-runs every suggestion', async () => {
  const res = await advise({ network: net, flows, when: WHEN, worksites: [wsA(), wsB()], ask, askAdvisor: advisor, hours: [17] });
  ok(res.src === 'rule' && res.options.length >= 2 && res.options.length <= 3, `规划顾问（规则版）给出 ${res.options.length} 个改法：${res.options.map(o => o.suggestion.kind).join(' / ')}`);
  ok(res.options.every(o => Number.isFinite(o.delay_min) && Number.isFinite(o.delta_min) && o.result), '每个改法都由引擎重算：有前后对比的总延误');
  const shift = res.options.find(o => o.suggestion.kind === 'shift');
  const text = res.options.find(o => o.suggestion.kind === 'text');
  ok(shift && shift.delta_min < 0 && text && text.delta_min < 0, `错开日期、改屏上的字都让整段时间的总延误下降（${shift?.delta_min} / ${text?.delta_min} 车·分钟）`);
});

done();
