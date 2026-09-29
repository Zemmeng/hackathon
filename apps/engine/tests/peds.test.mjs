// T17 封人行道 → 行人绕行（peds.js + backend.js 的 summary.peds）。用仓库里 T3 的真文件 walk.json / peds.json / network.json，不联网
import { readFileSync, existsSync } from 'node:fs';
import { ok, t, done } from './_t.mjs';
import { connect, demoPlan, PATHS } from '../public/js/backend.js';
import { pedImpact, WALK_MPS, validatePlan, validateWorksite, loadNetwork, footpathOf, MIN_REACH } from '../public/js/index.js';

const APPS = new URL('../../', import.meta.url);
const file = p => new URL('.' + p, APPS);
for (const p of [PATHS.network, PATHS.walk, PATHS.peds]) if (!existsSync(file(p))) { ok(false, `找不到 apps${p}`); done(); }
const J = p => JSON.parse(readFileSync(file(p), 'utf8'));
const walk = J(PATHS.walk), peds = J(PATHS.peds), network = J(PATHS.network), net = loadNetwork(network);
const wl = new Map(walk.links.map(l => [l.id, l]));
const fakeFetch = async url => (existsSync(file(url)) ? { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file(url), 'utf8')) } : { ok: false, status: 404 });
const noPedsFetch = async url => (url.includes('/walk.json') || url.includes('/peds.json') ? { ok: false, status: 404 } : fakeFetch(url));
const noImporter = async url => { throw new Error('404 ' + url); };
const withFp = (name, fp, o) => { const p = demoPlan(name, o); if (fp !== undefined) p.worksites[0].closes.footpath = fp; return p; };
const LON = 'l595594354_9756035316';
const ZERO = s => s.closed.length === 0 && s.closed_m === 0 && s.ped_h === 0 && s.detour_m === 0 && s.extra_min === 0 && s.crossings === 0 && s.blocked === false && s.detour.length === 0 && s.sensor === null;

await t('主演示 Lonsdale St 西行 8 点，封左侧人行道', async () => {
  const r = pedImpact(walk, peds, withFp('lonsdale', 'left'), { net });
  ok(r.src === 'peds' && r.footpath === 'left' && r.active && r.day === 'wd' && r.hour === 8, `src = peds、footpath = left、周二 = wd、8 点`);
  ok(r.closed.length > 0 && r.closed.every(id => wl.get(id)?.road_link === LON && wl.get(id).side === 'left' && ['sidewalk', 'other', 'path'].includes(wl.get(id).kind)),
    `封掉 ${r.closed.length} 段人行道（${r.closed_m} 米），都挂在施工路段、side = left、不是过街`);
  const maxV = Math.max(...r.closed.map(id => peds.days.wd[id][8]));
  ok(r.ped_h > 0 && r.ped_h === maxV, `ped_h = 封掉的人行道里 8 点人最多的那条 = ${r.ped_h} 人/小时（peds.json）`);
  ok(r.detour_m > 0 && r.extra_min > 0 && Math.abs(r.extra_min - (r.ped_h * r.detour_m) / (WALK_MPS * 60)) < 0.2,
    `每人多走 ${r.detour_m} 米 → 多花 ${r.extra_min} 人·分钟（= ped_h × detour_m ÷ (${WALK_MPS} × 60)）`);
  const closed = new Set(r.closed);
  ok(r.detour.length > 0 && r.detour.every(id => !closed.has(id) && wl.has(id)), `绕行路线 ${r.detour.length} 段，一段都不经过封掉的人行道（反向断言）`);
  ok(Number.isInteger(r.crossings) && r.crossings === r.detour.filter(id => wl.get(id).kind === 'crossing' || wl.get(id).crossing != null).length && r.crossings >= 1, `绕到对面要过 ${r.crossings} 次马路`);
  ok(r.step_free === null && r.assumed.walk_mps === WALK_MPS && /step/i.test(r.assumed.note), 'walk.json 没有台阶数据：step_free = null，assumed 里写明步速和原因（不许声称无障碍）');
  ok(r.measured === r.closed.some(id => peds.method[id] === 'sensor') && (r.sensor === null || (typeof r.sensor.name === 'string' && r.sensor.ped_h >= 0)),
    `measured = ${r.measured}（${peds.method[r.closed[0]]}）；最近的真计数器 ${r.sensor ? `${r.sensor.name} ${r.sensor.ped_h} 人/小时、${r.sensor.dist_m} 米` : '无'}`);
  const again = pedImpact(walk, peds, withFp('lonsdale', 'left'), { net });
  ok(JSON.stringify(again) === JSON.stringify(r), '同样输入同样结果');
});

