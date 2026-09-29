// 引擎单元测试（不依赖 api 模块，路人选择用假的 ask）：路网、最短路、BPR、第 ①②④⑤⑥ 步各自算得对
import { ok, t, done, wsA, wsB, WHEN } from './_t.mjs';
import {
  makeGrid, loadNetwork, shortestPath, linkTime, bearing, isActive, overlaps, capFactors, shiftWorksite, windowWhens, dayType,
  affected, buildCard, readSeconds, calibrate, makeAnchors, anchorCard, REF_CARD, evaluate, runScenario, conflictCost, applySuggestion,
} from '../public/js/index.js';

const { network, flows } = makeGrid();
const net = loadNetwork(network);
const TYPES = ['commuter', 'local', 'tourist', 'delivery'];
const MIX = { commuter: 0.5, local: 0.25, tourist: 0.1, delivery: 0.15 };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// 假的 ask：每类人都说「stay 占 1 − d，其余平分」；d 按屏上有没有 USE 定，锚点卡也走这套
function fakeAsk(dPlain = 0.2, dUse = 0.5, model = 'fake') {
  const fn = async card => {
    const text = card.signs.map(s => (s.frames || []).flat().join(' ') + ' ' + (s.text || '')).join(' ');
    const d = Math.min(0.95, (/\bUSE\b/.test(text) ? dUse : dPlain) + (card.queue_m > 0 ? 0.3 : 0)); // 看得到排队时多绕 0.3
    const alts = card.routes.filter(r => r.id !== 'stay');
    const by_type = {};
    for (const t of TYPES) {
      const share = {};
      for (const r of card.routes) share[r.id] = r.id === 'stay' ? 1 - d : d / alts.length;
      by_type[t] = { share, notice: 0.9, understand: 0.9, why: 'fake', lo: d, hi: d, src: 'llm' };
    }
    fn.calls++;
    return { src: 'llm', by_type, raw: {}, mix: MIX, model, prompt_v: 'p1' };
  };
  fn.calls = 0;
  return fn;
}

await t('grid', async () => {
  ok(network.nodes.length === 45 && network.links.length === 152, `方格路网 5 × 9：45 个节点、152 个有向路段（实际 ${network.nodes.length} / ${network.links.length}）`);
  const need = ['id', 'from', 'to', 'name', 'highway', 'len_m', 'lanes', 'speed_kmh', 'cap_vph', 't0_s', 'tram', 'bike_lane', 'osm_way', 'geometry'];
  ok(network.links.every(l => need.every(k => k in l)) && ['version', 'area', 'bbox', 'generated', 'sources', 'assumptions'].every(k => k in network), '路段和顶层字段齐全（docs/contract.md 路网数据文件 v1）');
  ok(network.links.every(l => flows.days.wd[l.id].length === 24 && flows.days.we[l.id].length === 24) && flows.unit === 'veh/h', 'flows：每个路段工作日 / 周末各 24 个小时值');
  ok(bearing(net, net.links.get('L-n0_6-n0_5')) === 'W' && bearing(net, net.links.get('L-n0_6-n1_6')) === 'S', '方向：La Trobe St 往西是 W，Russell St 往南是 S');
});

await t('shortest path & BPR', async () => {
  const p = shortestPath(net, 'n0_8', 'n0_3');
  ok(p && p.links.length === 5 && p.links.every(id => net.links.get(id).name === 'La Trobe St'), '最短路：Spring → Queen 沿 La Trobe St 走 5 段');
  const q = shortestPath(net, 'n0_8', 'n0_3', { banned: new Set(['L-n0_6-n0_5']) });
  ok(q && q.links.length === 7 && !q.links.includes('L-n0_6-n0_5'), '封掉一段后最短路绕 7 段');
  ok(JSON.stringify(shortestPath(net, 'n0_8', 'n0_3', { banned: new Set(['L-n0_6-n0_5']) })) === JSON.stringify(q), '同价路线选择确定（跑两次一样）');
  ok(linkTime(38, 0, 1800) === 38 && linkTime(38, 900, 1800) < linkTime(38, 1700, 1800), 'BPR：没车等于 t0，车越多越慢');
  ok(near(linkTime(38, 1000, 800) - linkTime(38, 800, 800), (200 * 3600) / 1600), '超过通行能力（D/D/1）：平均每辆多等 (v−c)·T/(2c) 秒，含小时末排队的清空时间');
  ok(linkTime(38, 10, 0) === Infinity && linkTime(38, 0, 0) === 38, '通行能力 0：有车就走不通，没车照常');
});

