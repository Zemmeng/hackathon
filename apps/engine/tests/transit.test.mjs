// 电车公交（T16）：transit.js + backend.js 的 summary.transit。用仓库里 T3 的真文件（network / flows / transit.json），
// 按 URL 取文件的地方注入假的 fetch，不联网。数字只断言方向、口径和关系；每趟载客人数是假设值（PAX_PER_TRIP）。
import { readFileSync, existsSync } from 'node:fs';
import { ok, t, done } from './_t.mjs';
import { connect, PATHS } from '../public/js/backend.js';
import { transitImpact, PAX_PER_TRIP, paxPerTrip, loadNetwork, shortestPath, NO_DETOUR } from '../public/js/index.js';
import { BUS_ROADS, TRANSIT_PEAK_HOURS } from '../public/js/transit.js';
const clone = x => JSON.parse(JSON.stringify(x));

const APPS = new URL('../../', import.meta.url); // apps/
const file = p => new URL('.' + p, APPS);
if (!existsSync(file(PATHS.transit))) { ok(false, '找不到 apps/roads/public/cbd/transit.json'); done(); }
const J = p => JSON.parse(readFileSync(file(p), 'utf8'));
const fakeFetch = async url => (existsSync(file(url)) ? { ok: true, status: 200, json: async () => J(url) } : { ok: false, status: 404 });
const noImporter = async url => { throw new Error('404 ' + url); };
const TRANSIT = J(PATHS.transit);
const dirOf = (id, dir) => TRANSIT.routes.find(r => r.id === id).dirs.find(d => d.dir === dir);
const LONSDALE = 'l595594354_9756035316', LATROBE = 'l2187770692_2190483583';

const be = await connect({ fetch: fakeFetch, importer: noImporter });

await t('加载：transit.json 和路网一起取', async () => {
  const st = be.status();
  ok(st.transit === 'gtfs' && !st.errors.some(e => e.includes('公交')), `status.transit = ${st.transit}（${TRANSIT.routes.length} 条线路）`);
});

await t('Lonsdale 演示 8 点（封 1 条道）：经过的公交都跟着堵', async () => {
  const s = await be.run(be.demo('lonsdale'));
  const tr = s.transit;
  const bus = tr.routes.filter(r => r.mode === 'bus' && r.delay_s > 0 && r.pax_min > 0);
  ok(tr.src === 'gtfs' && tr.day === 'wd' && tr.hour === 8 && bus.length >= 10, `${bus.length} 条公交每趟多等 > 0 秒（用这段路的有 15 条）`);
  ok(tr.routes.every(r => r.links.includes(LONSDALE) && !r.blocked && !r.diverted), '列出来的都经过施工路段；封 1 条道不用绕、不停');
  ok(tr.routes.every(r => r.mode !== 'tram'), '反向：封部分车道不列电车（电车在 CBD 走自己的车道）');
  const stay = s.routes.find(r => r.id === 'stay');
  const car = (stay.now_min - stay.usual_min) * 60;
  const b0 = tr.routes[0];
  ok(Math.abs(b0.delay_s - car) <= 0.25 * car, `公交每趟多 ${b0.delay_s} 秒 ≈ 留在 Lonsdale 的车多 ${car.toFixed(0)} 秒（差 ≤ 25%）`);
  ok(tr.routes.every(r => r.trips_h === dirOf(r.id, r.dir).trips.wd[8] && r.pax_per_trip === PAX_PER_TRIP.peak.bus && r.pax_h === r.trips_h * r.pax_per_trip),
    '车次 = transit.json 工作日 8 点的车次；高峰每趟 25 人（假设值）；pax_h = 车次 × 每趟人数');
  ok(tr.routes.every(r => Math.abs(r.pax_min - (r.pax_h * r.delay_s) / 60) <= (r.pax_h * 0.05) / 60 + 0.051), 'pax_min = pax_h × delay_s ÷ 60（delay_s 取到 0.1 秒）');
  const sum = tr.routes.reduce((a, r) => a + r.pax_min, 0);
  ok(Math.abs(tr.pax_min - sum) <= 1 && tr.trips_h === tr.routes.reduce((a, r) => a + r.trips_h, 0) && tr.pax_h === tr.routes.reduce((a, r) => a + r.pax_h, 0) && tr.blocked_routes === 0,
    `合计：${tr.trips_h} 趟/小时、${tr.pax_h} 人/小时、${tr.pax_min} 乘客·分钟`);
  ok(tr.routes.every((r, i, a) => i === 0 || a[i - 1].pax_min >= r.pax_min), '按 pax_min 从大到小排');
  ok(tr.assumed.pax_per_trip.bus === PAX_PER_TRIP.peak.bus && tr.assumed.pax_per_trip.tram === PAX_PER_TRIP.peak.tram && tr.assumed.period === 'peak' && tr.assumed.range.bus.length === 2 && tr.assumed.note,
    'summary.transit.assumed 报每趟人数（假设值）、区间和说明');
});

