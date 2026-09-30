// 用途：用假的 fetch 测 public/js/sumo-client.js —— 云端正常走 live；查活失败、限流、忙、运行失败、超时、取消、404 都回预跑结果并写明原因；
//       挑最近格点；manifest / chunk 地址和 sha256；预跑结果任何情况下都不会被标成「云端实时」；
//       真实 CBD 路网（contract v2）：loadReal / runReal / realManifest / realChunk 两种来源、回退原因、文案（§11–§15）
// 用法：node apps/sumo/tests/client.test.mjs（test.sh 会自动跑）；不联网、不需要 wrangler；最后一行固定「N passed, M failed」
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSumoClient, labels, sourceLabel, reasonLabel, SCENARIOS, DEFAULT_PARAMS, realLabels, realSourceLabel, REAL_SCENARIOS, REAL_DEFAULTS, REAL_TIMEOUT_MS, OPTION_IDS } from '../public/js/sumo-client.js';

let P = 0, F = 0;
const ok = (cond, msg) => { if (cond) { P++; console.log('✅ ' + msg); } else { F++; console.log('❌ ' + msg); } };

const RID = 'a'.repeat(32);
const ENGINE = 'Eclipse SUMO sumo 1.27.1';
const FAIL_TEXT = 'Simulation integrity failure footpath: {"collisions": 1} [\'collision\']';
const PRESET = { seed: 42, scenarios: [...SCENARIOS], demand_duration_s: 600, clearance_s: 1200, demand_scale: 1.0, diversion_share: 0.45 };
const idx = (tag, extra = {}) => ({ version: 1, engine: ENGINE, tag, scenarios: SCENARIOS.map((id) => ({ id, manifest: `${id}/manifest.json`, metrics: {} })), ...extra });
const keyOf = (d, x) => `s42-d${d.toFixed(2)}-x${x.toFixed(1)}`;

// ---- 预跑文件（照 bake.py 的布局；s42-d0.60-x1.2 故意记成 failed）----
const grid = [];
const files = {};
for (const d of [0, 0.15, 0.3, 0.45, 0.6]) for (const x of [0.8, 1.0, 1.2]) {
  const key = keyOf(d, x), params = { ...PRESET, diversion_share: d, demand_scale: x };
  if (d === 0.6 && x === 1.2) { grid.push({ key, params, status: 'failed', error_kind: 'sumo', error: FAIL_TEXT }); continue; }
  grid.push({ key, params, status: 'complete', path: `grid/${key}.json` });
  files[`grid/${key}.json`] = idx(key, { source: 'live' }); // 文件里就算写着 live，也不能盖过 baked
}
files['baked.json'] = { version: 1, generated_at: '2026-09-30T08:00:00+00:00', source: 'cloudflare-container', engine: ENGINE, generator_sha256: 'f'.repeat(64), preset: { params: PRESET, path: 'preset/index.json' }, grid };
files['preset/index.json'] = idx('preset');
const CHUNK = { frames: [{ t: 0, a: [], q: [], signals: {}, counts: {} }] };
const CHUNK_SHA = createHash('sha256').update(JSON.stringify(CHUNK)).digest('hex');
files['preset/closure/manifest.json'] = { scenario: 'closure', chunks: [{ file: 'frames-000.json', sha256: CHUNK_SHA, frames: 1 }] };
files['preset/closure/frames-000.json'] = CHUNK;

// ---- 真实路网（contract v2）的预跑文件：/sumo/public/real/ ----
const WORKS = { link: 'l595594354_9756035316', lanes_closed: 1 };
const realIdx = (tag, extra = {}) => ({
  version: 2, network: 'real', engine: ENGINE, generator_sha256: 'e'.repeat(64), seed: 42, hour: 8, works: WORKS, tag,
  params: { seed: 42, p_original: 0.14, p_ai: 0.53 }, assumptions: { en: ['a'], zh: ['甲'] },
  scenarios: REAL_SCENARIOS.map((id) => ({ id, label: { en: id, zh: id }, diversion_share: id === 'ai' ? 0.53 : id === 'original' ? 0.14 : 0, manifest: `${id}/manifest.json`, metrics: {} })), ...extra,
});
const RCHUNK = { frames: [{ t: 0, a: [[0, 144963000, -37812000, 90, 850]], tls: { J1: 'GGrr' }, q: 12.5 }] };
const RCHUNK_TEXT = JSON.stringify(RCHUNK);
const RCHUNK_SHA = createHash('sha256').update(RCHUNK_TEXT).digest('hex');
const rman = (sc) => ({ version: 2, network: 'real', scenario: sc, duration_s: 60, sample_s: 1, clock0_s: 180, agent_columns: ['i', 'lon_e6', 'lat_e6', 'angle_deg', 'speed_cms'], agents: [{ id: 'v0', type: 'car', length_m: 4.5, width_m: 1.8 }], signal_heads: [], chunks: [{ file: 'frames-000.json', start: 0, end: 59, sha256: RCHUNK_SHA }], metrics: {}, per_minute: { halting: [], harsh: [] } });
const realFiles = { 'index.json': realIdx('baked', { source: 'live' }) }; // 文件里就算写着 live，也不能盖过 baked
for (const sc of REAL_SCENARIOS) { realFiles[`${sc}/manifest.json`] = rman(sc); realFiles[`${sc}/frames-000.json`] = RCHUNK; }

const json = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
// 一直不回，直到被 abort（模拟卡住的容器）
const hang = (init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));