await t('worksite', async () => {
  const a = wsA();
  ok(isActive(a, WHEN) && !isActive(a, { date: '2026-10-06', hour: 20 }) && !isActive(a, { date: '2026-10-10', hour: 17 }), '施工按日期和小时生效');
  ok(overlaps(a, wsB()) && !overlaps(a, shiftWorksite(wsB(), 3)), '日期重叠判断；B 推迟 3 天就不重叠');
  const f = capFactors(net, [a]).get('L-n0_6-n0_5');
  ok(near(f.f, 0.45) && f.open === 1, '封 2 车道中的 1 条：通行能力 × 0.5 × 0.9（施工区摩擦）');
  ok(capFactors(net, [wsA([['X']], { closes: { lanes: 2 } })]).get('L-n0_6-n0_5').f === 0, '全封：通行能力 0');
  ok(dayType({ date: '2026-10-04' }) === 'we' && dayType({ date: '2026-10-06' }) === 'wd', '按日期算工作日 / 周末');
  ok(windowWhens([a, wsB()], [17]).length === 8, '两个施工的日期并集 × 17 点 = 8 个时刻');
});

await t('step 1: affected', async () => {
  const [ap] = affected(net, flows, wsA(), WHEN, capFactors(net, [wsA()]));
  ok(ap.street === 'La Trobe St' && ap.dir === 'W' && ap.to === 'Queen St' && ap.volume === 1100, `受影响：La Trobe St 西行 17 点 1100 veh/h，去 Queen St（实际 ${ap.volume}）`);
  ok(ap.alts.length === 3 && new Set(ap.alts.map(r => r.name)).size === 3 && ap.alts.some(r => r.name === 'Russell St'), `绕行 3 条、名字不重复、有 Russell St（${ap.alts.map(r => r.name).join(' / ')}）`);
  ok(ap.alts.every(r => !r.links.includes('L-n0_6-n0_5') && r.usual_min > ap.stay.usual_min), '绕行路线都不经过施工路段，平时都比原路慢');
  ok(ap.alts.find(r => r.name === 'Russell St').diverge_m === 0 && ap.alts.find(r => r.name === 'Spring St').diverge_m === 400, '拐出去的位置：Russell St 在施工起点、Spring St 在 400 米前');
  const [full] = affected(net, flows, wsA([['X']], { closes: { lanes: 2 } }), WHEN, capFactors(net, [wsA([['X']], { closes: { lanes: 2 } })]));
  ok(full.blocked && full.stay === null && full.alts.length > 0, '全封：没有原路选项，只有绕行');
});

await t('step 2: card', async () => {
  const [ap] = affected(net, flows, wsA([['USE', 'RUSSELL ST']]), WHEN);
  const c = buildCard(ap, wsA([['USE', 'RUSSELL ST']]), { queue_m: 437 });
  ok(c.trip.on === 'La Trobe St' && c.trip.dir === 'W' && c.trip.kmh === 40 && c.queue_m === 400, '场景卡：路名、方向、车速；排队按 100 米一档');
  ok(c.signs.length === 2 && c.signs[0].m === 300 && c.signs[0].kind === 'vms' && c.signs[0].read_s === 18 && c.signs[1].text === 'RIGHT LANE CLOSED', '标志按先远后近；屏在 40 km/h 下能读 18 秒');
  ok(readSeconds(40, 200) === 9, '字高 200 mm、40 km/h ≈ 9 秒（WA VMS 指南 §7.4 的例子）');
  ok(c.routes[0].id === 'stay' && c.routes.length === 4 && c.routes.every(r => typeof r.usual_min === 'number' && !('links' in r)), '路线：原路 + 3 条绕行，只给路名和平时分钟，不给路段');
  const w = wsA([['X']]); w.equipment[0].dir = 'E';
  ok(buildCard(ap, w).signs.length === 1, '朝另一个方向的屏，西行司机看不到');
  const many = wsA([['X']], { equipment: Array.from({ length: 10 }, (_, i) => ({ id: 's' + i, type: 'sign', at_m: 100 + i * 50, text: 'SIGN ' + i })) });
  const mc = buildCard(ap, many);
  ok(mc.signs.length === 6 && mc.signs[5].m === 100 && mc.signs[0].m === 350, '10 件标志只留离施工最近的 6 块（api 最多收 6 块），仍按先远后近');
});