await t('左 / 右 / 两侧', async () => {
  const L = pedImpact(walk, peds, withFp('lonsdale', 'left'), { net });
  const R = pedImpact(walk, peds, withFp('lonsdale', 'right'), { net });
  const B = pedImpact(walk, peds, withFp('lonsdale', 'both'), { net });
  ok(R.closed.length > 0 && R.closed.every(id => !L.closed.includes(id)), `右侧（双幅路：挂在对面东行那幅路上）封 ${R.closed.length} 段，和左侧不重叠`);
  ok(B.closed.length === L.closed.length + R.closed.length && B.ped_h === L.ped_h + R.ped_h && B.stretches.length === 2, `两侧都封 = 左 + 右（两拨人 ${B.ped_h} 人/小时）`);
  ok(B.detour_m >= Math.min(L.detour_m, R.detour_m) && B.detour.every(id => !B.closed.includes(id)), `两侧都封：不能过马路绕到对面，每人多走 ${B.detour_m} 米（单侧 ${L.detour_m} / ${R.detour_m}）`);
  const lat = pedImpact(walk, peds, withFp('latrobe', 'right'), { net });
  ok(lat.measured === lat.closed.some(id => peds.method[id] === 'sensor') && lat.measured, `La Trobe 西行右侧：封掉的人行道里有真计数器的那条 → measured = true`);
});

await t('没封人行道、不在施工时段 → 全是 0（反向断言）', async () => {
  const none = pedImpact(walk, peds, withFp('lonsdale', undefined), { net });
  ok(none.src === 'peds' && none.footpath === 'none' && !none.active && ZERO(none), 'closes.footpath 不写 → 行人影响全 0');
  const nil = pedImpact(walk, peds, withFp('lonsdale', 'none'), { net });
  ok(nil.footpath === 'none' && ZERO(nil), "footpath = 'none' 也当没封");
  const late = pedImpact(walk, peds, withFp('lonsdale', 'left', { hour: 22 }), { net });
  ok(late.footpath === 'left' && !late.active && late.hour === 22 && ZERO(late), '晚上 10 点不施工（时段 7–19 点）→ 全 0，footpath 仍报 left');
  const we = withFp('lonsdale', 'left'); we.when = { date: '2026-10-10', hour: 8 };
  const wk = pedImpact(walk, peds, we, { net });
  ok(!wk.active && ZERO(wk), '10/10 周六不在施工日期内 → 全 0');
  const weP = withFp('lonsdale', 'left'); weP.when = { date: '2026-10-06', hour: 8, day: 'we' };
  const wd = pedImpact(walk, peds, weP, { net });
  ok(wd.day === 'we' && wd.ped_h === Math.max(...wd.closed.map(id => peds.days.we[id][8])), `when.day = we → 用周末的人流（${wd.ped_h} 人/小时）`);
});

await t('方案校验：footpath 只认 left / right / both', async () => {
  for (const v of ['left', 'right', 'both', 'none', null, undefined]) {
    const p = withFp('lonsdale', v);
    ok(validatePlan(p).length === 0, `footpath = ${JSON.stringify(v)} 合格`);
  }
  for (const v of ['LEFT', 'north', 1, true, ['left']]) {
    const errs = validatePlan(withFp('lonsdale', v));
    ok(errs.length === 1 && errs[0].includes('footpath'), `footpath = ${JSON.stringify(v)} → 校验报错（反向断言）`);
  }
  ok(validateWorksite({ id: 'X', closes: { lanes: 1 } }).some(e => e.includes('links')) && validatePlan({ when: {} }).length === 1, '缺 links / 缺 worksites 也报');
  ok(footpathOf({ closes: { footpath: 'both' } }) === 'both' && footpathOf({ closes: { footpath: 'x' } }) === 'none' && footpathOf({}) === 'none', 'footpathOf：不认的值当没封');
  let threw = null;
  try { pedImpact(walk, peds, withFp('lonsdale', 'north'), { net }); } catch (e) { threw = e; }
  ok(threw && /footpath/.test(threw.message), '直接调 pedImpact 写错 footpath 也抛');
  const be = await connect({ fetch: fakeFetch, importer: noImporter });
  let err = null;
  try { await be.run(withFp('lonsdale', 'LEFT')); } catch (e) { err = e; }
  ok(err && err.code === 'bad_plan' && err.errors.length === 1 && be.validate(withFp('lonsdale', 'LEFT')).length === 1, 'backend.run 写错 footpath → 抛 code = bad_plan（页面可先调 be.validate）');
  let aerr = null;
  try { await be.advise(withFp('lonsdale', 'sideways')); } catch (e) { aerr = e; }
  ok(aerr && aerr.code === 'bad_plan', 'backend.advise 也挡');
});