await t('反向：不施工的时段（22 点）一切都是 0', async () => {
  const s = await be.run(be.demo('lonsdale', { hour: 22 }));
  const tr = s.transit;
  ok(s.flags.inactive && tr.src === 'gtfs' && tr.routes.length === 0 && tr.pax_min === 0 && tr.trips_h === 0 && tr.pax_h === 0 && tr.blocked_routes === 0,
    `22 点施工不在做：${tr.routes.length} 条线路、${tr.pax_min} 乘客·分钟`);
  // 同一小时直接喂「什么都没变」的结果（施工在做但通行能力没降）：每条线路都不该有延误
  const plan = be.demo('lonsdale', { hour: 22 }); delete plan.worksites[0].time; plan.worksites[0].closes.lanes = 0;
  const r = be.engine.evaluate(plan);
  const tr2 = transitImpact(be.engine.net, be.engine.flows, TRANSIT, plan, r);
  ok(r.active.length === 1 && tr2.routes.every(x => x.delay_s === 0) && tr2.pax_min === 0, `施工在做但一条道都没封：${tr2.routes.length} 条线路列出，延误全是 0`);
});

await t('反向：延误比的是「没施工」，不是自由流', async () => {
  // 把 Victoria Parade 一段（906 路经过，离施工很远）8 点的车流改到远超通行能力：它本来就堵，但施工没让它更堵
  const VIC = 'l2096319051_6207152063';
  const flows2 = J(PATHS.flows); flows2.days.wd[VIC][8] = 8000;
  const be2 = await connect({ network: J(PATHS.network), flows: flows2, fetch: fakeFetch, importer: noImporter });
  const [a, b] = [await be.run(be.demo('lonsdale')), await be2.run(be2.demo('lonsdale'))];
  const pick = s => s.transit.routes.find(r => r.id === 'bus_906' && r.dir === 1);
  const vic = b.raw.links.find(l => l.id === VIC);
  const naive = dirOf('bus_906', 1).links.reduce((s, id) => s + (b.raw.links.find(l => l.id === id)?.delay_s || 0), 0);
  ok(vic.delay_s > 1000 && naive > 1000 && Math.abs(pick(b).delay_s - pick(a).delay_s) < 1,
    `Victoria Pde 本来就比自由流慢 ${vic.delay_s} 秒：906 路照样多 ${pick(b).delay_s} 秒（原来 ${pick(a).delay_s}），不是把 delay_s 加起来的 ${naive.toFixed(0)} 秒`);
});

await t('La Trobe 全封 17 点：30 路电车停', async () => {
  const plan = be.demo('latrobe'); plan.worksites[0].closes.lanes = 2;
  const tr = (await be.run(plan)).transit;
  const t30 = tr.routes.find(r => r.id === 'tram_30');
  const trips = dirOf('tram_30', 1).trips.wd[17];
  ok(t30 && t30.blocked && t30.mode === 'tram' && t30.dir === 1 && t30.delay_s === null && t30.pax_min === null && !t30.diverted,
    `30 路（往 ${t30?.headsign}）blocked，分钟数给 null（不编）`);
  ok(t30.trips_h === trips && t30.pax_h === trips * PAX_PER_TRIP.peak.tram && t30.links.includes(LATROBE), `停掉 ${t30.trips_h} 趟/小时、${t30.pax_h} 人/小时（每趟 ${PAX_PER_TRIP.peak.tram} 人，假设值）`);
  ok(tr.routes[0].blocked && tr.blocked_routes >= 1 && tr.blocked_pax_h >= t30.pax_h && Number.isFinite(tr.pax_min), `停的排最前；合计 blocked_routes ${tr.blocked_routes}、停掉 ${tr.blocked_pax_h} 人/小时；pax_min ${tr.pax_min} 不含 null`);
  const part = (await be.run(be.demo('latrobe'))).transit;
  ok(!part.routes.some(r => r.id === 'tram_30'), '反向：同一段只封 1 条道，30 路电车不列（不耽误电车）');
});

