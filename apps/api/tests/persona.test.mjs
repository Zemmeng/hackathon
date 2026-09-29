// askPersonas / askAdvisor 的兜底链：答案文件 → Worker → 规则；任何一环坏了都要回合格的答案，并如实标 src
import { ok, t, done, refCard } from './_t.mjs';
import { askPersonas, askAdvisor, combine, _resetAnswers, TYPES, MIX, RULE_MODEL } from '../public/js/persona.js';
import { ruleAnswer } from '../public/js/rules.js';
import { cardKey } from '../public/js/cardkey.js';

const card = refCard([['USE', 'RUSSELL ST', 'SAVE 8 MIN']]);
const ANS = 'http://t/answers.json', BASE = 'http://t/api';
const res = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const llmAnswer = { share: { stay: 0.5, r1: 0.4, r2: 0.1 }, lo: 0.45, hi: 0.55, notice: 0.9, understand: 0.9, why: 'test', n: 3 };
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

// 假 fetch：答案文件和 /persona 各自按 handler 回
function fake({ file = null, persona = null, advisor = null } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push(url);
    if (url === ANS) return file ? file() : res({}, 404);
    if (url === BASE + '/persona') return persona ? persona(JSON.parse(init.body), init) : res({}, 404);
    if (url === BASE + '/advisor') return advisor ? advisor(JSON.parse(init.body)) : res({}, 404);
    return res({}, 404);
  };
  f.calls = calls;
  return f;
}
const opts = f => ({ fetch: f, base: BASE, answersUrl: ANS });

await t('force rule', async () => {
  const a = await askPersonas(card, { force: 'rule' });
  ok(a.src === 'rule' && a.model === RULE_MODEL && TYPES.every(x => a.by_type[x].src === 'rule'), 'force: rule → 4 类都是规则估算，src = rule');
  ok(Math.abs(sum(a.raw) - 1) < 0.01 && Math.abs(sum(a.mix) - 1) < 1e-9, 'raw（按车流占比加权）合计为 1，mix 合计为 1');
});

await t('answers file hit', async () => {
  _resetAnswers();
  const key = await cardKey(card, 'p1');
  const entry = { by_type: Object.fromEntries(TYPES.map(x => [x, llmAnswer])) };
  const f = fake({ file: () => res({ prompt_v: 'p1', model: 'm-test', entries: { [key]: entry } }) });
  const a = await askPersonas(card, opts(f));
  ok(a.src === 'file' && a.model === 'm-test' && a.prompt_v === 'p1', '答案文件里有 → src = file，带上文件里的 model / prompt_v');
  ok(!f.calls.includes(BASE + '/persona'), '答案文件命中时不再问 Worker');
  const again = await askPersonas(refCard([['USE', 'RUSSELL ST', 'SAVE 8 MIN']], { signs: [...card.signs].reverse() }), opts(f));
  ok(again.src === 'file' && f.calls.filter(u => u === ANS).length === 1, '同一场景换个写法（标志顺序反过来）也命中；答案文件只拉一次');
  _resetAnswers();
  const bad = { ...entry, by_type: { ...entry.by_type, delivery: { ...llmAnswer, share: { stay: 0.2, r1: 0.1, r2: 0.7 } } } };
  const g = fake({ file: () => res({ prompt_v: 'p1', model: 'm-test', entries: { [key]: bad } }) });
  const b = await askPersonas(card, opts(g));
  ok(b.src === 'file' && b.by_type.delivery.share.r2 === 0 && Math.abs(b.by_type.delivery.share.stay + b.by_type.delivery.share.r1 - 1) < 0.01, '反向：答案文件里送货司机走禁货车的 Elizabeth St → 清零，按比例补回');
});

await t('worker answers', async () => {
  _resetAnswers();
  const f = fake({ persona: b => res({ ok: true, src: 'llm', type: b.type, answer: llmAnswer, model: 'm-test', prompt_v: 'p1' }) });
  const a = await askPersonas(card, opts(f));
  ok(a.src === 'llm' && a.model === 'm-test' && f.calls.filter(u => u === BASE + '/persona').length === 4, '答案文件没有 → 按类发 4 个请求，src = llm');
  const exp = TYPES.reduce((s, x) => s + MIX[x] * (x === 'delivery' ? llmAnswer.share.r1 / 0.9 : llmAnswer.share.r1), 0); // 送货司机那一类的 r2（禁货车）清零后按比例补回
  ok(Math.abs(a.raw.r1 - exp) < 0.002, `raw 是按车流占比加权的平均（r1 = ${a.raw.r1}）`);
});

await t('one type fails', async () => {
  _resetAnswers();
  const f = fake({ persona: b => (b.type === 'tourist' ? res({ ok: false }, 500) : res({ ok: true, src: 'kv', answer: llmAnswer, model: 'm', prompt_v: 'p1' })) });
  const a = await askPersonas(card, opts(f));
  ok(a.by_type.tourist.src === 'rule' && a.by_type.tourist.fallback === 'http_500' && a.by_type.commuter.src === 'kv', '游客那一类 500 → 只有它用规则兜底，其余照用缓存');
  ok(a.src === 'rule', '顶层 src 取最「估算」的一类（界面据此标「估算」）');
});

