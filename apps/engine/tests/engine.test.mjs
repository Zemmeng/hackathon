// 引擎单元测试（D-0929-1435 版）：路网、最短路、BPR、施工时段、第 ① 步绕行、第 ② 步读数请求、第 ④ 步选择模型 + 两点校准、
// evaluate / window / conflict、顾问改法。读数用引擎自带的 MOCK 读数器或假读数，不依赖 api 模块。
import { ok, t, done, wsA, wsB, WHEN } from './_t.mjs';
import {
  makeGrid, loadNetwork, shortestPath, linkTime, bearing, isActive, overlaps, capFactors, shiftWorksite, windowWhens, dayType,
  affected, requestsFor, readSeconds, chooseShares, informed, PERSONAS, TYPES, MIX, calibrate, anchorRequest, createEngine,
  mockReadSigns, applySuggestion, checkSuggestion, mockAdvise,
} from '../public/js/index.js';

const { network, flows } = makeGrid();
const net = loadNetwork(network);
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const counting = () => { const f = async req => { f.n++; return mockReadSigns(req); }; f.n = 0; return f; };

await t('grid, paths, BPR, worksite time', async () => {
  ok(network.nodes.length === 45 && network.links.length === 152, '方格路网 5 × 9：45 个节点、152 个有向路段');
  const need = ['id', 'from', 'to', 'name', 'highway', 'len_m', 'lanes', 'speed_kmh', 'cap_vph', 't0_s', 'tram', 'bike_lane', 'osm_way', 'geometry'];
  ok(network.links.every(l => need.every(k => k in l)) && network.links.every(l => flows.days.wd[l.id].length === 24), '字段齐全（契约「路网数据文件」），每段 24 小时车流');
  ok(bearing(net, net.links.get('L-n0_6-n0_5')) === 'W', '方向：La Trobe St 往西是 W');
  const p = shortestPath(net, 'n0_8', 'n0_3'), q = shortestPath(net, 'n0_8', 'n0_3', { banned: new Set(['L-n0_6-n0_5']) });
  ok(p.links.length === 5 && q.links.length === 7 && JSON.stringify(q) === JSON.stringify(shortestPath(net, 'n0_8', 'n0_3', { banned: new Set(['L-n0_6-n0_5']) })), '最短路：直走 5 段，封一段后绕 7 段；同价路线选择确定');
  ok(linkTime(38, 0, 1800) === 38 && near(linkTime(38, 1000, 800) - linkTime(38, 800, 800), (200 * 3600) / 1600), 'BPR；超过通行能力按 D/D/1：平均多等 (v−c)T/(2c)（含清空）');
  const a = wsA();
  ok(isActive(a, WHEN) && !isActive(a, { date: '2026-10-06', hour: 19 }) && isActive(a, { date: '2026-10-06', hour: 18 }), '施工时段 [7, 19)：18 点生效、19 点不生效');
  ok(overlaps(a, wsB()) && !overlaps(a, shiftWorksite(wsB(), 3)) && dayType({ date: '2026-10-04' }) === 'we', '日期重叠；推迟 3 天不重叠；周日算周末');
  ok(near(capFactors(net, [a]).get('L-n0_6-n0_5').f, 0.45), '封 2 车道中的 1 条：通行能力 × 0.5 × 0.9');
  const night = { id: 'N', links: ['L-n0_6-n0_5'], closes: { lanes: 1 }, time: { from: '2026-10-05', to: '2026-10-09', hours: [20, 24] }, equipment: [] };
  ok(JSON.stringify([...new Set(windowWhens([night]).map(w => w.hour))]) === '[21]', '夜间施工的采样小时取时段中间（21 点），不是固定 8、17 点');
  const year = { ...a, time: { from: '2026-10-01', to: '2027-09-30', hours: [7, 19] } };
  const W = windowWhens([year]);
  ok(W.truncated && W.length === 62, '一年的施工：只采样前 31 天 × 2 个小时，标 truncated');
});