await t('Lonsdale 全封 8 点：公交就近绕行', async () => {
  const plan = be.demo('lonsdale'); plan.worksites[0].closes.lanes = 2;
  const tr = (await be.run(plan)).transit;
  const net = be.engine.net;
  const b = tr.routes.find(r => r.id === 'bus_906' && r.dir === 1);
  ok(tr.routes.length >= 10 && tr.routes.every(r => r.diverted && !r.blocked && r.delay_s > 0 && r.links.includes(LONSDALE)), `${tr.routes.length} 条公交都绕行（diverted），每趟多 ${b.delay_s} 秒`);
  const d = b.detour_links.map(id => net.links.get(id));
  const joined = d.every((l, i) => i === 0 || d[i - 1].to === l.from);
  ok(d.length > 0 && joined && !b.detour_links.includes(LONSDALE) && d.every(l => !NO_DETOUR.has(l.highway)),
    `绕行路线连成一条、不经过封闭路段和小巷：${[...new Set(d.map(l => l.name))].join(' → ')}`);
  ok(d.every(l => BUS_ROADS.has(l.highway)), '这里主干道绕得过去：只走主干道（不走 Swanston St 电车路、Little Bourke St 这类小街）');
  ok(Array.isArray(b.stops_closed) && b.stops_closed.length === 0 && b.stops_skipped.every(s => s.id && s.name), `封闭路段上没有站；绕开的站 ${b.stops_skipped.map(s => s.name).join('、') || '无'}`);
});

await t('路口里的短路段（transit.json 没列）封了也算到', async () => {
  // 906 路在 Russell St 路口那几段很短，transit.json 按 10 米采样没匹配上；引擎补上缺口后照样能算到
  const d906 = dirOf('bus_906', 1).links, net = be.engine.net;
  const i = d906.indexOf('l6696274751_9756035317');
  const gap = shortestPath(net, net.links.get(d906[i]).to, net.links.get(d906[i + 1]).from, { cost: l => l.len_m });
  ok(gap && gap.links.length >= 1 && gap.links.every(id => !d906.includes(id)), `缺口 ${gap?.links.length} 段（${gap?.cost.toFixed(0)} 米），不在 transit.json 的 links 里`);
  const plan = be.demo('lonsdale'); plan.worksites[0].links = [gap.links[0]]; plan.worksites[0].closes.lanes = 9;
  const tr = transitImpact(net, be.engine.flows, TRANSIT, plan, be.engine.evaluate(plan));
  ok(tr.routes.some(r => r.id === 'bus_906' && r.dir === 1 && r.links.includes(gap.links[0])), '封了缺口里的路段 → 906 路照样列出来');
});

await t('周末 / 平峰：车次和每趟人数跟着变', async () => {
  // 周末早上 Lonsdale 车少，封 1 条道几乎不堵：用全封（公交一定要绕）看车次和人数
  const plan = be.demo('lonsdale'); plan.when.day = 'we'; plan.worksites[0].closes.lanes = 2;
  const tr = (await be.run(plan)).transit;
  ok(tr.day === 'we' && tr.assumed.period === 'offpeak' && tr.routes.length > 0 && tr.routes.every(r => r.trips_h === dirOf(r.id, r.dir).trips.we[8] && r.pax_per_trip === PAX_PER_TRIP.offpeak.bus),
    `周末 8 点：车次取 trips.we，每趟 ${PAX_PER_TRIP.offpeak.bus} 人（平峰，假设值）`);
  ok(paxPerTrip({ date: '2026-10-06', hour: 8 }).period === 'peak' && paxPerTrip({ date: '2026-10-06', hour: 12 }).period === 'offpeak' && paxPerTrip({ date: '2026-10-10', hour: 8 }).period === 'offpeak' && TRANSIT_PEAK_HOURS.includes(17),
    '高峰只算工作日 7–9、16–18 点');
});