await t('backend：summary.peds 和 compare 的 delta.peds_extra_min', async () => {
  const be = await connect({ fetch: fakeFetch, importer: noImporter });
  ok((await be.pedsReady()) === 'fetched' && be.status().peds === 'fetched', 'connect 从同源 /roads/public/cbd/ 取到 walk.json + peds.json（后台取，pedsReady() → fetched）');
  const open = await be.run(withFp('lonsdale', undefined));
  const shut = await be.run(withFp('lonsdale', 'left'));
  ok(open.peds.src === 'peds' && ZERO(open.peds), '没封人行道：summary.peds 全 0');
  ok(shut.peds.src === 'peds' && shut.peds.extra_min > 0 && shut.peds.detour.length > 0 && typeof shut.peds.assumed.note === 'string', `封左侧：summary.peds.extra_min = ${shut.peds.extra_min} 人·分钟`);
  ok(shut.queue_m === open.queue_m && shut.affected_min === open.affected_min, '封人行道不改车的数字（车道占用只看 closes.lanes）');
  const c = await be.compare(withFp('lonsdale', undefined), withFp('lonsdale', 'left'));
  ok(c.delta.peds_extra_min === +(shut.peds.extra_min - open.peds.extra_min).toFixed(3) && c.delta.peds_extra_min > 0, `compare：delta.peds_extra_min = +${c.delta.peds_extra_min}（正数 = 变差）`);
  const c2 = await be.compare(withFp('lonsdale', 'both'), withFp('lonsdale', 'left'));
  ok(c2.delta.peds_extra_min < 0, `两侧都封 → 只封左侧：delta.peds_extra_min = ${c2.delta.peds_extra_min}（负数 = 变好）`);
});

await t('walk / peds 拿不到：connect 照样能用，summary.peds.src = null', async () => {
  const be = await connect({ fetch: noPedsFetch, importer: noImporter });
  await be.pedsReady();
  const st = be.status();
  ok(st.peds === 'none' && st.errors.some(e => e.includes('行人')), 'status.peds = none，status.errors 里写了原因');
  const s = await be.run(withFp('lonsdale', 'left'));
  ok(s.peds.src === null && s.peds.footpath === 'left' && !('extra_min' in s.peds), 'summary.peds = { src: null, footpath }，不假装算出了 0（反向断言）');
  const ref = await (await connect({ fetch: fakeFetch, importer: noImporter })).run(withFp('lonsdale', 'left'));
  ok(s.queue_m === ref.queue_m && s.mean_delay_s === ref.mean_delay_s && s.queue_m > 0, `车的数字不受影响（排队 ${s.queue_m} 米）`);
  const c = await be.compare(withFp('lonsdale', undefined), withFp('lonsdale', 'left'));
  ok(c.delta.peds_extra_min === null, '没有行人数据时 delta.peds_extra_min = null');
  const bad = await connect({ fetch: fakeFetch, importer: noImporter, walk: { nodes: 'x' }, peds: {} });
  ok(bad.status().peds === 'given' && (await bad.run(withFp('lonsdale', 'left'))).peds.src === null, '注入的 walk 格式不对：run 不崩，summary.peds.src = null');
  const lineNet = await connect({ network, flows: J(PATHS.flows), fetch: null, importer: noImporter });
  ok((await lineNet.pedsReady()) === 'none' && lineNet.status().peds === 'none', '没有 fetch 时也不抛');
});