await t('step 1-2: detours and reading requests', async () => {
  const [ap] = affected(net, flows, wsA(), WHEN, capFactors(net, [wsA()]));
  ok(ap.street === 'La Trobe St' && ap.dir === 'W' && ap.to === 'Queen St' && ap.volume === 1100, '受影响：La Trobe St 西行 17 点 1100 veh/h');
  ok(ap.alts.map(r => r.name).sort().join() === 'Exhibition St,Russell St,Spring St' && ap.alts.every(r => !r.links.includes('L-n0_6-n0_5')), '3 条绕行（按拐进去的街起名），都不经过施工路段');
  ok(ap.alts.find(r => r.name === 'Spring St').diverge_m === 400 && ap.alts.find(r => r.name === 'Russell St').diverge_m === 0, '拐口位置：Russell 在施工起点、Spring 在 400 米前');
  const reqs = requestsFor(ap, wsA([['USE', 'SPRING ST']]), TYPES);
  const f = reqs.full.commuter;
  ok(f.persona === 'commuter' && f.kmh === 40 && f.signs.length === 2 && f.signs[0].kind === 'vms' && f.signs[0].read_s === readSeconds(40, 320) && !('m' in f.signs[0]), '读数请求：按经过顺序的标志、能读几秒；位置不交出去（契约 §路人读数）');
  ok(f.roads[0] === 'La Trobe St' && f.roads.length === 4, 'roads = 当前路 + 候选绕行路');
  const spring = ap.alts.find(r => r.name === 'Spring St').id, russell = ap.alts.find(r => r.name === 'Russell St').id;
  ok(reqs.prefix.commuter[spring] === null && reqs.prefix.commuter[russell].signs.length === 2, '屏在 300 米、Spring 在 400 米拐：拐口之前看不到任何标志（没有 prefix 请求）；Russell 在施工起点拐：两块都看得到');
  const many = wsA([['X']], { equipment: Array.from({ length: 10 }, (_, i) => ({ id: 's' + i, type: 'sign', at_m: 100 + i * 50, text: 'SIGN ' + i })) });
  ok(requestsFor(ap, many, ['commuter']).full.commuter.signs.length === 6, '10 件标志只留离施工最近的 6 块');
  const line = { version: 1, nodes: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, lat: -37.81, lon: 144.95 + i * 0.002 })),
    links: [['a', 'b'], ['b', 'c'], ['c', 'd']].map(([x, y]) => ({ id: x + y, from: x, to: y, name: null, len_m: 200, lanes: 2, speed_kmh: 40, cap_vph: 1800, t0_s: 38 })) };
  const [lap] = affected(loadNetwork(line), null, { id: 'X', links: ['bc'], closes: { lanes: 1 } }, WHEN);
  ok(lap.street === 'Unnamed road' && lap.stayLinks.length === 3, '没路名的路段也能连成一段（真路网里有 193 段没路名）');
});

await t('step 4: choice model', async () => {
  const routes = [{ id: 'stay', usual_min: 6 }, { id: 'r1', usual_min: 8 }, { id: 'r2', usual_min: 9, truck: false }];
  const none = { use: new Set(), avoid: new Set(), saving_min: 0, delay_min: 0 };
  const told = { use: new Set(['r1']), avoid: new Set(), saving_min: 0, delay_min: 0 };
  const c = PERSONAS.commuter, ctx = { A: 3, B: 3, I: 0.6, queue_m: 0 };
  const sum = s => Object.values(s).reduce((a, b) => a + b, 0);
  ok(near(sum(chooseShares(c, routes, told, ctx)), 1) && near(sum(chooseShares(PERSONAS.delivery, routes, none, ctx)), 1), '比例合计为 1');
  ok(chooseShares(c, routes, told, ctx).r1 > chooseShares(c, routes, none, ctx).r1, '屏上叫走 r1 → r1 的比例上升');
  ok(chooseShares(c, routes, told, { ...ctx, I: 0 }).r1 === chooseShares(c, routes, none, { ...ctx, I: 0 }).r1, '没人被说动（I = 0）时屏上写什么都一样');
  ok(chooseShares(c, routes, { ...told, saving_min: 8 }, ctx).r1 > chooseShares(c, routes, { ...told, saving_min: 2 }, ctx).r1, '说省 8 分钟比省 2 分钟绕得多');
  ok(chooseShares(c, routes, none, { ...ctx, queue_m: 1000 }).stay < chooseShares(c, routes, none, ctx).stay, '看到前面排 1 公里 → 留在原路的少了');
  const dTold = { use: new Set(['r2']), avoid: new Set(), saving_min: 5, delay_min: 0 };
  ok(chooseShares(PERSONAS.delivery, routes, dTold, ctx).r2 === 0 && chooseShares(c, routes, dTold, ctx).r2 > 0, '反向：屏上叫走禁货车的 r2，送货司机仍是 0（通勤司机会去）');
  ok(chooseShares(c, routes, { ...none, avoid: new Set(['stay']) }, ctx).stay < chooseShares(c, routes, none, ctx).stay, '屏上叫别走原路 → 原路的少了');
  ok(near(informed(c, { notice: 0.9, understand: 0.8, trust: 0.5 }), 0.36) && informed(c, null) === 0, '被说动 = 看到 × 看懂 × 相信（× 这类人对屏的信任）；没读数 = 0');
});

