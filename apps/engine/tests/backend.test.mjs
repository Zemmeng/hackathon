// 后端接线层 backend.js：路网 + 车流 + 参数 + T5 读屏 → 页面要的数字。
// 用仓库里的真文件（T3 路网、T5 reader.js / check.js、T12 params.json 有就用）；按 URL 取文件的地方注入假的 fetch / importer，不联网
import { readFileSync, existsSync } from 'node:fs';
import { ok, t, done } from './_t.mjs';
import { connect, demoPlan, summarize, PATHS, DEMO_NAMES } from '../public/js/backend.js';
const clone = x => JSON.parse(JSON.stringify(x));

const APPS = new URL('../../', import.meta.url); // apps/
const file = p => new URL('.' + p, APPS); // '/roads/public/…' → apps/roads/public/…
const has = p => existsSync(file(p));
if (!has(PATHS.network)) { ok(false, '找不到 apps/roads/public/cbd/network.json'); done(); }
const fakeFetch = async url => (existsSync(file(url)) ? { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file(url), 'utf8')) } : { ok: false, status: 404 });
const repoImporter = async url => { if (!existsSync(file(url))) throw new Error('404 ' + url); return import(file(url).href); };
const noImporter = async url => { throw new Error('404 ' + url); };
const T5 = has(PATHS.reader) && has(PATHS.check);

await t('connect：什么都拿不到时有兜底（除了路网）', async () => {
  const be = await connect({ fetch: async url => (url.includes('/roads/') ? fakeFetch(url) : { ok: false, status: 404 }), importer: noImporter });
  const st = be.status();
  ok(st.network === 'fetched' && st.reader === 'engine-mock' && st.check === 'none' && st.params === 'default' && st.errors.length === 3 && st.errors.some(e => e.startsWith('参数：')), `兜底：读屏 → 引擎规则、checkSigns → 不检查、参数 → 假设值（status.errors ${st.errors.length} 条）`);
  const s = await be.run(be.demo('lonsdale'));
  ok(s.queue_m > 0 && s.mean_delay_s > 0 && s.flags.ok && s.flags.reading_src === 'rule', `兜底照样出数：排队 ${s.queue_m} 米、每车多 ${s.mean_delay_s} 秒`);
  let threw = false;
  try { await connect({ fetch: async () => ({ ok: false, status: 404 }), importer: noImporter }); } catch { threw = true; }
  ok(threw, '路网取不到 → connect 抛错（没路网什么都算不了，不能装作没事）');
});

await t('connect：同源路径 + 仓库里 T5 的读屏和规范检查', async () => {
  if (!T5) { ok(true, '（跳过：仓库里没有 apps/api/public/js/reader.js）'); return; }
  const be = await connect({ fetch: fakeFetch, importer: repoImporter });
  const st = be.status();
  ok(st.reader === 't5' && st.check === 't5' && st.params === (has(PATHS.params) ? 'params' : 'default'), `读屏 = T5、规范检查 = T5、参数 = ${st.params}`);
  const s = await be.run(be.demo('lonsdale'));
  ok(s.flags.failed === 0 && s.flags.missing === 0 && s.flags.sign_errors.length === 0 && be.demo('lonsdale').worksites[0].equipment.some(e => e.type === 'arrow'), `演示方案（含箭头板，T5 #29 起读得懂）：T5 读数全拿到（failed ${s.flags.failed}、missing ${s.flags.missing}），屏上文字合规范`);
  const c = await be.compare(be.demo('lonsdale', { frames: [['ROADWORK', 'AHEAD']] }), be.demo('lonsdale'));
  ok(c.delta.queue_m < 0 && c.delta.affected_min < 0 && c.after.routes.find(r => r.name === 'Russell Street').share > c.before.routes.find(r => r.name === 'Russell Street').share,
    `第一幕：加一帧 USE / RUSSELL ST，排队 ${c.before.queue_m} → ${c.after.queue_m} 米，每车 ${c.before.mean_delay_s} → ${c.after.mean_delay_s} 秒`);
  const bad = await be.run(be.demo('lonsdale', { frames: [['ROADWORKSAHEAD']] }));
  ok(bad.flags.ok === false && bad.flags.sign_errors.length >= 1 && bad.flags.sign_errors[0].code, `屏上一行 14 个字符 → 规范检查报错（${bad.flags.sign_errors[0]?.code}），flags.ok = false`);
  ok(be.check(be.demo('lonsdale')).every(c => c.ok), 'check(方案) 单独可调（输入框改字时用）');
});