await t('没路可绕 → blocked，人不算进 extra_min（小图）', async () => {
  // a — b — c 一条人行道挂在路段 R 上，没有别的路：封 b—c 就过不去
  const nodes = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, lat: -37.81, lon: 144.96 + i * 0.001 }));
  const w = { nodes, links: [
    { id: 'ab', a: 'a', b: 'b', len_m: 88, kind: 'sidewalk', crossing: null, road_link: 'R0', side: 'left', geometry: [[-37.81, 144.96], [-37.81, 144.961]] },
    { id: 'bc', a: 'b', b: 'c', len_m: 88, kind: 'sidewalk', crossing: null, road_link: 'R', side: 'left', geometry: [[-37.81, 144.961], [-37.81, 144.962]] },
    { id: 'cd', a: 'c', b: 'd', len_m: 88, kind: 'sidewalk', crossing: null, road_link: 'R2', side: 'left', geometry: [[-37.81, 144.962], [-37.81, 144.963]] },
  ] };
  const pd = { days: { wd: { ab: Array(24).fill(10), bc: Array(24).fill(50), cd: Array(24).fill(10) } }, method: { bc: 'sensor' }, sensors: [] };
  const plan = { when: { date: '2026-10-06', hour: 8 }, worksites: [{ id: 'X', links: ['R'], closes: { lanes: 1, footpath: 'left' }, equipment: [] }] };
  const r = pedImpact(w, pd, plan);
  ok(r.blocked && r.blocked_ped_h === 50 && r.extra_min === 0 && r.detour.length === 0 && r.ped_h === 50 && r.measured, `封掉唯一的路：blocked = true、卡住 ${r.blocked_ped_h} 人/小时，不记成 0 分钟了事`);
  // walk 当只读数据用（索引按对象缓存）：改了要给新对象
  const w2 = { ...w, links: [...w.links, { id: 'bxc', a: 'b', b: 'c', len_m: 200, kind: 'path', crossing: null, road_link: null, side: null, geometry: [[-37.81, 144.961], [-37.8105, 144.9615], [-37.81, 144.962]] }] };
  const r2 = pedImpact(w2, pd, plan);
  ok(!r2.blocked && r2.detour.join() === 'bxc' && r2.detour_m === 112 && r2.extra_min === +((50 * 112) / (WALK_MPS * 60)).toFixed(1), `加一条 200 米的小路：绕行 = 200 − 88 = ${r2.detour_m} 米，${r2.extra_min} 人·分钟`);
  ok(r2.crossings === 0 && r2.sensor === null, '小路不算过马路；附近没有计数器 → sensor = null');
});

// ---------- 复审修的几处（T17 fix） ----------
// 施工路段（Lonsdale 西行，两点直线）局部平面：left = +1（行车方向左边 = 南侧路缘），right = −1
const K = 111320 * Math.cos(-37.81 * Math.PI / 180), KY = 110574;
const XY = ([lat, lon]) => [lon * K, lat * KY];
const lonGeo = network.links.find(l => l.id === LON).geometry.map(XY);
const [A0, B0] = [lonGeo[0], lonGeo[lonGeo.length - 1]];
const LEN = Math.hypot(B0[0] - A0[0], B0[1] - A0[1]), U = [(B0[0] - A0[0]) / LEN, (B0[1] - A0[1]) / LEN];
const wgeo = l => (l.geometry?.length >= 2 ? l.geometry : [walk.nodes.find(n => n.id === l.a), walk.nodes.find(n => n.id === l.b)].map(n => [n.lat, n.lon])).map(XY);
// 一条人行道在施工路段 sign 那一侧、贴着施工路段 [0, 总长] 并排（夹角 < 45°）走了多少米（横向 30 米内）
function besideFrontage(id, sign) {
  const g = wgeo(wl.get(id)); let m = 0;
  for (let i = 0; i + 1 < g.length; i++) {
    const d = Math.hypot(g[i + 1][0] - g[i][0], g[i + 1][1] - g[i][1]), n = Math.max(1, Math.ceil(d));
    if (!d || Math.abs(((g[i + 1][0] - g[i][0]) * U[0] + (g[i + 1][1] - g[i][1]) * U[1]) / d) < 0.7) continue; // 横着的（小巷口）不算并排
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, p = [g[i][0] + t * (g[i + 1][0] - g[i][0]) - A0[0], g[i][1] + t * (g[i + 1][1] - g[i][1]) - A0[1]];
      const along = p[0] * U[0] + p[1] * U[1], lat = U[0] * p[1] - U[1] * p[0];
      if (along >= 0 && along <= LEN && Math.abs(lat) <= 30 && Math.sign(lat) === sign) m += d / n;
    }
  }
  return m;
}

