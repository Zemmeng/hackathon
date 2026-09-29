// 后端接线层 backend.js：路网 + 车流 + 参数 + T5 读屏 → 页面要的数字。
// 用仓库里的真文件（T3 路网、T5 reader.js / check.js、T12 params.json 有就用）；按 URL 取文件的地方注入假的 fetch / importer，不联网
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ok, t, done } from './_t.mjs';
import { connect, demoPlan, summarize, PATHS, DEMO_NAMES } from '../public/js/backend.js';

const APPS = new URL('../../', import.meta.url); // apps/
const file = p => new URL('.' + p, APPS); // '/roads/public/…' → apps/roads/public/…
const has = p => existsSync(file(p));
if (!has(PATHS.network)) { ok(false, '找不到 apps/roads/public/cbd/network.json'); done(); }
const fakeFetch = async url => (existsSync(file(url)) ? { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file(url), 'utf8')) } : { ok: false, status: 404 });
const repoImporter = async url => { if (!existsSync(file(url))) throw new Error('404 ' + url); return import(pathToFileURL(file(url).pathname).href); };
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
  ok(s.flags.failed === 0 && s.flags.missing === 0 && s.flags.sign_errors.length === 0, `演示方案：T5 读数全拿到（failed ${s.flags.failed}、missing ${s.flags.missing}），屏上文字合规范`);
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

done();