await t('summary 的口径', async () => {
  const be = await connect({ fetch: fakeFetch, importer: noImporter });
  const s = await be.run(be.demo('lonsdale'));
  const veh = Object.values(s.by_type).reduce((a, x) => a + x.vehicles, 0);
  const aff = Object.values(s.by_type).reduce((a, x) => a + x.delay_min, 0);
  ok(Math.abs(s.mean_delay_s - Math.round((aff / veh) * 60)) <= 1 && s.affected_min + s.others_min >= s.delay_min - 2 && s.affected_min < s.delay_min,
    `每车多几秒只算受影响的车（${s.affected_min} 车·分钟 ÷ ${s.vehicles} 辆），背景车流 ${s.others_min} 另算`);
  ok(s.routes[0].id === 'stay' && Math.abs(s.routes.reduce((a, r) => a + r.share, 0) - 1) < 0.01 && Math.abs(s.detour_share - (1 - s.routes[0].share)) < 0.002, '各路线分流加起来 = 1；detour_share = 1 − 原路');
  ok(['commuter', 'local', 'tourist', 'delivery'].every(k => typeof s.approaches[0].by_type[k].why === 'string'), '每类人一句「为什么」（T5 读数的 why）');
  ok(s.raw && s.raw.links.length > 1000 && Array.isArray(s.hot), '原始结果在 .raw（全部路段），最堵的在 .hot');
  const late = await be.run(be.demo('latrobe'));
  ok(late.queue_m === 0 && late.mean_delay_s < 30, `网页现在的场景 La Trobe St 西行 17 点：几乎不堵（每车 +${late.mean_delay_s} 秒）`);
});

await t('读屏失败要报出来，不能悄悄算错（反向断言）', async () => {
  const be = await connect({ fetch: fakeFetch, importer: noImporter, readSigns: async req => { if (req.persona === 'tourist') { const e = new Error('bad'); e.code = 'bad_kind'; throw e; } return (await import('../public/js/index.js')).mockReadSigns(req); } });
  const s = await be.run(be.demo('lonsdale'));
  ok(s.flags.ok === false && s.flags.failed > 0 && s.flags.missing > 0 && be.status().reader_errors.bad_kind > 0, `游客的读数全抛错 → flags.ok = false、failed ${s.flags.failed}、status 记下 bad_kind`);
  ok(s.approaches[0].by_type.tourist.informed === 0, '拿不到读数的那类人按「没人被说动」算（和契约一致）');
});

await t('顾问：每个改法都重算，标 better', async () => {
  const be = await connect({ fetch: fakeFetch, importer: noImporter });
  const a = await be.advise(be.demo('lonsdale', { frames: [['ROADWORK', 'AHEAD']] }));
  ok(a.options.length >= 1 && a.options.every(o => typeof o.better === 'boolean' && (o.skipped || Number.isFinite(o.delta_min))) && a.window.whens > 1, `规则顾问给 ${a.options.length} 个改法：${a.options.map(o => `${o.kind} ${o.delta_min}`).join(' · ')}（施工期 ${a.window.whens} 个时段加总）`);
  const txt = a.options.find(o => o.kind === 'text');
  ok(!txt || (txt.plan && !JSON.stringify(txt.frames).includes('HEFFERNAN')), '顾问不会建议屏上点名一条小巷');
});

await t('演示方案', async () => {
  ok(DEMO_NAMES.join() === 'lonsdale,latrobe', '两个演示方案：lonsdale（主演示）、latrobe（网页现在的场景）');
  const p = demoPlan('lonsdale', { frames: [['X']], at_m: 180, hour: 17 });
  ok(p.worksites[0].equipment[0].frames[0][0] === 'X' && p.worksites[0].equipment[0].at_m === 180 && p.when.hour === 17 && demoPlan('lonsdale').worksites[0].equipment[0].at_m === 300, 'demo(名, { frames, at_m, hour }) 每次给新的一份，不改原件');
  let threw = false; try { demoPlan('nope'); } catch { threw = true; }
  ok(threw && typeof summarize === 'function', '没有的方案名 → 抛错');
});