await t('右侧（对面那幅路）按并排长度选，不按中点（复审 P1）', async () => {
  const R = pedImpact(walk, peds, withFp('lonsdale', 'right'), { net });
  ok(besideFrontage('wl6167236662_6167344380', -1) >= 15 && R.closed.includes('wl6167236662_6167344380'),
    `北侧 81.8 米那条人行道贴着施工路段并排 ${besideFrontage('wl6167236662_6167344380', -1).toFixed(1)} 米（中点在施工范围外）→ 封`);
  ok(!R.closed.includes('wl9756035311_13882913770'), `只擦边 ${besideFrontage('wl9756035311_13882913770', -1).toFixed(1)} 米的 6.2 米碎段不封（反向断言）`);
  const worst = Math.max(0, ...R.detour.map(id => besideFrontage(id, -1)));
  ok(R.detour.length > 0 && worst < 5, `封右侧：绕行路线没有一段在北侧贴着施工路段走 ≥ 5 米（最多 ${worst.toFixed(1)} 米，反向断言）`);
  const L = pedImpact(walk, peds, withFp('lonsdale', 'left'), { net });
  ok(Math.max(0, ...L.detour.map(id => besideFrontage(id, +1))) < 5, '封左侧：绕行路线不在南侧贴着施工路段走（反向断言）');
  const B = pedImpact(walk, peds, withFp('lonsdale', 'both'), { net });
  ok(Math.max(0, ...B.detour.flatMap(id => [besideFrontage(id, 1), besideFrontage(id, -1)])) < 5 && B.extra_min > L.extra_min, `两侧都封：绕行两侧都不贴着施工路段走，${B.extra_min} 人·分钟`);
  // 网络上：Southbank Blvd 这段以前封右侧一条都找不到，却报 active = true、全 0
  const sb = pedImpact(walk, peds, { when: { date: '2026-10-06', hour: 8 }, worksites: [{ id: 'S', links: ['l243097376_6713073579'], closes: { lanes: 1, footpath: 'right' } }] }, { net });
  ok(sb.closed.includes('wl9141340855_9141340867') && sb.ped_h > 0 && !sb.unmatched, `Southbank Blvd 封右侧：找到对面那条贴着走了大半段的人行道（${sb.ped_h} 人/小时）`);
});

await t('过马路按「过几条街」数，不按过街段数（复审 P2）', async () => {
  for (const fp of ['left', 'right']) {
    const r = pedImpact(walk, peds, withFp('latrobe', fp), { net });
    const links = r.detour.map(id => wl.get(id));
    const pieces = links.filter(l => l.kind === 'crossing' || l.crossing != null).length;
    ok(r.crossings === 4 && pieces === 6, `La Trobe 封${fp === 'left' ? '左' : '右'}侧：绕行过 Swanston、La Trobe、Swanston、La Trobe = ${r.crossings} 次（过街段有 ${pieces} 段：La Trobe 那条被安全岛切成 3 段）`);
  }
  const L = pedImpact(walk, peds, withFp('lonsdale', 'left'), { net });
  ok(L.crossings === 2, `Lonsdale 封左侧：过 Lonsdale 去对面再回来 = ${L.crossings} 次`);
});

await t('计数器要在封掉的这一侧（复审 P2）', async () => {
  const lat224 = peds.sensors.find(s => s.name === 'Lat224_T');
  const R = pedImpact(walk, peds, withFp('latrobe', 'right'), { net });
  ok(R.closed.includes(lat224.walk_link) && R.sensor?.name === 'Lat224_T' && R.sensor.on_closed === true, `封右侧（北侧）：Lat224_T 就装在封掉的人行道上 → sensor = ${R.sensor?.name}、on_closed`);
  const L = pedImpact(walk, peds, withFp('latrobe', 'left'), { net });
  ok(L.sensor?.name !== 'Lat224_T' && (L.sensor === null || !R.closed.includes(peds.sensors.find(s => String(s.id) === String(L.sensor.id))?.walk_link)),
    `封左侧（南侧）：马路对面的 Lat224_T 不当这段的实测（sensor = ${L.sensor ? L.sensor.name : 'null'}，反向断言）`);
  const lon = pedImpact(walk, peds, withFp('lonsdale', 'left'), { net });
  const s = lon.sensor && peds.sensors.find(x => String(x.id) === String(lon.sensor.id));
  ok(!s || !pedImpact(walk, peds, withFp('lonsdale', 'right'), { net }).closed.includes(s.walk_link), `Lonsdale 封左侧：计数器 ${lon.sensor?.name ?? '无'} 不在北侧人行道上`);
});