await t('step 4: two-point calibration', async () => {
  const read = async which => Object.fromEntries(await Promise.all(TYPES.map(async p => [p, await mockReadSigns(anchorRequest(which, p))])));
  const cal = calibrate(await read('lo'), await read('hi'));
  ok(cal.method === 'two_point' && cal.ok && near(cal.lo_detour, 0.03, 1e-3) && near(cal.hi_detour, 0.2, 1e-3), `两点校准：ROADWORK AHEAD → 3%、USE RUSSELL ST → 20%（A ${cal.A}、B ${cal.B}）`);
  ok(calibrate(null, null).method === 'default', '缺锚点读数 → 用默认参数，method = default');
  const flat = await read('lo');
  ok(calibrate(flat, flat).ok === false, '两块屏读起来一样（都没点名路）→ 推荐力度到上限也到不了 20%，ok = false');
});

await t('evaluate', async () => {
  const eng = createEngine({ network, flows, readSigns: mockReadSigns });
  const plan = { when: WHEN, worksites: [wsA()] };
  const fresh = createEngine({ network, flows, readSigns: mockReadSigns });
  ok(fresh.evaluate(plan).missing > 0, 'prepare 之前 evaluate：读数缺几条就报几条（missing）');
  const prep = await eng.prepare(plan);
  ok(prep.asked === 16 && prep.failed === 0 && prep.calib.method === 'two_point', `prepare：锚点 8 条 + 这段路 8 条读数（实际 ${prep.asked}）`);
  const again = await eng.prepare(plan);
  ok(again.asked === 0, '同一句话每类人只问一次，缓存一直有效');
  const r = eng.evaluate(plan);
  ok(r.missing === 0 && r.delay_min > 0 && r.approaches[0].queue_m > 0 && r.hot[0].name === 'La Trobe St', `封一条车道：总延误 ${r.delay_min} 车·分钟，排队 ${r.approaches[0].queue_m} 米`);
  ok(JSON.stringify(eng.evaluate(plan, { seed: 1 })) === JSON.stringify(r), '同样的输入跑两遍结果完全一样');
  ok(r.links.length === 152 && r.links.every(l => 'v' in l && 'delay_s' in l && 'queue_m' in l), '每个路段都有流量 / 延误 / 排队');
  const typed = TYPES.reduce((s, x) => s + r.by_type[x].delay_min, 0);
  ok(Math.abs(typed + r.others_min - r.delay_min) <= 4 && TYPES.every(x => r.by_type[x].per_capita_min > 0), '每类人的总延误 + 背景车流 = 全网总延误；人均延误 > 0');
  const a = r.approaches[0];
  ok(TYPES.every(x => a.by_type[x].reading && a.by_type[x].reading.src === 'rule' && typeof a.by_type[x].informed === 'number'), '每类人带上读数（看到、看懂、信不信、一句理由）和被说动的比例');
  ok(near(Object.values(a.share).reduce((s, v) => s + v, 0), 1, 0.01), '分流比例合计为 1');
  ok(eng.evaluate({ when: { date: '2026-10-06', hour: 22 }, worksites: [wsA()] }).delay_min === 0, '施工时段之外：没有影响');
  const one = eng, twoPlan = { when: WHEN, worksites: [wsA([['X']]), { ...wsA([['X']]), id: 'A2' }] }, onePlan = { when: WHEN, worksites: [wsA([['X']], { closes: { lanes: 2 } })] };
  await one.prepare(twoPlan); await one.prepare(onePlan);
  const d2 = one.evaluate(twoPlan).delay_min, d1 = one.evaluate(onePlan).delay_min;
  ok(Math.abs(d2 - d1) <= 0.05 * d1, `同一路段两个施工各封 1 条 ≈ 一个施工封 2 条（${d2} vs ${d1}），车不会凭空变多`);
  const line = { version: 1, nodes: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, lat: -37.81, lon: 144.95 + i * 0.002 })),
    links: [['a', 'b'], ['b', 'c'], ['c', 'd']].map(([x, y]) => ({ id: x + y, from: x, to: y, name: 'Only Rd', len_m: 200, lanes: 2, speed_kmh: 40, cap_vph: 1800, t0_s: 38 })) };
  const lf = { days: { wd: { ab: Array(24).fill(1000), bc: Array(24).fill(1000), cd: Array(24).fill(1000) }, we: {} } };
  const le = createEngine({ network: line, flows: lf, readSigns: mockReadSigns });
  const dead = { when: WHEN, worksites: [{ id: 'X', links: ['bc'], closes: { lanes: 2 }, time: wsA().time, equipment: [] }] };
  await le.prepare(dead);
  const dr = le.evaluate(dead);
  ok(dr.delay_min === 0 && dr.blocked_vph === 1000, `全封又无路可绕：车卡住（blocked ${dr.blocked_vph}），不会凭空消失`);
  const flaky = createEngine({ network, flows, readSigns: async () => { throw new Error('offline'); } });
  const fp = await flaky.prepare(plan);
  ok(fp.failed === fp.asked && flaky.evaluate(plan).approaches[0].by_type.commuter.informed === 0 && flaky.calib.method === 'default', 'readSigns 全挂：不崩，没人被说动、用默认参数，界面按 missing 提示');
});

