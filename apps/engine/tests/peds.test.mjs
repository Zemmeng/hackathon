// T17 封人行道 → 行人绕行（peds.js + backend.js 的 summary.peds）。用仓库里 T3 的真文件 walk.json / peds.json / network.json，不联网
import { readFileSync, existsSync } from 'node:fs';
import { ok, t, done } from './_t.mjs';
import { connect, demoPlan, PATHS } from '../public/js/backend.js';
import { pedImpact, WALK_MPS, validatePlan, validateWorksite, loadNetwork, footpathOf } from '../public/js/index.js';

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
  ok(be.status().peds === 'fetched', 'connect 从同源 /roads/public/cbd/ 取到 walk.json + peds.json（status.peds = fetched）');
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
  ok(lineNet.status().peds === 'none', '没有 fetch 时也不抛');
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

done();