await t('bad worker answer', async () => {
  _resetAnswers();
  const f = fake({ persona: () => res({ ok: true, src: 'llm', answer: { share: { stay: 0.9, r1: 0.5, r2: 0.1 } } }) });
  const a = await askPersonas(card, opts(f));
  ok(TYPES.every(x => a.by_type[x].fallback === 'bad_response'), 'Worker 回的比例合计不是 1 → 不用，规则兜底（bad_response）');
  const g = fake({ persona: () => res({ ok: true, src: 'magic', answer: llmAnswer }) });
  const b = await askPersonas(card, opts(g));
  ok(TYPES.every(x => b.by_type[x].src === 'rule'), 'Worker 回了不认识的 src → 规则兜底');
});

await t('network and timeout', async () => {
  _resetAnswers();
  const boom = fake({ persona: () => { throw new Error('offline'); } });
  const a = await askPersonas(card, opts(boom));
  ok(TYPES.every(x => a.by_type[x].fallback === 'network'), '网络异常 → 规则兜底（network）');
  _resetAnswers();
  const hang = fake({ persona: () => new Promise(() => {}) });
  const t0 = Date.now();
  const b = await askPersonas(card, { ...opts(hang), timeoutMs: 50 });
  ok(TYPES.every(x => b.by_type[x].fallback === 'timeout') && Date.now() - t0 < 1000, `Worker 一直不回 → 到点用规则（timeout，用了 ${Date.now() - t0} ms）`);
  const noFetch = await askPersonas(card, { fetch: null, base: BASE });
  ok(noFetch.src === 'rule' && TYPES.every(x => noFetch.by_type[x].fallback === 'no_fetch'), '显式不给 fetch → 不联网，直接规则（no_fetch）');
});

await t('cardKey', async () => {
  const k0 = await cardKey(card, 'p1');
  const rev = { ...card, routes: [...card.routes].reverse() };
  ok(await cardKey(rev, 'p1') === k0, '缓存键：路线顺序不同 → 同一个键');
  const noTruck = { ...card, routes: card.routes.map(r => ({ ...r, truck: undefined })) };
  ok(await cardKey(noTruck, 'p1') !== k0, '缓存键：禁货车标记不同 → 不同的键（不能把能走货车的答案给禁货车的卡）');
  const slow = { ...card, signs: card.signs.map(s => (s.kind === 'vms' ? { ...s, read_s: 18 } : s)) };
  ok(await cardKey(slow, 'p1') !== k0 && await cardKey(card, 'p2') !== k0, '缓存键：能读几秒不同、prompt_v 不同 → 不同的键');
  const turn = { ...card, routes: card.routes.map(r => (r.id === 'r1' ? { ...r, turn_m: 200 } : r)) };
  ok(await cardKey(turn, 'p1') !== k0, '缓存键：拐口距离不同 → 不同的键');
});

await t('combine', async () => {
  const bt = Object.fromEntries(TYPES.map(x => [x, { ...ruleAnswer(x, card), src: 'rule' }]));
  const a = combine(bt, card);
  const exp = TYPES.reduce((s, x) => s + MIX[x] * bt[x].share.stay, 0);
  ok(Math.abs(a.raw.stay - exp) < 0.001 && a.src === 'rule', 'combine 按 MIX 加权');
});

await t('advisor', async () => {
  const summary = { worksites: [{ id: 'A', dir: 'W', equipment: [{ id: 'v', type: 'vms', at_m: 300, frames: [['ROADWORK', 'AHEAD']] }] }],
    approaches: [{ worksite: 'A', dir: 'W', routes: [{ id: 'stay', name: 'La Trobe St', now_min: 9 }, { id: 'r1', name: 'Russell St', now_min: 6, diverge_m: 200 }] }] };
  const bad = fake({ advisor: () => res({ ok: true, src: 'llm', suggestions: [{ kind: 'text', worksite: 'A', equipment: 'v', frames: [['WAY TOO LONG LINE']] }] }) });
  const a = await askAdvisor(summary, opts(bad));
  ok(a.src === 'rule' && a.fallback === 'bad_response' && a.suggestions.length >= 1, 'Worker 回的建议不合规（一行超 10 字符）→ 用规则版建议');
  const good = fake({ advisor: () => res({ ok: true, src: 'llm', suggestions: [{ kind: 'shift', worksite: 'A', days: 2, why: 'x' }] }) });
  const b = await askAdvisor(summary, opts(good));
  ok(b.src === 'llm' && b.suggestions[0].days === 2, 'Worker 回的建议合规 → 照用，src = llm');
  const html = fake({ advisor: () => new Response('<html>oops</html>', { status: 200 }) });
  const h = await askAdvisor(summary, opts(html));
  ok(h.src === 'rule' && h.fallback === 'bad_json', 'Worker 回的不是 JSON → 规则版，fallback = bad_json（不是 network）');
  const far = { worksites: [{ id: 'A', time: { from: '2026-10-01', to: '2026-12-31' }, equipment: [] }, { id: 'B', time: { from: '2026-10-02', to: '2026-10-03' }, equipment: [] }],
    approaches: [], conflicts: [{ a: 'A', b: 'B', cost_min: 50 }] };
  const f2 = await askAdvisor(far, { force: 'rule' });
  ok(f2.suggestions.every(s => s.kind !== 'shift' || Math.abs(s.days) <= 60), '浏览器端的规则版建议也过 checkSuggestion（推迟 91 天这种不合规的丢掉），和 Worker 一致');
  const c = await askAdvisor(summary, { force: 'rule' });
  ok(c.src === 'rule' && c.suggestions[0].kind === 'text', 'force: rule → 规则版建议');
});

done();