await t('前后对比：delta.transit_pax_min = 后 − 前', async () => {
  const c = await be.compare(be.demo('lonsdale', { frames: [['ROADWORK', 'AHEAD']] }), be.demo('lonsdale'));
  ok(c.delta.transit_pax_min === c.after.transit.pax_min - c.before.transit.pax_min && c.delta.transit_pax_min < 0,
    `屏上点名 Russell St、Lonsdale 排队变短，公交乘客 ${c.before.transit.pax_min} → ${c.after.transit.pax_min} 乘客·分钟（delta ${c.delta.transit_pax_min}）`);
});

await t('transit.json 拿不到：照样出数，summary.transit.src = null', async () => {
  const miss = await connect({ fetch: async url => (url.endsWith('transit.json') ? { ok: false, status: 404 } : fakeFetch(url)), importer: noImporter });
  const st = miss.status();
  ok(st.transit === 'none' && st.errors.some(e => e.includes('公交电车数据没加载上')), `status.transit = none，errors 记一条`);
  const s = await miss.run(miss.demo('lonsdale'));
  ok(s.queue_m > 0 && s.transit.src === null && !('routes' in s.transit), `车的数字照样出（排队 ${s.queue_m} 米），summary.transit = { src: null }`);
  const c = await miss.compare(miss.demo('lonsdale', { frames: [['ROADWORK', 'AHEAD']] }), miss.demo('lonsdale'));
  ok(c.delta.transit_pax_min === null, '前后对比：delta.transit_pax_min = null');
  const bad = await connect({ fetch: fakeFetch, importer: noImporter, transit: { version: 1 } });
  ok(bad.status().transit === 'none' && (await bad.run(bad.demo('lonsdale'))).transit.src === null, '注入的 transit 不合格（没有 routes[]）→ 同样按没有算');
  const broken = await connect({ fetch: fakeFetch, importer: noImporter, transit: { routes: [{ id: 'x', mode: 'bus', dirs: [{ dir: 0, links: 5 }] }] } });
  const sb = await broken.run(broken.demo('lonsdale'));
  ok(sb.queue_m > 0 && sb.transit.src === null && typeof sb.transit.error === 'string', `公交这一块算挂了不拖垮整页：车的数字照出，transit = { src: null, error: "${sb.transit.error}" }`);
  const given = await connect({ fetch: fakeFetch, importer: noImporter, transit: clone(TRANSIT) });
  ok(given.status().transit === 'given' && (await given.run(given.demo('lonsdale'))).transit.routes.length >= 10, 'opts.transit 可以直接给');
});

await t('纯函数：换了路网不崩、同样输入同样结果', async () => {
  const net = loadNetwork(J(PATHS.network));
  const plan = be.demo('lonsdale');
  const r = be.engine.evaluate(plan);
  const a = transitImpact(net, be.engine.flows, TRANSIT, plan, r), b = transitImpact(net, be.engine.flows, TRANSIT, plan, r);
  ok(JSON.stringify(a) === JSON.stringify(b) && a.routes.length >= 10, '同样输入同样结果');
  const tiny = loadNetwork({ nodes: [{ id: 'a', lat: 0, lon: 0 }, { id: 'b', lat: 0, lon: 0.001 }], links: [{ id: 'ab', from: 'a', to: 'b', name: null, len_m: 100, lanes: 1, speed_kmh: 40, cap_vph: 900, t0_s: 9 }] });
  const x = transitImpact(tiny, { days: {} }, TRANSIT, { when: { date: '2026-10-06', hour: 8 }, worksites: [] }, { links: [] });
  ok(x.src === 'gtfs' && x.routes.length === 0 && transitImpact(tiny, null, null, plan, r).src === null, '线路路段不在路网上 → 不列；transit 为空 → { src: null }');
});

done();