await t('conflict and window', async () => {
  const eng = createEngine({ network, flows, readSigns: mockReadSigns });
  const a = wsA([['USE', 'RUSSELL ST', 'SAVE 4 MIN']]), b = wsB();
  const W = windowWhens([a, b], [17]);
  await eng.prepare({ when: WHEN, worksites: [a, b] }, { whens: W });
  const c = eng.conflict(a, b, { hours: [17] });
  ok(c.overlap && c.cost > 0 && c.ab > c.a + c.b, `叠加：${c.a} + ${c.b} ≠ ${c.ab}，冲突成本 ${c.cost}`);
  const bs = shiftWorksite(b, 5);
  await eng.prepare({ when: WHEN, worksites: [a, bs] }, { whens: windowWhens([a, bs], [17]) });
  const s = eng.conflict(a, bs, { hours: [17] });
  ok(!s.overlap && s.cost === 0, `错开日期：冲突成本正好是 0（实际 ${s.cost}）`);
});

await t('advisor pieces', async () => {
  const list = [wsA(), wsB()];
  ok(applySuggestion(list, { kind: 'text', worksite: 'A', equipment: 'vms1', frames: [['USE', 'RUSSELL ST']] })[0].equipment[0].frames[0][0] === 'USE' && list[0].equipment[0].frames[0][0] === 'ROADWORK', '改字：生成新方案，不改原方案');
  ok(applySuggestion(list, { kind: 'move', worksite: 'A', equipment: 'vms1', at_m: 500 })[0].equipment[0].at_m === 500 && applySuggestion(list, { kind: 'shift', worksite: 'B', days: 5 })[1].time.from === '2026-10-12', '挪屏、错开 5 天');
  ok(applySuggestion(list, { kind: 'move', worksite: 'A', equipment: 'nope', at_m: 1 }) === null && applySuggestion([{ ...wsA(), time: undefined }], { kind: 'shift', worksite: 'A', days: 3 }) === null, '对不上的设备、没有时段的施工 → null');
  ok(!checkSuggestion({ kind: 'move', worksite: '<img>', equipment: 'v', at_m: 1 }) && !checkSuggestion({ kind: 'text', worksite: 'A', equipment: null, frames: [['TOO LONG LINE']] }) && checkSuggestion({ kind: 'shift', worksite: 'B', days: 3 }), '建议校验：id 带 HTML、一行超 10 字符都不过');
  const summary = { worksites: [{ ...wsA(), equipment: [{ id: 'vms1', type: 'vms', at_m: 100, frames: [['ROADWORK', 'AHEAD']] }] }, wsB()],
    approaches: [{ worksite: 'A', dir: 'W', delay_min: 400, routes: [{ id: 'stay', name: 'La Trobe St', now_min: 10 }, { id: 'r1', name: 'Exhibition St', now_min: 7, turn_m: 200 }] }],
    conflicts: [{ a: 'A', b: 'B', cost_min: 120 }] };
  const m = await mockAdvise(summary);
  ok(m.suggestions.map(s => s.kind).join() === 'text,move,shift' && m.suggestions.every(checkSuggestion), 'MOCK 顾问：改字 · 挪屏（屏在拐口之后）· 错开');
  const calm = { ...summary, approaches: [{ ...summary.approaches[0], routes: [{ id: 'stay', name: 'La Trobe St', now_min: 3 }, summary.approaches[0].routes[1]] }] };
  ok(!(await mockAdvise(calm)).suggestions.some(s => s.kind === 'text'), '不堵时（原路更快）不建议改字劝人绕');
});

await t('readings are cached per request', async () => {
  const rs = counting();
  const eng = createEngine({ network, flows, readSigns: rs });
  const W = windowWhens([wsA(), wsB()], [8, 17]);
  await eng.prepare({ when: WHEN, worksites: [wsA(), wsB()] }, { whens: W });
  const n1 = rs.n;
  eng.conflict(wsA(), wsB(), { whens: W });
  ok(n1 <= 40 && rs.n === n1, `一段时间 ${W.length} 个时刻的冲突对比只问了 ${n1} 条读数；evaluate 本身不再问`);
});

done();
