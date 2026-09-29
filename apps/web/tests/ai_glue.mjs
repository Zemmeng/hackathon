// AI 面板（src/js/9-ai.js 的 pure:begin…pure:end）：来源标签、读数卡片、调用日志、下载的 JSON；
// 再接真的 backend.js（假的读屏：file / llm / kv / 规则兜底），把 aiLog() / readingsOf() 喂给这些纯函数。不联网、不调大模型
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const WEB = HERE + '../';
const APPS = WEB + '../';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('✅ ' + msg); } else { fail++; console.log('❌ ' + msg); } };

const src = readFileSync(WEB + 'src/js/9-ai.js', 'utf8');
const eng = readFileSync(WEB + 'src/js/6-engine.js', 'utf8');
const m = src.match(/\/\* pure:begin[^\n]*\n([\s\S]*?)\/\* pure:end \*\//);
ok(!!m, '9-ai.js 有 pure:begin / pure:end 段');
// 页面里的 esc / TYPE_L / L 原样拿来（6-engine.js、0-i18n.js），不在测试里另写一份
const escLine = eng.match(/^const esc=.*$/m)?.[0], typeLine = eng.match(/^const TYPE_L=.*$/m)?.[0];
const i18n = readFileSync(WEB + 'src/js/0-i18n.js', 'utf8').replace("'use strict';", '');
ok(!!escLine && !!typeLine, '从 6-engine.js 取到 esc() 和 TYPE_L');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(i18n + '\n' + escLine + '\n' + typeLine + '\n' + m[1] +
  '\n;globalThis.G={LANG,aiSrcLabel,aiSrcTone,aiExplainLabel,aiExplainTone,aiPct,aiSigns,aiAdvice,aiLabel,aiPersonaHTML,aiLogRowHTML,aiLogJSON,AI_LOG_KEEP};', ctx);
const G = ctx.G;
const zh = f => { G.LANG.cur = 'zh'; try { return f(); } finally { G.LANG.cur = 'en'; } };

// 1 来源标签（第 3 步卡片、日志、6-engine.js 的 pill / 图例都用这一个）
const lab = { file: 'LLM · precomputed', kv: 'LLM · cached', llm: 'LLM · live', rule: 'Rules · fallback' };
ok(Object.entries(lab).every(([k, v]) => G.aiSrcLabel(k) === v), `英文标签：${Object.values(lab).join(' / ')}`);
ok(zh(() => [G.aiSrcLabel('file'), G.aiSrcLabel('kv'), G.aiSrcLabel('llm'), G.aiSrcLabel('rule')].join('/')) === '大模型 · 预先算好/大模型 · 缓存/大模型 · 现场/规则 · 兜底', '中文标签');
ok(G.aiSrcLabel('llm', 842.4) === 'LLM · live · 842 ms' && G.aiSrcLabel('file', 12) === 'LLM · precomputed', '只有现场调用带耗时');
ok(G.aiSrcLabel('mixed') === 'Mixed sources' && G.aiSrcLabel(null) === 'Unknown' && G.aiSrcLabel('deepseek-x') === 'deepseek-x', 'mixed / 空 / 不认识的原样（调用方再 esc）');
ok(['file', 'kv', 'llm'].every(k => G.aiSrcTone(k) === 'ok') && G.aiSrcTone('rule') === 'warn' && G.aiSrcTone('error') === 'risk' && G.aiSrcTone('mixed') === 'warn', '颜色：大模型绿、规则黄、出错红');
ok(G.aiExplainLabel('llm') === 'AI explanation · LLM' && G.aiExplainLabel('kv') === 'AI explanation · LLM cached' && G.aiExplainLabel('rule') === 'AI explanation · rules' && G.aiExplainTone('rule') === 'warn', '第 4 步解读的来源：大模型 / 缓存 / 规则');
ok(!/'Sign reading · estimate'|LLM reader pending|大模型读屏待接/.test(eng) && (eng.match(/esc\(aiSrcLabel\(f\.reading_src\)\)/g) || []).length === 3, '6-engine.js 的 pill 和图例（中英）都换成 aiSrcLabel，不再印原始 reading_src');

// 2 屏上文字、建议、百分比
const signs = [{ kind: 'vms', frames: [['ROADWORK', 'AHEAD'], ['USE', 'RUSSELL ST']], read_s: 5 }, { kind: 'sign', text: 'RIGHT LANE CLOSED' }, { kind: 'arrow', text: 'ARROW LEFT' }];
ok(G.aiSigns(signs).map(s => s.text).join(' | ') === 'ROADWORK AHEAD ▸ USE RUSSELL ST | RIGHT LANE CLOSED | ARROW LEFT', 'VMS 各帧用 ▸ 连，按传进来的顺序');
ok(G.aiAdvice({ advice: { 'Russell Street': 'use' }, saving_min: 9 }) === 'use Russell St · save 9 min', `建议：${G.aiAdvice({ advice: { 'Russell Street': 'use' }, saving_min: 9 })}`);
ok(G.aiAdvice({ advice: {}, saving_min: null, delay_min: null }) === 'no route advice' && zh(() => G.aiAdvice({ advice: {} })) === '没给路线建议', '没有路线建议 → no route advice / 没给路线建议');
ok(G.aiAdvice({ advice: { 'Lonsdale Street': 'avoid', X: 'maybe' }, delay_min: 10 }) === 'avoid Lonsdale St · 10 min delay', '别走 + 堵几分钟；不认识的建议值丢掉');
ok(G.aiPct(0.853) === 85 && G.aiPct(1.7) === 100 && G.aiPct(-2) === 0 && G.aiPct('50%;background:url(x)') === null && G.aiPct(null) === null, '百分比夹在 0–100，非数字 → null（进不了 style）');
ok(G.aiLabel('<b>Guided</b> kit') === 'bGuided/b kit' && G.aiLabel('x'.repeat(80)).length === 60, '方案名去掉 < >、截到 60 字（explain.js 的规矩）');

// 3 反向断言（注入）：屏上文字、路名、模型写的理由都不能原样进 HTML
const evil = '<img src=x onerror=alert(1)>';
const card = G.aiPersonaHTML('commuter', { signs: [{ kind: 'vms', frames: [[evil]] }, { kind: 'sign', text: '<script>x()</script>' }], src: 'llm', ms: 900,
  reading: { notice: '0.8"><i onmouseover=1', understand: 0.9, trust: 0.7, advice: { [evil]: 'use' }, saving_min: 3, why: 'WHY<svg onload=1>TEXT', range: { notice: [0.6, 0.9], understand: ['<', 1], trust: [0.5, 0.8] } } });
ok(!/<img|<script|<svg|onmouseover=1/.test(card) && card.includes('&lt;img'), '读数卡片：屏上文字 / 路名 / 读数字段都转义，没有可执行的标签');
ok(!card.includes('WHY') && card.includes('data-aiwhy="commuter"'), '理由（why）不进 HTML，留给 textContent（data-aiwhy）');
ok(card.includes('LLM · live · 900 ms') && card.includes('50–80%') && !card.includes('NaN'), '卡片带来源 + 耗时、信不信的区间；坏掉的区间不画');
ok(G.aiPersonaHTML('tourist', null).includes('No signs on this road') && G.aiPersonaHTML('delivery', { signs, src: 'error', reading: null }).includes('not persuaded'), '没屏 / 没读成各有一句话');
const row = G.aiLogRowHTML({ t: '2026-09-29T12:00:00Z', persona: '<b>x</b>', signs: [{ kind: 'sign', text: evil }], src: '<i>', ms: 5, reading: { advice: { [evil]: 'avoid' } } });
ok(!/<img|<b>x|<i>/.test(row), '日志一行：人、屏上文字、来源、建议都转义');
ok(!G.aiPersonaHTML('__proto__', null).includes('undefined'), '不认识的人的类型不会查到原型链上');

// 4 下载的 JSON：只放白名单字段（反向：日志条目里多带的 header / token 不出现在文件里）
const fake = 'sk' + '-' + 'Z'.repeat(24);
const log = [{ seq: 1, t: '2026-09-29T12:00:00Z', persona: 'commuter', signs, roads: ['Lonsdale St', 'Russell St'], kmh: 40, read_s: [5, 4, 4], src: 'llm', model: 'm1', ms: 812,
  reading: { notice: 0.8, understand: 0.9, trust: 0.7, advice: { 'Russell St': 'use' }, saving_min: 9, delay_min: null, why: 'Told to use Russell.', src: 'llm', model: 'm1', prompt_v: 'r1', raw: fake },
  authorization: 'Bearer ' + fake, headers: { 'x-api-key': fake }, token: fake }];
let parsed = null;
try { parsed = JSON.parse(G.aiLogJSON(log, { exported_at: '2026-09-29T12:01:00Z', lang: 'en', secret: fake })); } catch { parsed = null; }
ok(parsed && parsed.count === 1 && parsed.entries[0].reading.why === 'Told to use Russell.' && parsed.entries[0].signs[1].text === 'RIGHT LANE CLOSED' && parsed.entries[0].ms === 812, '下载的是合法 JSON：条数、读数、屏上文字、耗时都在');
const txt = G.aiLogJSON(log, { secret: fake });
ok(!txt.includes(fake) && !/authorization|headers|token|x-api-key|"raw"|"secret"/i.test(txt), '反向：多带的 authorization / headers / token / raw / meta.secret 都不进文件');
ok(JSON.parse(G.aiLogJSON(null)).count === 0 && G.AI_LOG_KEEP === 200, '空日志也能导出；页面最多留 200 条（和 backend.js 一样）');

// 5 真的 backend.js：假读屏 → aiLog() / readingsOf() → 页面的纯函数
const file = p => APPS + p.replace(/^\//, '');
const fakeFetch = async url => (existsSync(file(url)) ? { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file(url), 'utf8')) } : { ok: false, status: 404 });
const noImporter = async url => { throw new Error('404 ' + url); };
if (!existsSync(file('/roads/public/cbd/network.json'))) ok(false, '找不到 apps/roads/public/cbd/network.json');
else {
  const { connect } = await import(pathToFileURL(APPS + 'engine/public/js/backend.js').href);
  const { mockReadSigns } = await import(pathToFileURL(APPS + 'engine/public/js/index.js').href);
  const S = { commuter: 'file', local: 'llm', tourist: 'kv' };
  const be = await connect({ fetch: fakeFetch, importer: noImporter, readSigns: async req => {
    if (req.persona === 'delivery') throw new Error('no crypto.subtle');
    return { ...(await mockReadSigns(req)), src: S[req.persona], model: 'fake', range: { notice: [0.5, 0.9], understand: [0.6, 1], trust: [0.4, 0.8] } };
  } });
  const s = await be.run(be.demo('lonsdale'));
  const rd = be.readingsOf(s), lg = be.aiLog();
  const cards = ['commuter', 'local', 'tourist', 'delivery'].map(t => G.aiPersonaHTML(t, rd.personas[t]));
  ok(rd && cards[0].includes('LLM · precomputed') && cards[1].includes('LLM · live') && cards[2].includes('LLM · cached') && cards[3].includes('Rules · fallback') && cards[3].includes('Reader error'),
    `4 张卡片的来源：file / llm / kv / 规则兜底（主路段 ${rd?.street}）`);
  ok(cards[0].indexOf('VMS') < cards[0].indexOf('RIGHT LANE CLOSED'), '卡片里的屏按经过顺序：VMS 在前，标志牌在后');
  const out = JSON.parse(G.aiLogJSON(lg, {}));
  ok(lg.length > 0 && out.count === lg.length && out.entries.every(e => e.persona && e.src && Array.isArray(e.signs)), `真日志 ${lg.length} 条 → 下载文件 ${out.count} 条`);
  ok(lg.map(G.aiLogRowHTML).every(h => h.includes('class="ai-row"')), '每条日志都能画成一行');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