await t('审查确认的 7 条（review-backend-logic / browser）', async () => {
  const be = await connect({ fetch: fakeFetch, importer: noImporter });
  // 1 全封：封死路段上的车全部改道，不许悄悄记成「卡住」而让全封显得更好
  const all = be.demo('lonsdale'); all.worksites[0].closes.lanes = 2;
  const full = await be.run(all);
  const closed = full.raw.links.find(l => l.id === 'l595594354_9756035316');
  ok(full.blocked_vph === 0 && closed.v === 0 && full.vehicles >= 1100 && full.raw.links.every(l => l.v >= 0) && full.flags.ok,
    `全封：封闭路段剩 ${closed.v} 辆、卡住 ${full.blocked_vph}、改道 ${full.vehicles} 辆（整条路段的车，不是只挪从头走到尾的 513 辆），没有负流量`);
  const line = { version: 1, nodes: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, lat: -37.81, lon: 144.95 + i * 0.002 })),
    links: [['a', 'b'], ['b', 'c'], ['c', 'd']].map(([x, y]) => ({ id: x + y, from: x, to: y, name: 'Solo St', len_m: 200, lanes: 2, speed_kmh: 40, cap_vph: 1800, t0_s: 18 })) };
  const lineFlows = { days: { wd: Object.fromEntries(line.links.map(l => [l.id, Array(24).fill(500)])), we: Object.fromEntries(line.links.map(l => [l.id, Array(24).fill(500)])) } };
  const bl = await connect({ network: line, flows: lineFlows, fetch: null, importer: noImporter });
  const stuck = await bl.run({ when: { date: '2026-10-06', hour: 8 }, worksites: [{ id: 'X', links: ['bc'], closes: { lanes: 2 }, time: { from: '2026-10-05', to: '2026-10-09', hours: [7, 19] }, equipment: [] }] });
  ok(stuck.blocked_vph > 0 && stuck.flags.blocked_vph === stuck.blocked_vph && stuck.flags.ok === false, `全封又无路可绕：卡住 ${stuck.blocked_vph} veh/h → flags.ok = false（反向断言：不许当成没事）`);
  // 2 多个施工：「为什么」和排队、分流来自同一段路
  const two = be.demo('lonsdale', { frames: [['ROADWORK', 'AHEAD'], ['USE', 'RUSSELL ST']] });
  two.worksites.unshift({ ...be.demo('latrobe', { frames: [['ROADWORK', 'AHEAD']] }).worksites[0], id: 'C-7' });
  const s2 = await be.run(two);
  const m = s2.approaches[s2.main];
  ok(s2.approaches.length === 2 && m.worksite === 'B-12' && s2.why.commuter === m.by_type.commuter.why && s2.routes === m.routes && s2.street === m.street,
    `两个施工：主路段 ${m.street}，why / routes / queue_m 都取它（why = ${s2.why.commuter}）`);
  // 3 前后对比按同一段路比
  const king = { id: 'K-1', links: ['l9146197565_8955976454'], closes: { lanes: 1 }, time: { from: '2026-10-05', to: '2026-10-09', hours: [7, 19] }, equipment: [] };
  const pre = be.demo('lonsdale', { frames: [['ROADWORK', 'AHEAD']] }), post = be.demo('lonsdale');
  pre.worksites.push(king); post.worksites.push(clone(king));
  const c3 = await be.compare(pre, post);
  const lonB = c3.before.approaches.find(x => x.worksite === 'B-12'), lonA = c3.after.approaches.find(x => x.worksite === 'B-12');
  ok(c3.delta.street === 'Lonsdale Street' && c3.delta.queue_m === +(lonA.queue_m - lonB.queue_m).toFixed(3) && c3.delta.queue_m < 0,
    `前后对比按改之前的主路段比：Lonsdale 排队 ${lonB.queue_m} → ${lonA.queue_m}（delta ${c3.delta.queue_m}，main_changed ${c3.delta.main_changed}）`);
  // 4 屏上文字检查和时段无关；不在施工的时段要标出来
  const bt = T5 ? await connect({ fetch: fakeFetch, importer: repoImporter }) : null;
  const off = be.demo('lonsdale', { frames: [['ROADWORKSAHEAD']], hour: 22 });
  const s4 = await be.run(off);
  ok(s4.flags.inactive && s4.active.length === 0 && (!bt || (bt.check(off).some(c => !c.ok) && (await bt.run(off)).flags.ok === false)), '晚上 10 点不施工：flags.inactive = true；文字不合规范照样查出来（T5 checkSigns）');
  // 5 施工没写日期：顾问只比这一个小时，不把每个改法都算成 0
  const noTime = be.demo('lonsdale', { frames: [['ROADWORK', 'AHEAD']] }); delete noTime.worksites[0].time;
  const a5 = await be.advise(noTime);
  ok(a5.window.single_hour && a5.options.some(o => o.better && o.delta_min < 0), `施工没写日期：顾问按这一个小时比（${a5.options.map(o => o.kind + ' ' + o.delta_min).join(' · ')}）`);
  // 6 顾问也要报读数失败
  const sign = err => { const e = new Error(err); e.code = err; return e; };
  const bad = await connect({ fetch: fakeFetch, importer: noImporter, readSigns: async req => { if (req.persona === 'tourist') throw sign('bad_kind'); return (await import('../public/js/index.js')).mockReadSigns(req); } });
  const a6 = await bad.advise(bad.demo('lonsdale', { frames: [['ROADWORK', 'AHEAD']] }));
  ok(a6.flags.ok === false && a6.flags.failed > 0, `顾问：有读数被拒 → flags.ok = false（failed ${a6.flags.failed}）`);
  // 7 非 https 页面上 T5 算缓存键抛普通错误：这一条退回引擎规则读数，不许悄悄变成「没人被说动」
  const noCrypto = await connect({ fetch: fakeFetch, importer: noImporter, readSigns: async () => { throw new TypeError("Cannot read properties of undefined (reading 'digest')"); } });
  const s7 = await noCrypto.run(noCrypto.demo('lonsdale'));
  const ref = await be.run(be.demo('lonsdale'));
  ok(s7.flags.failed === 0 && s7.flags.missing === 0 && s7.queue_m === ref.queue_m && Object.keys(noCrypto.status().reader_errors).every(k => k.startsWith('fallback')),
    `T5 读屏抛普通错误（没有 crypto.subtle）→ 退回引擎规则，排队 ${s7.queue_m} 米和规则读数一致，status 记下 fallback`);
});

done();