await t('一条直街的几段施工不因方位跨 45° 被拆成两段（复审 P2）', async () => {
  const plan = { when: { date: '2026-10-06', hour: 8 }, worksites: [{ id: 'S', links: ['l243097376_6713073579', 'l6713073579_1234672054'], closes: { lanes: 1, footpath: 'left' } }] };
  const r = pedImpact(walk, peds, plan, { net });
  const maxV = Math.max(...r.closed.map(id => peds.days.wd[id][8]));
  ok(r.stretches.length === 1 && r.ped_h === maxV, `Southbank Blvd 两段（312° / 319°）封左侧 = 1 段、${r.ped_h} 人/小时（以前拆成 W / N 两段、人数算两遍）`);
  const one = pedImpact(walk, peds, { ...plan, worksites: [{ ...plan.worksites[0], links: ['l243097376_6713073579'] }] }, { net });
  ok(r.ped_h <= 2 * one.ped_h && r.ped_h >= one.ped_h, '两段加起来的人数不超过单段的两倍、不少于单段');
});

await t('要封的那一侧数据里没有人行道 → unmatched，不是「没影响」（复审 P2，反向断言）', async () => {
  const at = (id, fp) => pedImpact(walk, peds, { when: { date: '2026-10-06', hour: 8 }, worksites: [{ id: 'U', links: [id], closes: { lanes: 1, footpath: fp } }] }, { net });
  for (const [id, fp] of [['no_such_link', 'left'], ['l289602682_1492145829', 'right'], ['l387153095_777795238', 'left']]) {
    const r = at(id, fp);
    ok(r.active && r.closed.length === 0 && r.unmatched === true && r.unmatched_sides.length === 1 && r.unmatched_sides[0].side === fp && /no footpath/.test(r.note) && typeof r.note_zh === 'string',
      `${id} 封${fp}：找不到人行道 → unmatched = true、note 写明（不是没打标记的 0）`);
  }
  const L = pedImpact(walk, peds, withFp('lonsdale', 'left'), { net });
  ok(L.unmatched === false && L.unmatched_sides.length === 0 && L.note === null, '找到了就是 unmatched = false、note = null');
  const none = pedImpact(walk, peds, withFp('lonsdale', undefined), { net });
  ok(none.unmatched === false && none.note === null, '没封人行道不算 unmatched');
  const emp = pedImpact(walk, peds, { when: { date: '2026-10-06', hour: 8 }, worksites: [{ id: 'E', links: [], closes: { lanes: 1, footpath: 'both' } }] }, { net });
  ok(emp.unmatched && emp.unmatched_sides.length === 2, 'links 是空的也报 unmatched（两侧各一条）');
});

