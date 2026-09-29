// AI 调用日志（网页第 3 步「AI 路人 · 各自读到了什么」+「AI 调用日志」）：backend.js 的 aiLog() / onAiLog() / readingsOf() / lastReadings()。
// 读屏用假的 reader（按类人回 file / llm / kv，送货车抛普通错 → 规则兜底），不联网、不调大模型
import { readFileSync, existsSync } from 'node:fs';
import { ok, t, done } from './_t.mjs';
import { connect, PATHS, AI_LOG_MAX } from '../public/js/backend.js';
import { mockReadSigns } from '../public/js/index.js';

const APPS = new URL('../../', import.meta.url);
const file = p => new URL('.' + p, APPS);
if (!existsSync(file(PATHS.network))) { ok(false, '找不到 apps/roads/public/cbd/network.json'); done(); }
const noImporter = async url => { throw new Error('404 ' + url); };
function counting() {
  const calls = [];
  const f = async url => { calls.push(String(url)); return existsSync(file(url)) ? { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file(url), 'utf8')) } : { ok: false, status: 404 }; };
  return { f, calls };
}
const SRC = { commuter: 'file', local: 'llm', tourist: 'kv' };
let readerCalls = 0;
const fakeReader = async req => {
  readerCalls++;
  if (req.persona === 'delivery') throw new Error('crypto.subtle missing'); // 没有 .code → 接线层改用规则读数
  const r = await mockReadSigns(req);
  return { ...r, src: SRC[req.persona], model: 'fake-model', prompt_v: 'p1', range: { notice: [0.5, 0.9], understand: [0.6, 1], trust: [0.4, 0.8] } };
};

await t('aiLog：每次读屏调用都记一条，规则兜底照实记', async () => {
  readerCalls = 0;
  const { f, calls } = counting();
  const seen = [];
  const be = await connect({ fetch: f, importer: noImporter, readSigns: fakeReader, onAiLog: e => seen.push(e) });
  await be.pedsReady();
  const n0 = calls.length;
  const s = await be.run(be.demo('lonsdale'));
  const log = be.aiLog();
  ok(log.length === readerCalls && readerCalls > 0 && seen.length === log.length, `日志条数 = 读屏调用次数（${log.length} = ${readerCalls}），onAiLog 收到 ${seen.length} 条`);
  ok(log.every((e, i) => e.seq === i + 1 && typeof e.t === 'string' && !Number.isNaN(Date.parse(e.t)) && Number.isFinite(e.ms) && e.ms >= 0), '每条有递增 seq、ISO 时间、毫秒数');
  ok(log.every(e => ['commuter', 'local', 'tourist', 'delivery'].includes(e.persona) && Array.isArray(e.signs) && e.signs.length && Array.isArray(e.roads) && Number.isFinite(e.kmh) && e.read_s.length === e.signs.length),
    '每条带 persona / signs / roads / kmh / read_s（每块屏几秒）');
  const bySrc = p => log.filter(e => e.persona === p).map(e => e.src);
  ok(bySrc('commuter').every(x => x === 'file') && bySrc('local').every(x => x === 'llm') && bySrc('tourist').every(x => x === 'kv'), 'src 照读数给的记（file / llm / kv），不改写');
  const dl = log.filter(e => e.persona === 'delivery');
  ok(dl.length > 0 && dl.every(e => e.src === 'rule' && e.fallback === 'crypto.subtle missing' && e.reading?.src === 'rule'), `反向：reader 抛普通错改用规则 → 记 src: rule + fallback 原因（${dl.length} 条），不冒充大模型`);
  ok(calls.length === n0, `反向：run() + aiLog() 不多发任何请求（fetch 调用 ${n0} → ${calls.length}）`);
  const rd = be.readingsOf(s);
  ok(calls.length === n0, '反向：readingsOf() 不发请求');
  ok(rd && rd.street === s.street && rd.worksite === s.approaches[s.main].worksite, `readingsOf(s)：主路段 ${rd?.street}`);
  const c = rd?.personas?.commuter;
  ok(c && c.src === 'file' && c.reading.why && c.reading.range.notice[0] === 0.5 && c.model === 'fake-model' && Number.isFinite(c.ms), '通勤者：读数带 range / model / ms，src = file');
  ok(c && c.signs.map(x => x.kind).join(',') === 'vms,sign,arrow', `屏按经过顺序（远 → 近）：${c?.signs.map(x => x.kind)}`);
  ok(rd.personas.local.src === 'llm' && rd.personas.tourist.src === 'kv' && rd.personas.delivery.src === 'rule' && rd.personas.delivery.fallback, '四类人各自的来源（送货车是规则兜底，带 fallback）');
  ok(c.reading.why === s.why.commuter, '读数的 why 和 summary.why 是同一句（同一段、同一个请求）');
  rd.personas.commuter.reading.why = 'MUTATED';
  ok(be.readingsOf(s).personas.commuter.reading.why !== 'MUTATED' && be.aiLog()[0].reading?.why !== 'MUTATED', '返回的是拷贝：页面改了不影响下一次');
  ok(be.lastReadings()?.street === rd.street && be.readingsOf({}) === null && be.readingsOf(null) === null, 'lastReadings() = 最近一次 run；不是 run() 出的 summary → null');
  const before = be.aiLog().length;
  await be.run(be.demo('lonsdale'));
  ok(be.aiLog().length === before, '同一方案再跑：引擎缓存了读数，不再问、不多记');
});

await t('aiLog：环形缓冲有上限；订阅可退；回调出错不影响读数', async () => {
  readerCalls = 0;
  const { f } = counting();
  const got = [];
  const be = await connect({ fetch: f, importer: noImporter, readSigns: fakeReader, aiLogMax: 5 });
  const off = be.onAiLog(e => got.push(e.seq));
  be.onAiLog(() => { throw new Error('page bug'); });
  const s = await be.run(be.demo('lonsdale'));
  const log = be.aiLog();
  ok(readerCalls > 5 && log.length === 5 && log[4].seq === readerCalls && log[0].seq === readerCalls - 4, `上限 5：调了 ${readerCalls} 次只留最后 5 条（seq ${log[0]?.seq}–${log[4]?.seq}）`);
  ok(got.length === readerCalls && s.flags.failed === 0, `订阅收到 ${got.length} 条；另一个回调抛错，读数照样全拿到（failed ${s.flags.failed}）`);
  off();
  const n = got.length;
  await be.run(be.demo('latrobe'));
  ok(readerCalls > n && got.length === n, `退订后不再收到（又调了 ${readerCalls - n} 次，订阅仍是 ${got.length} 条）`);
  ok(AI_LOG_MAX === 200, '默认上限 200 条');
});

await t('aiLog：请求不合规范（SignError）记 src: error，照抛', async () => {
  const be = await connect({ fetch: counting().f, importer: noImporter, readSigns: async req => { if (req.persona === 'tourist') { const e = new Error('bad'); e.code = 'bad_kind'; throw e; } return mockReadSigns(req); } });
  const s = await be.run(be.demo('lonsdale'));
  const bad = be.aiLog().filter(e => e.persona === 'tourist');
  ok(bad.length > 0 && bad.every(e => e.src === 'error' && e.error === 'bad_kind' && e.reading === null) && s.flags.failed > 0, `游客的请求全抛 bad_kind → ${bad.length} 条 src: error，flags.failed = ${s.flags.failed}`);
  const tr = be.readingsOf(s).personas.tourist;
  ok(tr.reading === null && tr.src === 'error', 'readingsOf：没读成的那类人 reading = null、src = error');
});

done();