await t('step 4: calibrate', async () => {
  const ask = fakeAsk(0.2, 0.5);
  const anc = makeAnchors(await ask(anchorCard('lo')), await ask(anchorCard('hi')));
  const mixOf = d => d; // 假 ask 里各类人表态一样（送货司机也「说」要走禁货车的 r2，靠校准挡住）
  ok(anc.method === 'two_point' && near(anc.lo.raw, mixOf(0.2)) && near(anc.hi.raw, mixOf(0.5)), '锚点：两块标准屏按车流占比加权的表态比例');
  const lo = calibrate(await ask(anchorCard('lo')), anc, anchorCard('lo'));
  const hi = calibrate(await ask(anchorCard('hi')), anc, anchorCard('hi'));
  ok(near(lo.detour, 0.03) && near(hi.detour, 0.2), `两点校准：ROADWORK AHEAD → 3%，USE RUSSELL ST → 20%（实际 ${lo.detour.toFixed(3)} / ${hi.detour.toFixed(3)}）`);
  const big = calibrate(await fakeAsk(0.95, 0.95)(REF_CARD), anc, REF_CARD);
  ok(near(big.detour, 0.35), `表态再高，全体绕行也封顶 35%（实际 ${big.detour.toFixed(3)}）`);
  ok(TYPES.every(t => near(Object.values(hi.by_type[t].share).reduce((a, b) => a + b, 0), 1)) && near(Object.values(hi.share).reduce((a, b) => a + b, 0), 1), '校准后每类人、全体的比例合计都是 1');
  ok(hi.by_type.delivery.share.r2 === 0 && hi.by_type.commuter.share.r2 > 0, '反向：表态里送货司机也要走禁货车的 r2，校准后是 0（通勤司机照走）');
  const onlyBanned = { ...REF_CARD, routes: [REF_CARD.routes[0], { ...REF_CARD.routes[2] }] };
  ok(calibrate(await ask(onlyBanned), anc, onlyBanned).by_type.delivery.share.stay === 1, '绕行路线全都禁货车：送货司机留在原路');
  const skew = { ...(await ask(REF_CARD)), mix: { commuter: 0.3, local: 0.7, tourist: 0, delivery: 0 } };
  skew.by_type = { ...skew.by_type, commuter: { ...skew.by_type.commuter, share: { stay: 0, r1: 0.5, r2: 0.5 } }, local: { ...skew.by_type.local, share: { stay: 0.9, r1: 0.05, r2: 0.05 } } };
  const sk = calibrate(skew, { ...anc, method: 'two_point', model: 'fake', lo: { raw: 0.1, real: 0.2 }, hi: { raw: 0.2, real: 0.3 }, cap: 0.9 }, REF_CARD);
  ok(near(sk.detour, 0.47, 1e-9) && sk.by_type.commuter.detour === 1, `有一类被截到 100% 时，截掉的量分给别的类，全体仍达到目标 0.47（实际 ${sk.detour.toFixed(3)}）`);
  const other = calibrate(await fakeAsk(0.2, 0.5, 'other-model')(REF_CARD), anc, REF_CARD);
  ok(other.method === 'ratio' && near(other.detour, mixOf(0.2) * 0.2), '回答和锚点不是同一个模型 → 退回「表态 × 1/5」');
  ok(hi.by_type.commuter.detour >= hi.by_type.delivery.detour, '各类人的相对高低沿用表态');
  const flat = makeAnchors(await fakeAsk(0.3, 0.3)(anchorCard('lo')), await fakeAsk(0.3, 0.3)(anchorCard('hi')));
  ok(flat.method === 'ratio', '两块标准屏表态几乎一样 → 退回比例法');
  const closedCard = { ...REF_CARD, routes: REF_CARD.routes.filter(r => r.id !== 'stay') };
  ok(calibrate(await ask(closedCard), anc, closedCard).method === 'forced', '全封（没有原路）不校准');
});