await t('死胡同 / 小孤岛不算「没路可绕」（复审 P2，小图）', async () => {
  // 六边形环 p0…p5（大路网）+ 一头悬空的短人行道 s—p1 + 只连着两个节点的小孤岛 p3—q1—q2
  const nodes = [...[0, 1, 2, 3, 4, 5].map(i => ({ id: 'p' + i, lat: -37.81 + 0.001 * Math.sin(i * Math.PI / 3), lon: 144.96 + 0.001 * Math.cos(i * Math.PI / 3) })),
    { id: 's', lat: -37.8095, lon: 144.9606 }, { id: 'q1', lat: -37.8105, lon: 144.9594 }, { id: 'q2', lat: -37.8106, lon: 144.9592 }];
  const at = id => nodes.find(n => n.id === id);
  const lk = (id, a, b, extra = {}) => ({ id, a, b, len_m: 100, kind: 'sidewalk', crossing: null, road_link: null, side: null, geometry: [[at(a).lat, at(a).lon], [at(b).lat, at(b).lon]], ...extra });
  const w = { nodes, links: [
    ...[0, 1, 2, 3, 4, 5].map(i => lk(`r${i}`, 'p' + i, 'p' + ((i + 1) % 6))),
    lk('sp1', 's', 'p1', { road_link: 'RS', side: 'left', len_m: 20 }),
    lk('p3q1', 'p3', 'q1', { road_link: 'RQ', side: 'left', len_m: 30 }), lk('q1q2', 'q1', 'q2', { len_m: 10 }),
  ] };
  const pd = { days: { wd: { sp1: Array(24).fill(525), p3q1: Array(24).fill(98), q1q2: Array(24).fill(5) } }, method: {}, sensors: [] };
  const plan = road => ({ when: { date: '2026-10-06', hour: 8 }, worksites: [{ id: 'X', links: [road], closes: { lanes: 1, footpath: 'left' } }] });
  const stub = pedImpact(w, pd, plan('RS'));
  ok(!stub.blocked && stub.dead_end && stub.blocked_ped_h === 0 && stub.extra_min === 0 && stub.ped_h === 525 && /dead end/.test(stub.note),
    '一头悬空的短人行道（起点只连着它自己）：dead_end，不报 blocked（以前报「525 人/小时无路可绕」）');
  const pocket = pedImpact(w, pd, plan('RQ'));
  ok(!pocket.blocked && pocket.dead_end && pocket.extra_min === 0, `另一头是 2 个节点的小孤岛（< min(${MIN_REACH}, 节点数一半)）：dead_end，不报 blocked`);
  // 真的被切断（两边都是像样的路网）照样 blocked：上面「没路可绕 → blocked」那条小图测试就是（a—b 和 c—d 各占一半）
});

await t('connect 不等行人数据：车的数字不被 3.6 MB 的 walk / peds 拖慢（复审 P1）', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const hangFetch = async url => (url.includes('/walk.json') || url.includes('/peds.json') ? (await gate, fakeFetch(url)) : fakeFetch(url));
  const be = await connect({ fetch: hangFetch, importer: noImporter, pedsWaitMs: 50 });
  ok(be.status().peds === 'loading', 'walk.json / peds.json 一直没回来，connect 照样好了（status.peds = loading）');
  const open = await be.run(withFp('lonsdale', undefined));
  ok(open.peds.src === 'peds' && ZERO(open.peds) && !open.peds.pending && open.queue_m > 0, '这个小时没封人行道：不等数据，summary.peds 直接全 0，车的数字照出');
  const late = await be.run(withFp('lonsdale', 'left', { hour: 22 }));
  ok(late.peds.src === 'peds' && ZERO(late.peds), '封了人行道但这个小时不施工：也不等');
  const t1 = Date.now();
  const shut = await be.run(withFp('lonsdale', 'left'));
  const waited = Date.now() - t1;
  ok(shut.peds.src === null && shut.peds.pending === true && shut.peds.footpath === 'left' && !('extra_min' in shut.peds) && shut.queue_m === open.queue_m && waited < 2000,
    `封了人行道、数据 50 毫秒内没到：summary.peds = { src: null, pending: true }，不假装 0，车的数字照出（等了 ${waited} 毫秒）`);
  const c = await be.compare(withFp('lonsdale', undefined), withFp('lonsdale', 'left'));
  ok(c.delta.peds_extra_min === null, '数据还没到时 compare 的 delta.peds_extra_min = null');
  release();
  ok((await be.pedsReady()) === 'fetched' && be.status().peds === 'fetched', '数据到了 → pedsReady() = fetched');
  const again = await be.run(withFp('lonsdale', 'left'));
  ok(again.peds.src === 'peds' && again.peds.extra_min > 0 && !again.peds.pending, `之后再算就有行人数字（${again.peds.extra_min} 人·分钟）`);
  const slow = async url => (url.includes('/walk.json') ? (await new Promise(r => setTimeout(r, 30)), fakeFetch(url)) : fakeFetch(url));
  const be2 = await connect({ fetch: slow, importer: noImporter });
  const s2 = await be2.run(withFp('lonsdale', 'left'));
  ok(s2.peds.src === 'peds' && s2.peds.extra_min === again.peds.extra_min, '数据慢一点（30 毫秒）：封了人行道的 run 会等它（默认最多 8 秒），数字一样');
});

done();