// 假服务器：o.health / o.post / o.poll 可替换；o.polls 是依次返回的状态；o.bakedDown 让静态文件也连不上
function fake(o = {}) {
  const calls = [];
  const polls = [...(o.polls || ['running', 'complete'])];
  const fetch = async (url, init = {}) => {
    const u = String(url), method = init.method || 'GET';
    calls.push({ url: u, method, body: init.body });
    if (init.signal && init.signal.aborted) throw new DOMException('aborted', 'AbortError');
    if (u.startsWith('/sumo/public/real/')) {
      if (o.realDown) throw new TypeError('fetch failed');
      const f = o.realFiles ? o.realFiles[u.slice('/sumo/public/real/'.length)] : realFiles[u.slice('/sumo/public/real/'.length)];
      return f === undefined ? new Response('Not found', { status: 404 }) : json(200, f);
    }
    if (u.startsWith('/sumo/public/baked/')) {
      if (o.bakedDown) throw new TypeError('fetch failed');
      const f = files[u.slice('/sumo/public/baked/'.length)];
      return f === undefined ? new Response('Not found', { status: 404 }) : json(200, f);
    }
    if (u === '/api/sumo/v1/health') return o.health ? o.health(init) : json(200, { version: 1, engine: ENGINE, status: 'ready', active_jobs: 0 });
    if (u === '/api/sumo/v1/runs' && method === 'POST') return o.post ? o.post(init) : json(202, { version: 1, id: RID, status: 'queued' });
    if (u === `/api/sumo/v1/runs/${RID}`) {
      if (o.poll) return o.poll(init);
      const st = polls.length > 1 ? polls.shift() : polls[0];
      return json(200, { id: RID, status: st, ...(st === 'failed' ? { error: FAIL_TEXT } : {}) });
    }
    if (u === `/api/sumo/v1/runs/${RID}/index.json`) return o.index ? o.index(init) : json(200, idx('live', { config: { ...PRESET, diversion_share: 0.3 } }));
    if (u === `/api/sumo/v1/runs/${RID}/closure/manifest.json`) return json(200, { scenario: 'closure', chunks: [] });
    if (u.startsWith(`/api/sumo/v1/runs/${RID}/`)) {
      const f = realFiles[u.slice(`/api/sumo/v1/runs/${RID}/`.length)];
      if (f !== undefined) return u.endsWith('.json') && f.frames ? new Response(RCHUNK_TEXT, { status: 200, headers: { 'content-type': 'application/json' } }) : json(200, f);
    }
    return json(404, { ok: false, error: 'not_found', msg: 'no route ' + u });
  };
  return { fetch, calls, posts: () => calls.filter((c) => c.method === 'POST') };
}
const client = (f, extra = {}) => createSumoClient({ fetch: f.fetch, pollMs: 5, timeoutMs: 2000, ...extra });
const neverLive = (r, msg) => ok(r.source === 'baked' && sourceLabel(r, 'zh') === labels.zh.baked && sourceLabel(r, 'en') === labels.en.baked
  && !/实时|Live/.test(sourceLabel(r, 'zh') + sourceLabel(r, 'en')) && r.runId === undefined, `${msg}：source=baked、文案是「预先跑好」、不带 runId`);