await t('step 5: evaluate & runScenario', async () => {
  const base = evaluate(net, flows, WHEN);
  ok(base.tt_s > 0 && base.blocked_vph === 0, '没有施工：全网总行程时间 > 0');
  const ask = fakeAsk(0.2, 0.5);
  const r = await runScenario({ network, flows, when: WHEN, worksites: [wsA()], ask });
  const a = r.approaches[0];
  ok(r.delay_min > 0 && a.queue_m > 0 && r.hot[0].name === 'La Trobe St', `封一条车道：总延误 ${r.delay_min} 车·分钟，排队 ${a.queue_m} 米，最堵的是 La Trobe St`);
  ok(a.rounds >= 1 && a.rounds <= 2 && r.rounds <= 2, `最多问 2 轮（实际 ${a.rounds}）`);
  ok(near(Object.values(a.share).reduce((x, y) => x + y, 0), 1, 1e-6) && a.routes.every(x => x.flow >= 0), '分流比例合计为 1');
  ok(TYPES.every(t => a.by_type[t] && typeof a.by_type[t].extra_min === 'number' && a.by_type[t].why === 'fake'), '每类人都有：比例、每辆车多花几分钟、一句理由');
  ok(a.card && a.card.signs.length === 2 && a.src === 'llm' && a.calib.method === 'two_point', '结果带上问的那张场景卡、来源、校准方法（界面能看校准前后）');
  const r2 = await runScenario({ network, flows, when: WHEN, worksites: [wsA()], ask });
  ok(JSON.stringify(r2) === JSON.stringify(r), '同样的输入跑两遍，结果完全一样');
  const off = await runScenario({ network, flows, when: { date: '2026-10-06', hour: 22 }, worksites: [wsA()], ask });
  ok(off.delay_min === 0 && off.approaches.length === 0, '施工时段之外（22 点）：没有影响');
  const night = await runScenario({ network, flows, when: { date: '2026-10-06', hour: 3 }, worksites: [wsA([['X']], { time: { from: '2026-10-05', to: '2026-10-09', hours: [0, 24] } })], ask });
  ok(night.approaches[0].rounds === 1 && night.approaches[0].queue_m === 0, '凌晨 3 点车少：第一轮看不到排队，不问第二轮');
  // 第 2 轮：卡上带着排队；分流 = 两轮校准后比例的平均（MSA）；报告的校准数字和分流一致
  ok(a.rounds === 2 && a.card.queue_m > 0, `第 2 轮的场景卡带着司机看到的排队（${a.card.queue_m} 米）`);
  const [q1, q2] = a.calib.per_round;
  ok(q1.queue_m === 0 && q2.queue_m === a.card.queue_m && q2.detour > q1.detour, `看到排队后绕得更多（第 1 轮 ${q1.detour} → 第 2 轮 ${q2.detour}）`);
  ok(near(1 - a.share.stay, (q1.detour + q2.detour) / 2, 0.002) && near(a.calib.detour, 1 - a.share.stay, 0.002), '分流取两轮平均；calib.detour 和实际分流一致');
  ok(!isActive(wsA(), { date: '2026-10-06', hour: 19 }) && isActive(wsA(), { date: '2026-10-06', hour: 18 }), '施工时段 [7, 19)：18 点生效、19 点不生效');
  const ev = evaluate(net, flows, WHEN, [wsA()], []);
  const x = ev.links.get('L-n0_6-n0_5');
  ok(near(x.queue_m, ((x.v - x.cap) * 7) / 2, 1e-6), '排队长度按上游整条路的车道数（2）折算');
  let threw = false;
  try { await runScenario({ network, flows, when: WHEN, worksites: [wsA()] }); } catch { threw = true; }
  ok(threw, '没传 ask 直接报错（不偷偷用假数据）');
});

