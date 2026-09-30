// 用途：用假的 fetch 测 public/js/sumo-client.js —— 云端正常走 live；查活失败、限流、忙、运行失败、超时、取消、404 都回预跑结果并写明原因；
//       挑最近格点；manifest / chunk 地址和 sha256；预跑结果任何情况下都不会被标成「云端实时」
// 用法：node apps/sumo/tests/client.test.mjs（test.sh 会自动跑）；不联网、不需要 wrangler；最后一行固定「N passed, M failed」
import { createHash } from 'node:crypto';
import { createSumoClient, labels, sourceLabel, reasonLabel, SCENARIOS, DEFAULT_PARAMS } from '../public/js/sumo-client.js';

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
    if (u === `/api/sumo/v1/runs/${RID}/index.json`) return json(200, idx('live', { config: { ...PRESET, diversion_share: 0.3 } }));
    if (u === `/api/sumo/v1/runs/${RID}/closure/manifest.json`) return json(200, { scenario: 'closure', chunks: [] });
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
} catch (e) {
  F++;
  console.log('❌ 测试崩溃：' + (e && e.stack || e));
}

console.log(`${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);