try {
  // ---- 1. 云端正常：health → POST → queued/running/complete → index ----
  {
    const f = fake({ polls: ['queued', 'running', 'running', 'complete'] });
    const phases = [];
    const r = await client(f).run({ diversion_share: 0.3, evil: 1, scenarios: undefined }, { onStatus: (s) => phases.push(s.phase) });
    ok(r.source === 'live' && r.runId === RID && r.index.tag === 'live' && r.index.scenarios.length === 4 && r.hasReplay === true, `live：source=live、runId、index 都对（${r.source} ${r.reason || ''}）`);
    ok(Number.isFinite(r.elapsedMs) && r.elapsedMs >= 0 && r.reason === undefined, `live：elapsedMs=${Math.round(r.elapsedMs)}，没有 reason`);
    ok(/^云端实时运行 · 用时 \d+\.\d s$/.test(sourceLabel(r, 'zh')) && /^Live cloud run · \d+\.\d s$/.test(sourceLabel(r, 'en')), `live 文案：${sourceLabel(r, 'zh')} / ${sourceLabel(r, 'en')}`);
    const body = JSON.parse(f.posts()[0].body);
    ok(JSON.stringify(body) === '{"diversion_share":0.3}', `POST 只带白名单字段、不带 undefined：${JSON.stringify(body)}`);
    ok(['health', 'submit', 'queued', 'running', 'complete', 'done'].every((p) => phases.includes(p)) && phases.every((p, i) => p !== phases[i - 1]), `onStatus 阶段：${phases.join(' → ')}（同一状态只报一次）`);
    ok(f.calls.every((c) => !c.url.startsWith('/sumo/public/baked/')), 'live 成功时不去取预跑文件');
    const m = await client(f).manifest(r, 'closure');
    ok(f.calls.at(-1).url === `/api/sumo/v1/runs/${RID}/closure/manifest.json` && Array.isArray(m.chunks), 'live 的 manifest 走 /api/sumo/v1/runs/<id>/<情景>/manifest.json');
    const h = await client(f).health();
    ok(h.ok === true && h.engine === ENGINE && h.activeJobs === 0, 'health() → ok、engine、activeJobs');
  }

  // ---- 2. 查活失败 → 预跑结果，不 POST ----
  for (const [name, health, reason] of [
    ['连不上（fetch 抛错）', () => { throw new TypeError('fetch failed'); }, 'network'],
    ['503 sumo_off', () => json(503, { ok: false, error: 'sumo_off', msg: '现场 SUMO 服务没接上' }), 'sumo_off'],
    ['502 sumo_down', () => json(502, { ok: false, error: 'sumo_down', msg: '没有响应' }), 'sumo_down'],
    ['503 sumo_starting', () => json(503, { ok: false, error: 'sumo_starting', msg: '启动中' }), 'sumo_starting'],
    ['200 但返回 HTML', () => new Response('<!doctype html>', { status: 200 }), 'bad_response'],
    ['卡住不回（查活超时）', hang, 'timeout'],
  ]) {
    const f = fake({ health });
    const t0 = Date.now();
    const r = await client(f, { timeoutMs: 150 }).run({ diversion_share: 0.3, demand_scale: 0.8 });
    ok(r.reason === reason && r.key === 's42-d0.30-x0.8' && r.exact === true && f.posts().length === 0, `查活 ${name} → baked，reason=${r.reason}，最近格点 ${r.key}，没有 POST`);
    neverLive(r, `查活 ${name}`);
    if (reason === 'timeout') ok(Date.now() - t0 < 1500, `查活超时按 timeoutMs 收住（${Date.now() - t0} ms）`);
  }

  // ---- 3. POST 被拒：429 限流 / 忙、400 参数 ----
  for (const [name, post, reason, text] of [
    ['429 sumo_rate', () => json(429, { ok: false, error: 'sumo_rate', msg: '每分钟最多 3 次' }), 'sumo_rate', '每分钟最多 3 次'],
    ['429 sumo_busy', () => json(429, { ok: false, error: 'sumo_busy', msg: '正忙' }), 'sumo_busy', '正忙'],
    ['容器自己的 429 Queue full', () => json(429, { error: 'Queue full; retry when an active run completes' }), 'sumo_busy', 'Queue full'],
    ['400 参数超范围', () => json(400, { error: 'demand_scale must be a number in [0.1, 1.2]' }), 'bad_params', 'demand_scale'],
    ['POST 卡住', hang, 'timeout', ''],
  ]) {
    const f = fake({ post });
    const r = await client(f, { timeoutMs: 300 }).run({ diversion_share: 0.15, demand_scale: 1.2 });
    ok(r.reason === reason && r.key === 's42-d0.15-x1.2' && (!text || String(r.error).includes(text)), `POST ${name} → baked，reason=${r.reason}，error「${String(r.error).slice(0, 40)}」`);
    neverLive(r, `POST ${name}`);
  }

  // ---- 4. 运行失败 → 预跑结果 + 服务端原话 ----
  {
    const f = fake({ polls: ['running', 'failed'] });
    const r = await client(f).run({ diversion_share: 0, demand_scale: 1.0 });
    ok(r.reason === 'sumo_failed' && r.error === FAIL_TEXT && r.liveRunId === RID && r.key === 's42-d0.00-x1.0', `运行 failed → baked，reason=sumo_failed，error 原样：${r.error.slice(0, 50)}…`);
    neverLive(r, '运行 failed');
  }

  // ---- 5. 超时：一直 running → 45 s（这里 120 ms）后回预跑 ----
  {
    const f = fake({ polls: ['running'] });
    const t0 = Date.now();
    const r = await client(f, { timeoutMs: 120, pollMs: 10 }).run({});
    ok(r.reason === 'timeout' && r.key === 'preset' && r.hasReplay === true && r.liveRunId === RID, `一直 running → baked，reason=timeout，回预设（${Date.now() - t0} ms）`);
    ok(Date.now() - t0 < 1500, '超时按 timeoutMs 收住，不会一直转圈');
    neverLive(r, '超时');
    const g = fake({ poll: hang });
    const r2 = await client(g, { timeoutMs: 150 }).run({});
    ok(r2.reason === 'timeout' && r2.source === 'baked', `轮询请求卡住也按总时限回预跑（reason=${r2.reason}）`);
  }

  // ---- 6. 轮询 404（容器重启丢了运行）/ 用户取消 ----
  {
    const f = fake({ poll: () => json(404, { error: 'Run not found' }) });
    const r = await client(f).run({});
    ok(r.reason === 'not_found' && r.source === 'baked', `轮询 404 → baked，reason=${r.reason}`);
    const ctl = new AbortController();
    const g = fake({ polls: ['running'] });
    const r2 = await client(g, { pollMs: 20 }).run({}, { signal: ctl.signal, onStatus: (s) => { if (s.phase === 'running') ctl.abort(); } });
    ok(r2.reason === 'cancelled' && r2.source === 'baked', `用户取消 → baked，reason=${r2.reason}`);
    const pre = new AbortController(); pre.abort();
    const h = fake();
    const r3 = await client(h).run({}, { signal: pre.signal });
    ok(r3.reason === 'cancelled' && h.calls.every((c) => !c.url.startsWith('/api/')), '已取消的 signal：一个云端请求都不发');
  }

  // ---- 7. 挑最近的预跑点 ----
  {
    const f = fake();
    const s = client(f);
    const a = await s.bakedFor({});
    ok(a.key === 'preset' && a.exact === true && a.hasReplay === true && a.index.tag === 'preset', '默认参数 → 预设（exact、有轨迹）');
    const b = await s.bakedFor({ diversion_share: 0.45, demand_scale: 1 });
    ok(b.key === 'preset' && b.hasReplay === true, '和预设相同的格点 → 用预设（同一批结果，多了轨迹）');
    const c = await s.bakedFor({ diversion_share: 0.2, demand_scale: 1.15 });
    ok(c.key === 's42-d0.15-x1.2' && c.exact === false && c.hasReplay === false && c.index.tag === c.key, `(0.2, 1.15) → ${c.key}，exact=false、只有指标`);
    const d = await s.bakedFor({ diversion_share: 0.3, demand_scale: 0.8 });
    ok(d.key === 's42-d0.30-x0.8' && d.exact === true, `正好在格点上 → ${d.key}，exact=true`);
    const e = await s.bakedFor({ diversion_share: 0.6, demand_scale: 1.2 });
    ok(e.key === 's42-d0.45-x1.2' && e.exact === false && e.failedExact && e.failedExact.key === 's42-d0.60-x1.2' && e.failedExact.error === FAIL_TEXT,
      `请求的格点预跑时失败 → 不跳过也不编：换最近的 ${e.key}，并带 failedExact（${e.failedExact && e.failedExact.key}）`);
    const g = await s.bakedFor({ seed: 7, diversion_share: 0.3, demand_scale: 1 });
    ok(g.key === 's42-d0.30-x1.0' && g.exact === false && g.requested.seed === 7, '换了 seed → 同参数格点但 exact=false（预跑只有 seed 42）');
    const h = await s.bakedFor({ diversion_share: 'x', demand_scale: null });
    ok(h.key === 'preset', '参数不是数 → 按默认值挑（预设）');
    ok(f.calls.filter((x) => x.url.endsWith('/baked.json')).length === 1 && f.calls.filter((x) => x.url.endsWith('/preset/index.json')).length === 1, 'baked.json、同一个 index 只下载一次');
    ok(a.bakedOn === 'cloudflare-container' && a.source === 'baked' && a.engine === ENGINE && a.generatedAt === files['baked.json'].generated_at, '目录里的 source（在哪跑的）放进 bakedOn，不会顶掉 source=baked');
    ok(c.source === 'baked', '格点 index 文件里写着 source=live 也照样是 baked');
  }

  // ---- 8. 两边都拿不到 → source=none；预跑失败不缓存 ----
  {
    const f = fake({ health: () => { throw new TypeError('fetch failed'); }, bakedDown: true });
    const r = await client(f).run({});
    ok(r.source === 'none' && r.reason === 'network' && typeof r.bakedError === 'string' && r.index === null && sourceLabel(r) === labels.zh.none, `云端和预跑都连不上 → source=none，文案「${sourceLabel(r)}」`);
    let down = true;
    const g = fake();
    const flaky = { fetch: (u, i) => (down && String(u).includes('/baked/') ? Promise.reject(new TypeError('fetch failed')) : g.fetch(u, i)) };
    const s = client(flaky);
    let threw = false;
    try { await s.bakedFor({}); } catch { threw = true; }
    down = false;
    const again = await s.bakedFor({});
    ok(threw && again.key === 'preset', '预跑目录第一次取失败 → 抛错；恢复后再取能拿到（失败不缓存）');
  }

  // ---- 9. manifest / chunk：地址、只有预设有轨迹、sha256 ----
  {
    const f = fake();
    const s = client(f);
    const pre = await s.bakedFor({});
    const m = await s.manifest(pre, 'closure');
    ok(f.calls.at(-1).url === '/sumo/public/baked/preset/closure/manifest.json', '预设的 manifest 走 /sumo/public/baked/preset/<情景>/manifest.json');
    const c = await s.chunk(pre, 'closure', m.chunks[0]);
    ok(c.frames.length === 1 && f.calls.at(-1).url === '/sumo/public/baked/preset/closure/frames-000.json', '传 manifest.chunks[i] → 下载并核对 sha256 通过');
    const codeOf = async (p) => { try { await p; return 'no-throw'; } catch (e) { return e.code; } };
    ok(await codeOf(s.chunk(pre, 'closure', { file: 'frames-000.json', sha256: '0'.repeat(64) })) === 'bad_chunk', 'sha256 对不上 → 抛 bad_chunk');
    ok(await codeOf(s.chunk(pre, 'closure', '../baked.json')) === 'bad_params', '块文件名不合规 → 抛 bad_params，不发请求');
    ok(await codeOf(s.manifest(pre, 'nope')) === 'bad_params', '未知情景 → 抛 bad_params');
    const gridPoint = await s.bakedFor({ diversion_share: 0, demand_scale: 0.8 });
    ok(await codeOf(s.manifest(gridPoint, 'closure')) === 'no_replay', '格点结果（只有指标）要 manifest → 抛 no_replay，不拿预设的轨迹冒充');
    ok(await codeOf(s.manifest({ source: 'live', runId: '../../x' }, 'closure')) === 'no_replay', '伪造的 runId → no_replay');
    ok(await codeOf(s.manifest({ source: 'none' }, 'closure')) === 'no_replay', 'source=none → no_replay');
  }

  // ---- 10. 文案：三种状态 + 必须的说明，中英都有；预跑永远不是 live ----
  {
    ok(labels.zh.live.includes('云端实时运行 · 用时 {s} s') && labels.zh.baked === '预先跑好的 SUMO 结果' && labels.zh.sketch === '示意', 'zh 三种状态：云端实时运行 · 用时 {s} s / 预先跑好的 SUMO 结果 / 示意');
    ok(labels.en.live.includes('{s}') && labels.en.baked && labels.en.sketch, `en 三种状态：${labels.en.live} / ${labels.en.baked} / ${labels.en.sketch}`);
    const need = ['合成 2×2 路口，不是墨尔本真实几何', '车流、配时、行人需求为模型假设', '零碰撞只说明本次模型检查通过'];
    ok(need.every((s) => labels.zh.caveats.includes(s)) && labels.en.caveats.length === 3, 'zh / en 都有 3 条必须的说明');
    ok(Object.isFrozen(labels) && Object.isFrozen(labels.zh.caveats), 'labels 冻结，页面改不了');
    const codes = ['sumo_off', 'sumo_down', 'sumo_starting', 'sumo_rate', 'sumo_busy', 'sumo_failed', 'not_found', 'bad_params', 'bad_response', 'timeout', 'network', 'cancelled'];
    ok(codes.every((c) => labels.zh.reasons[c] && labels.en.reasons[c] && reasonLabel(c, 'en') === labels.en.reasons[c]), 'client 会给出的每个 reason 都有中英文案');
    ok(sourceLabel({ source: 'baked', elapsedMs: 1234, runId: RID }) === labels.zh.baked, '反向：baked 结果就算带了 elapsedMs / runId，文案也还是「预先跑好」');
    ok(sourceLabel({ source: 'live' }) === labels.zh.none && sourceLabel(undefined) === labels.zh.none, '反向：live 但没有用时 / 空值 → 不显示「云端实时」');
    ok(DEFAULT_PARAMS.seed === 42 && DEFAULT_PARAMS.diversion_share === 0.45 && Object.isFrozen(DEFAULT_PARAMS), 'DEFAULT_PARAMS 和 build_demo.py 默认一致（seed 42、绕行 0.45）');
  }

  // ================= 真实 CBD 路网（contract v2）=================
  const realLive = () => json(200, realIdx('live'));
  const neverLiveReal = (r, msg) => {
    const both = realSourceLabel(r, 'zh') + realSourceLabel(r, 'en') + sourceLabel(r, 'zh') + sourceLabel(r, 'en');
    ok(r.source === 'baked' && r.network === 'real' && sourceLabel(r, 'zh') === realLabels.zh.baked && sourceLabel(r, 'en') === realLabels.en.baked
      && !/live|Live|现场|实时/.test(both) && r.runId === undefined && r.index && r.index.tag === 'baked',
      `${msg}：source=baked、文案「${sourceLabel(r, 'en')}」、不带 runId、给的是预跑 index`);
  };

  // ---- 11. runReal 云端正常：POST {network:'real', seed, p_original, p_ai} → 轮询 → index（v2）----
  {
    const f = fake({ polls: ['queued', 'running', 'running', 'complete'], index: realLive });
    const phases = [];
    const r = await client(f).runReal({ seed: 7, p_original: 0.14, p_ai: 0.61, evil: 1, diversion_share: 0.3 }, { onStatus: (s) => phases.push(s.phase), timeoutMs: 2000 });
    ok(r.source === 'live' && r.network === 'real' && r.runId === RID && r.index.version === 2 && r.index.tag === 'live' && r.index.scenarios.length === 3, `runReal live：source=live、network=real、runId、index v2（${r.source} ${r.reason || ''}）`);
    ok(Number.isFinite(r.elapsedMs) && r.elapsedMs >= 0 && r.reason === undefined && r.engine === ENGINE, `runReal live：elapsedMs=${Math.round(r.elapsedMs)}、engine、没有 reason`);
    ok(/^Cloud · live · \d+\.\d s$/.test(sourceLabel(r, 'en')) && /^云端现场 · 用时 \d+\.\d s$/.test(sourceLabel(r, 'zh')) && realSourceLabel(r, 'en') === sourceLabel(r, 'en'), `runReal live 文案：${sourceLabel(r, 'en')} / ${sourceLabel(r, 'zh')}`);
    const body = f.posts()[0].body;
    ok(body === '{"network":"real","seed":7,"p_original":0.14,"p_ai":0.61}', `POST 体只有 network + seed + p_original + p_ai：${body}`);
    ok(['health', 'submit', 'queued', 'running', 'complete', 'done'].every((p) => phases.includes(p)), `runReal onStatus：${phases.join(' → ')}`);
    ok(f.calls.every((c) => !c.url.startsWith('/sumo/public/')), 'runReal 成功时不去取预跑文件');
    const g = fake({ index: realLive });
    await client(g).runReal({ p_ai: NaN, seed: 'x', scenarios: ['ai', 'closure', 'baseline'] }, { timeoutMs: 2000 });
    ok(g.posts()[0].body === '{"network":"real","scenarios":["ai","baseline"]}', `不是有限数的字段不发；scenarios 只留 baseline/original/ai：${g.posts()[0].body}`);
    const h = fake({ index: realLive });
    await client(h).runReal({}, { timeoutMs: 2000 });
    ok(h.posts()[0].body === '{"network":"real"}', '什么都不传 → 只发 {network:\'real\'}（默认值由 serve.py 定）');
  }

  // ---- 12. runReal 失败 → 预跑结果 + 原因短码 ----
  for (const [name, o, reason, extra] of [
    ['查活连不上', { health: () => { throw new TypeError('fetch failed'); } }, 'health_down', { detail: 'network', noPost: true }],
    ['查活 503 sumo_starting', { health: () => json(503, { ok: false, error: 'sumo_starting', msg: '启动中' }) }, 'health_down', { detail: 'sumo_starting', noPost: true }],
    ['查活 502 sumo_down', { health: () => json(502, { ok: false, error: 'sumo_down', msg: '没有响应' }) }, 'health_down', { detail: 'sumo_down', noPost: true }],
    ['查活卡住', { health: hang }, 'health_down', { detail: 'timeout', noPost: true, ms: 150 }],
    ['POST 429 sumo_rate', { post: () => json(429, { ok: false, error: 'sumo_rate', msg: '每分钟最多 3 次' }) }, 'sumo_rate', { text: '每分钟最多 3 次' }],
    ['POST 429 sumo_busy', { post: () => json(429, { ok: false, error: 'sumo_busy', msg: '正忙' }) }, 'sumo_busy', { text: '正忙' }],
    ['POST 400 参数越界', { post: () => json(400, { ok: false, error: 'bad_request', msg: '参数不对（p_ai must be a number in [0, 1]）' }) }, 'bad_params', { text: 'p_ai' }],
    ['POST 卡住', { post: hang }, 'timeout', { ms: 300 }],
    ['运行 failed', { polls: ['running', 'failed'] }, 'sumo_failed', { text: FAIL_TEXT, liveRunId: true }],
    ['一直 running', { polls: ['running'] }, 'timeout', { ms: 120, liveRunId: true }],
    ['轮询卡住', { poll: hang }, 'timeout', { ms: 150, liveRunId: true }],
    ['轮询 404（容器重启）', { poll: () => json(404, { ok: false, error: 'not_found', msg: '没有这个运行' }) }, 'not_found', { liveRunId: true }],
    ['轮询连不上 3 次', { poll: () => { throw new TypeError('fetch failed'); } }, 'network', { liveRunId: true }],
    ['云端 index 不是 v2 真实路网', { index: () => json(200, idx('live')) }, 'bad_response', { liveRunId: true }],
  ]) {
    const f = fake({ index: realLive, ...o });
    const t0 = Date.now();
    const r = await client(f).runReal({ p_ai: 0.53 }, { timeoutMs: extra.ms || 2000 });
    ok(r.reason === reason && (!extra.detail || r.detail === extra.detail) && (!extra.noPost || f.posts().length === 0)
      && (!extra.text || String(r.error).includes(extra.text)) && (!extra.liveRunId || r.liveRunId === RID),
      `runReal ${name} → baked，reason=${r.reason}${r.detail ? `（detail ${r.detail}）` : ''}${r.error ? `，error「${String(r.error).slice(0, 36)}」` : ''}`);
    neverLiveReal(r, `runReal ${name}`);
    if (extra.ms) ok(Date.now() - t0 < 1500, `runReal ${name}：按 timeoutMs 收住（${Date.now() - t0} ms）`);
  }
  {
    const ctl = new AbortController();
    const f = fake({ polls: ['running'], index: realLive });
    const r = await client(f, { pollMs: 20 }).runReal({}, { signal: ctl.signal, timeoutMs: 2000, onStatus: (s) => { if (s.phase === 'running') ctl.abort(); } });
    ok(r.reason === 'cancelled' && r.liveRunId === RID, `runReal 用户取消 → baked，reason=${r.reason}`);
    neverLiveReal(r, 'runReal 取消');
    const pre = new AbortController(); pre.abort();
    const g = fake({ index: realLive });
    const r2 = await client(g).runReal({}, { signal: pre.signal });
    ok(r2.reason === 'cancelled' && g.calls.every((c) => !c.url.startsWith('/api/')), 'runReal 已取消的 signal：一个云端请求都不发');
    const h = fake({ health: hang, index: realLive });
    const hc = new AbortController();
    setTimeout(() => hc.abort(), 30);
    const r3 = await client(h).runReal({}, { signal: hc.signal, timeoutMs: 2000 });
    ok(r3.reason === 'cancelled' && r3.source === 'baked', `查活途中取消 → reason=cancelled（不是 health_down）：${r3.reason}`);
  }
  {
    const f = fake({ health: () => { throw new TypeError('fetch failed'); }, realDown: true });
    const r = await client(f).runReal({});
    ok(r.source === 'none' && r.network === 'real' && r.reason === 'health_down' && r.index === null && typeof r.bakedError === 'string'
      && sourceLabel(r, 'en') === realLabels.en.none && sourceLabel(r, 'zh') === realLabels.zh.none, `云端和真实路网预跑都拿不到 → source=none，文案「${sourceLabel(r, 'en')}」`);
  }

  // ---- 13. loadReal：/sumo/public/real/index.json，只下载一次、失败不缓存、格式不对就抛 ----
  {
    const f = fake();
    const s = client(f);
    const a = await s.loadReal();
    const b = await s.loadReal();
    ok(a.source === 'baked' && a.network === 'real' && a.index.version === 2 && a.index.works.link === WORKS.link && a.engine === ENGINE && a === b,
      'loadReal → {source:baked, network:real, index v2}，文件里写的 source=live 盖不过 baked');
    ok(f.calls.filter((c) => c.url === '/sumo/public/real/index.json').length === 1 && f.calls.every((c) => !c.url.startsWith('/api/')), 'loadReal 只下载一次 index.json，不碰云端');
    ok(sourceLabel(a, 'en') === 'SUMO · pre-computed' && sourceLabel(a, 'zh') === 'SUMO · 预先跑好', `loadReal 的文案：${sourceLabel(a, 'en')} / ${sourceLabel(a, 'zh')}`);
    let down = true;
    const g = fake();
    const flaky = { fetch: (u, i) => (down && String(u).includes('/real/') ? Promise.reject(new TypeError('fetch failed')) : g.fetch(u, i)) };
    const s2 = client(flaky);
    let threw = null;
    try { await s2.loadReal(); } catch (e) { threw = e.code; }
    down = false;
    const again = await s2.loadReal();
    ok(threw === 'network' && again.index.version === 2, `真实路网预跑第一次连不上 → 抛 ${threw}；恢复后能拿到（失败不缓存）`);
    const h = fake({ realFiles: { 'index.json': idx('v1') } });
    let bad = null;
    try { await client(h).loadReal(); } catch (e) { bad = e.code; }
    ok(bad === 'baked_missing', '预跑 index 不是 version 2 / network real → 抛 baked_missing，不拿合成 2×2 的冒充');
  }

  // ---- 14. realManifest / realChunk：两种来源的地址、sha256、非法输入 ----
  {
    const f = fake({ index: realLive });
    const s = client(f);
    const codeOf = async (p) => { try { await p; return 'no-throw'; } catch (e) { return e.code; } };
    const baked = await s.loadReal();
    const m = await s.realManifest(baked, 'original');
    ok(f.calls.at(-1).url === '/sumo/public/real/original/manifest.json' && m.scenario === 'original' && m.chunks.length === 1, '预跑 manifest → /sumo/public/real/original/manifest.json');
    const c = await s.realChunk(baked, 'original', m.chunks[0]);
    ok(f.calls.at(-1).url === '/sumo/public/real/original/frames-000.json' && c.frames[0].q === 12.5, '预跑块 → /sumo/public/real/original/frames-000.json（sha256 按对象 JSON 文本核对）');
    const ref = { source: 'baked', reason: 'sumo_rate' }; // runReal 的回退结果本身就能当 ref
    await s.realManifest(ref, 'ai');
    ok(f.calls.at(-1).url === '/sumo/public/real/ai/manifest.json', 'runReal 回退结果 {source:baked} 直接当 ref 用');
    const live = await s.runReal({}, { timeoutMs: 2000 });
    const lm = await s.realManifest(live, 'ai');
    ok(f.calls.at(-1).url === `/api/sumo/v1/runs/${RID}/ai/manifest.json` && lm.scenario === 'ai', '云端 manifest → /api/sumo/v1/runs/<id>/ai/manifest.json');
    const lc = await s.realChunk({ source: 'live', runId: RID }, 'baseline', { file: 'frames-000.json', sha256: RCHUNK_SHA });
    ok(f.calls.at(-1).url === `/api/sumo/v1/runs/${RID}/baseline/frames-000.json` && lc.frames.length === 1, '云端块 → /api/sumo/v1/runs/<id>/baseline/frames-000.json，sha256 核对通过');
    ok(await codeOf(s.realChunk(live, 'baseline', { file: 'frames-000.json', sha256: '0'.repeat(64) })) === 'bad_chunk', 'sha256 对不上 → 抛 bad_chunk');
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    let noCrypto = 'skip';
    if (desc && desc.configurable) {
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
      try { noCrypto = await codeOf(s.realChunk(live, 'baseline', { file: 'frames-000.json', sha256: '0'.repeat(64) })); } finally { Object.defineProperty(globalThis, 'crypto', desc); }
    }
    ok(noCrypto === 'no-throw' || noCrypto === 'skip', `没有 WebCrypto（http 页面）→ 跳过核对，不让页面挂（${noCrypto}）`);
    ok(await codeOf(s.realManifest(baked, 'closure')) === 'bad_params' && await codeOf(s.realManifest(baked, 'guided')) === 'bad_params', '合成 2×2 的情景名（closure / guided）→ 抛 bad_params');
    ok(await codeOf(s.realChunk(baked, 'ai', '../index.json')) === 'bad_params' && await codeOf(s.realChunk(baked, 'ai', 'frames-1.json')) === 'bad_params', '块文件名不合规 → 抛 bad_params，不发请求');
    ok(await codeOf(s.realManifest({ source: 'live', runId: '../../x' }, 'ai')) === 'no_replay' && await codeOf(s.realManifest({ source: 'none' }, 'ai')) === 'no_replay'
      && await codeOf(s.realManifest(undefined, 'ai')) === 'no_replay', '伪造 runId / source=none / 空 ref → no_replay');
    const n = f.calls.length;
    await codeOf(s.realManifest({ source: 'none' }, 'ai'));
    ok(f.calls.length === n, 'no_replay 不发请求');
    ok(await codeOf(s.realManifest({ source: 'baked' }, 'baseline')) === 'no-throw' && (await s.realManifest({ source: 'baked' }, 'baseline')).scenario === 'baseline', 'baseline 情景也能取');
  }

  // ---- 15. 真实路网文案：状态条 + 4 条说明，中英都有；预跑永远不是 live ----
  {
    ok(realLabels.en.live === 'Cloud · live · {s} s' && realLabels.zh.live === '云端现场 · 用时 {s} s', `live 文案：${realLabels.en.live} / ${realLabels.zh.live}`);
    ok(realLabels.en.baked === 'SUMO · pre-computed' && realLabels.zh.baked === 'SUMO · 预先跑好', `baked 文案：${realLabels.en.baked} / ${realLabels.zh.baked}`);
    const en = realLabels.en.caveats.join(' | '), zh = realLabels.zh.caveats.join(' | ');
    ok(/OpenStreetMap/.test(en) && /SCATS/.test(en) && /08:00/.test(en) && /[Ss]ignal timing/.test(en) && /turn shares/.test(en) && /not measured/.test(en), `en 说明：${en}`);
    ok(/OpenStreetMap/.test(zh) && /SCATS/.test(zh) && /08:00/.test(zh) && /配时/.test(zh) && /转向/.test(zh) && /不是实测/.test(zh), `zh 说明：${zh}`);
    ok(realLabels.en.caveats.length === realLabels.zh.caveats.length && realLabels.en.caveats.length >= 4, `中英说明条数一致（${realLabels.en.caveats.length}）`);
    ok(realLabels.en.note === 'SUMO 1.27.1 · real CBD network (OSM) + SCATS 08:00 flows · signal timing and turn shares assumed' && realLabels.zh.note.includes('OSM'), `面板备注：${realLabels.en.note}`);
    ok(Object.isFrozen(realLabels) && Object.isFrozen(realLabels.en.caveats) && Object.isFrozen(REAL_SCENARIOS) && Object.isFrozen(REAL_DEFAULTS), 'realLabels / REAL_SCENARIOS / REAL_DEFAULTS 冻结');
    ok(JSON.stringify(REAL_SCENARIOS) === '["baseline","original","ai"]' && REAL_DEFAULTS.p_original === 0.14 && REAL_DEFAULTS.p_ai === 0.53, 'REAL_SCENARIOS 和默认绕行比例 0.14 / 0.53 按 contract v2');
    { const src = readFileSync(new URL('../public/js/sumo-client.js', import.meta.url), 'utf8');
      ok(REAL_TIMEOUT_MS === 180000 && /async function runReal\(params = \{\}, \{ onStatus, signal, timeoutMs: limitMs = REAL_TIMEOUT_MS \} = \{\}\)/.test(src),
        `T48：runReal 不传 timeoutMs 时默认等 ${REAL_TIMEOUT_MS / 1000} s（整整一小时云端约 40–60 s，再留冷启动）`); }
    const forged = { network: 'real', source: 'baked', elapsedMs: 1234, runId: RID };
    ok(sourceLabel(forged, 'en') === 'SUMO · pre-computed' && realSourceLabel(forged, 'zh') === 'SUMO · 预先跑好', '反向：baked 结果就算带了 elapsedMs / runId，文案也还是「pre-computed」');
    ok(realSourceLabel({ network: 'real', source: 'live' }, 'en') === realLabels.en.none && realSourceLabel(undefined, 'zh') === realLabels.zh.none, '反向：live 但没有用时 / 空值 → 不显示「Cloud · live」');
    ok(sourceLabel({ source: 'baked' }, 'en') === labels.en.baked, '没有 network=real 的结果照旧用合成 2×2 的文案（不影响旧接口）');
    const codes = ['health_down', 'sumo_rate', 'sumo_busy', 'timeout', 'sumo_failed', 'network', 'not_found', 'cancelled', 'bad_params', 'bad_response', 'bad_chunk'];
    ok(codes.every((c) => labels.zh.reasons[c] && labels.en.reasons[c] && reasonLabel(c, 'en') === labels.en.reasons[c]), 'runReal 会给出的每个 reason 都有中英文案');
  }

  // ---- 16. runOptions（T49）：POST {network:'real', seed?, options} → 轮询 → index（baseline + opt-<id>）；没有预跑兜底，失败一律 source=none ----
  {
    const optIdx = (ids, extra = {}) => ({
      ...realIdx('live-options'), params: { seed: 7, options: [], frames: false },
      scenarios: ['baseline', ...ids].map((id) => ({ id, label: { en: id, zh: id }, diversion_share: 0, manifest: `${id}/manifest.json`, metrics: { works_queue_max_m: 1 } })), ...extra,
    });
    const OPTS = [{ id: 'A', p: 0.14 }, { id: 'B', p: 0.14 }, { id: 'C', p: 0.607 }];
    const live = () => json(200, optIdx(['opt-A', 'opt-B', 'opt-C']));
    const noBaked = (f) => f.calls.every((c) => !c.url.startsWith('/sumo/public/'));
    const neverLiveOpt = (r, msg) => ok(r.source === 'none' && r.network === 'real' && r.index === null && r.runId === undefined
      && sourceLabel(r, 'en') === realLabels.en.none && sourceLabel(r, 'zh') === realLabels.zh.none, `${msg}：source=none、index=null、文案「${sourceLabel(r, 'zh')}」、不带 runId`);

    const f = fake({ polls: ['queued', 'running', 'complete'], index: live });
    const phases = [];
    const r = await client(f).runOptions(OPTS.map((o) => ({ ...o, label: 'x' })), { seed: 7, onStatus: (s) => phases.push(s.phase), timeoutMs: 2000 });
    ok(r.source === 'live' && r.network === 'real' && r.runId === RID && r.index.tag === 'live-options' && r.index.scenarios.length === 4 && r.engine === ENGINE && r.reason === undefined,
      `runOptions live：source=live、runId、index 有 baseline + 3 个方案（${r.source} ${r.reason || ''}）`);
    ok(f.posts()[0].body === '{"network":"real","seed":7,"options":[{"id":"A","p":0.14},{"id":"B","p":0.14},{"id":"C","p":0.607}]}', `POST 体：${f.posts()[0].body}`);
    ok(/^Cloud · live · \d+\.\d s$/.test(sourceLabel(r, 'en')) && /^云端现场 · 用时 \d+\.\d s$/.test(sourceLabel(r, 'zh')), `runOptions live 文案：${sourceLabel(r, 'zh')}`);
    ok(['health', 'submit', 'queued', 'running', 'complete', 'done'].every((p) => phases.includes(p)) && noBaked(f), `runOptions onStatus：${phases.join(' → ')}；不碰预跑文件`);
    const g = fake({ index: live });
    await client(g).runOptions(OPTS);
    ok(!('seed' in JSON.parse(g.posts()[0].body)), '不传 seed → 请求体不带 seed（默认值由 serve.py 定）');
    const s = client(f);
    await s.realManifest(r, 'opt-B').catch(() => null); // 假服务器没有这个文件（404），这里只看地址
    ok(f.calls.at(-1).url === `/api/sumo/v1/runs/${RID}/opt-B/manifest.json`, 'realManifest 认 opt-B → /api/sumo/v1/runs/<id>/opt-B/manifest.json');
    ok(await s.realManifest(r, 'opt-F').then(() => 'no-throw', (e) => e.code) === 'bad_params' && await s.realChunk(r, 'opt-a', 'frames-000.json').then(() => 'no-throw', (e) => e.code) === 'bad_params',
      'opt-F / opt-a 不认 → bad_params');

    // 参数不合规：不发任何请求
    for (const bad of [[], undefined, 'A', [{ id: 'F', p: 0.1 }], [{ id: 'a', p: 0.1 }], [{ id: 'A', p: 0.1 }, { id: 'A', p: 0.2 }], [{ id: 'A', p: 1.01 }], [{ id: 'A', p: -0.1 }],
      [{ id: 'A', p: NaN }], [{ id: 'A', p: '0.5' }], [{ id: 'A' }], [null], ['A', 'B', 'C', 'D', 'E', 'A'].map((id) => ({ id, p: 0.1 }))]) {
      const h = fake({ index: live });
      const rb = await client(h).runOptions(bad);
      ok(rb.reason === 'bad_params' && h.calls.length === 0, `runOptions(${JSON.stringify(bad)}) → reason=bad_params，一个请求都不发`);
      neverLiveOpt(rb, 'runOptions 参数不合规');
    }

    // 失败：没有预跑兜底 → source=none + 原因短码
    for (const [name, o, reason, extra] of [
      ['查活连不上', { health: () => { throw new TypeError('fetch failed'); } }, 'health_down', { detail: 'network', noPost: true }],
      ['查活 503 sumo_starting', { health: () => json(503, { ok: false, error: 'sumo_starting', msg: '启动中' }) }, 'health_down', { detail: 'sumo_starting', noPost: true }],
      ['POST 429 sumo_rate', { post: () => json(429, { ok: false, error: 'sumo_rate', msg: '每分钟最多 3 次' }) }, 'sumo_rate', {}],
      ['POST 429 sumo_busy', { post: () => json(429, { ok: false, error: 'sumo_busy', msg: '正忙' }) }, 'sumo_busy', {}],
      ['POST 400（旧容器不认 options）', { post: () => json(400, { ok: false, error: 'bad_config', msg: '参数不合规范：Unknown field: options' }) }, 'bad_params', { text: 'options' }],
      ['运行 failed', { polls: ['running', 'failed'] }, 'sumo_failed', { text: FAIL_TEXT, liveRunId: true }],
      ['一直 running', { polls: ['running'] }, 'timeout', { ms: 120, liveRunId: true }],
      ['轮询 404', { poll: () => json(404, { ok: false, error: 'not_found', msg: '没有这个运行' }) }, 'not_found', { liveRunId: true }],
      ['index 少了一个方案', { index: () => json(200, optIdx(['opt-A', 'opt-B'])) }, 'bad_response', { liveRunId: true }],
      ['index 是原来三情景', { index: realLive }, 'bad_response', { liveRunId: true }],
      ['index 不是 v2 真实路网', { index: () => json(200, idx('live')) }, 'bad_response', { liveRunId: true }],
    ]) {
      const h = fake({ index: live, ...o });
      const t0 = Date.now();
      const rf = await client(h).runOptions(OPTS, { timeoutMs: extra.ms || 2000 });
      ok(rf.reason === reason && (!extra.detail || rf.detail === extra.detail) && (!extra.noPost || h.posts().length === 0)
        && (!extra.text || String(rf.error).includes(extra.text)) && (!extra.liveRunId || rf.liveRunId === RID) && noBaked(h),
        `runOptions ${name} → none，reason=${rf.reason}${rf.detail ? `（detail ${rf.detail}）` : ''}，不去取预跑文件`);
      neverLiveOpt(rf, `runOptions ${name}`);
      if (extra.ms) ok(Date.now() - t0 < 1500, `runOptions ${name}：按 timeoutMs 收住（${Date.now() - t0} ms）`);
    }
    const ctl = new AbortController();
    const h = fake({ polls: ['running'], index: live });
    const rc = await client(h, { pollMs: 20 }).runOptions(OPTS, { signal: ctl.signal, timeoutMs: 2000, onStatus: (st) => { if (st.phase === 'running') ctl.abort(); } });
    ok(rc.reason === 'cancelled' && rc.liveRunId === RID && noBaked(h), `runOptions 用户取消 → none，reason=${rc.reason}`);
    neverLiveOpt(rc, 'runOptions 取消');
    ok(Object.isFrozen(OPTION_IDS) && OPTION_IDS.join('') === 'ABCDE', 'OPTION_IDS = A–E，冻结');
  }
} catch (e) {
  F++;
  console.log('❌ 测试崩溃：' + (e && e.stack || e));
}

console.log(`${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);