await t('robustness', async () => {
  const ask = fakeAsk(0.2, 0.5);
  const one = await runScenario({ network, flows, when: WHEN, worksites: [wsA([['X']], { closes: { lanes: 2 } })], ask });
  const two = await runScenario({ network, flows, when: WHEN, worksites: [wsA([['X']]), { ...wsA([['X']]), id: 'A2' }], ask });
  ok(Math.abs(two.delay_min - one.delay_min) <= 0.05 * one.delay_min && two.delay_min > 0, `同一路段两个施工各封 1 条 ≈ 一个施工封 2 条（${two.delay_min} vs ${one.delay_min}），车不会凭空变多`);
  const line = { version: 1, nodes: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, lat: -37.81, lon: 144.95 + i * 0.002 })),
    links: [['a', 'b'], ['b', 'c'], ['c', 'd']].map(([f, t]) => ({ id: f + t, from: f, to: t, name: 'Only Rd', len_m: 200, lanes: 2, speed_kmh: 40, cap_vph: 1800, t0_s: 38 })) };
  const lineFlows = { days: { wd: { ab: Array(24).fill(1000), bc: Array(24).fill(1000), cd: Array(24).fill(1000) }, we: {} } };
  const dead = await runScenario({ network: line, flows: lineFlows, when: WHEN, worksites: [{ id: 'X', links: ['bc'], closes: { lanes: 2 }, time: wsA().time, equipment: [] }], ask });
  ok(dead.delay_min === 0 && dead.blocked_vph === 1000, `全封又无路可绕：车卡住（blocked ${dead.blocked_vph} veh/h），不会凭空消失成负延误（${dead.delay_min}）`);
  const boom = async card => { throw new Error('offline'); };
  let crashed = false;
  try { await runScenario({ network, flows, when: WHEN, worksites: [wsA()], ask: Object.assign(async (c, o) => (o?.force === 'rule' ? fakeAsk()(c) : boom(c)), {}) }); } catch { crashed = true; }
  ok(!crashed, 'ask 抛错 → 退回规则（force: rule），整个结果不崩');
  const nightWs = (id, links) => ({ id, links, closes: { lanes: 1 }, time: { from: '2026-10-05', to: '2026-10-09', hours: [20, 24] }, equipment: [] });
  ok(JSON.stringify(windowWhens([nightWs('N', ['L-n0_6-n0_5'])]).map(w => w.hour).filter((h, i, a) => a.indexOf(h) === i)) === '[21]', '夜间施工（20–24 点）的采样小时取时段中间（21 点），不是固定的 8、17 点');
  const year = { ...wsA(), time: { from: '2026-10-01', to: '2027-09-30', hours: [7, 19] } };
  let n = 0;
  const counting = async (c, o) => { n++; return fakeAsk()(c, o); };
  const c = await conflictCost({ network, flows, a: year, b: { ...wsB(), time: year.time }, ask: counting });
  ok(c.truncated && c.whens === 62 && n < 60, `一年的施工：只采样前 31 天 × 2 个小时（truncated），同一张卡只问一次（问了 ${n} 次）`);
});

await t('step 6: conflict', async () => {
  const ask = fakeAsk(0.2, 0.5);
  const c = await conflictCost({ network, flows, a: wsA(), b: wsB(), ask, hours: [17] });
  ok(c.overlap && c.cost > 0 && c.ab > c.a + c.b, `叠加：${c.a} + ${c.b} ≠ ${c.ab}，冲突成本 ${c.cost} 车·分钟`);
  const s = await conflictCost({ network, flows, a: wsA(), b: shiftWorksite(wsB(), 5), ask, hours: [17] });
  ok(!s.overlap && s.cost === 0, `错开日期：冲突成本正好是 0（实际 ${s.cost}）`);
});

await t('step 7: applySuggestion', async () => {
  const list = [wsA(), wsB()];
  const t1 = applySuggestion(list, { kind: 'text', worksite: 'A', equipment: 'vms1', frames: [['USE', 'RUSSELL ST']] });
  ok(t1[0].equipment[0].frames[0][0] === 'USE' && list[0].equipment[0].frames[0][0] === 'ROADWORK', '改字：生成新方案，不改原方案');
  ok(applySuggestion(list, { kind: 'move', worksite: 'A', equipment: 'vms1', at_m: 500 })[0].equipment[0].at_m === 500, '挪屏');
  ok(applySuggestion(list, { kind: 'shift', worksite: 'B', days: 5 })[1].time.from === '2026-10-12', '错开 5 天');
  ok(applySuggestion(list, { kind: 'text', worksite: 'Z', equipment: null, frames: [['X']] }) === null && applySuggestion(list, { kind: 'move', worksite: 'A', equipment: 'nope', at_m: 1 }) === null, '对不上的施工 / 设备 → null');
  ok(applySuggestion([wsB({ equipment: [] })], { kind: 'text', worksite: 'B', equipment: null, frames: [['USE', 'X']], at_m: 250 })[0].equipment[0].at_m === 250, '原来没有屏：按建议加一块');
});

done();
