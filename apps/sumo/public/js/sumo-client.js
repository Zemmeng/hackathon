// 网页调 SUMO 的唯一入口（T37，D-0930-1700，docs/contract.md §HTTP API /api/sumo/v1）
// 先试云端（/api/sumo/v1 → hackathon-sumo → Cloudflare Container 里的 serve.py）；没开 / 连不上 / 在启动 / 限流 / 忙 /
// 超时 / 运行失败 / 取消，一律改回预先跑好的结果（/sumo/public/baked/，apps/sumo/tools/bake.py 生成）
// 返回值永远带 source：'live'（云端实时）| 'baked'（预先跑好）| 'none'（两边都拿不到）；页面只按它和 labels 选文案，
// 预跑结果无论如何都不会标成 live（tests/client.test.mjs 反向断言）
//
// 用法：
//   import { createSumoClient, labels, sourceLabel, reasonLabel } from '/sumo/public/js/sumo-client.js';
//   const sumo = createSumoClient();
//   const first = await sumo.bakedFor({});                          // 先立刻显示预设（有逐帧轨迹）
//   const r = await sumo.run({ diversion_share: 0.3 }, { onStatus, signal });   // signal 取消 → 回预跑结果，reason 'cancelled'
//   sourceLabel(r, 'zh') → 「云端实时运行 · 用时 12.3 s」或「预先跑好的 SUMO 结果」；r.reason 是改用预跑的原因短码
//   const m = await sumo.manifest(r, 'closure'); const c = await sumo.chunk(r, 'closure', m.chunks[0]);  // 格点结果只有指标，没有轨迹
// 真实 CBD 路网（contract v2，T40）：
//   const real = await sumo.loadReal();                               // {source:'baked', network:'real', index}，/sumo/public/real/index.json
//   const m = await sumo.realManifest(real, 'original'); const c = await sumo.realChunk(real, 'original', m.chunks[0]);
//   const r = await sumo.runReal({ seed, p_original: 0.14, p_ai: 0.53 }, { onStatus, signal, timeoutMs: 180000 });
//   // → {source:'live', runId, elapsedMs, index} 或 {source:'baked', reason, index}（reason：health_down / sumo_rate / sumo_busy / timeout / sumo_failed / network / not_found / cancelled …）
//   sourceLabel(r, 'en') → 'Cloud · live · 31.4 s' | 'SUMO · pre-computed'；realLabels[lang].caveats 是必须同屏的说明
// 浏览器和 node 都能跑（node 里传 fetch 和绝对地址）；不依赖任何库

export const SCENARIOS = Object.freeze(['baseline', 'closure', 'guided', 'footpath']);
const FIELDS = ['seed', 'scenarios', 'demand_duration_s', 'clearance_s', 'demand_scale', 'diversion_share'];
// 和 apps/web/tools/sumo/build_demo.py 的 DEFAULT_CONFIG 一致
export const DEFAULT_PARAMS = Object.freeze({ seed: 42, scenarios: SCENARIOS, demand_duration_s: 600, clearance_s: 1200, demand_scale: 1, diversion_share: 0.45 });
const RUN_ID = /^[0-9a-f]{32}$/;
const HEALTH_MS = 6000; // 查活最多等这么久，再久就先给预跑结果
const REQ_MS = 10000;   // 单个接口请求（POST、轮询、index.json）
const FILE_MS = 20000;  // manifest / frames 块 / 预跑文件（块最大约 0.5 MB）
// Worker 自己的错误短码（apps/sumo/src/proxy.js、apps/site/src/worker.js）；容器原样转出的其它短码（bad_config / sumo_error / not_ready …）按状态码归类
const KNOWN = new Set(['sumo_off', 'sumo_down', 'sumo_starting', 'sumo_rate', 'sumo_busy', 'not_found', 'too_big']);
// 真实路网（contract v2）：情景 id、默认绕行比例（引擎对「ROADWORK AHEAD」/「USE RUSSELL / SAVE 9 MIN」的读数）
export const REAL_SCENARIOS = Object.freeze(['baseline', 'original', 'ai']);
export const REAL_DEFAULTS = Object.freeze({ p_original: 0.14, p_ai: 0.53 });
export const REAL_TIMEOUT_MS = 180000; // 一次真实路网三情景（T48：整整 08:00–09:00 一小时）：云端约 40–60 s，再留冷启动和排队
const REAL_HEALTH_MS = 12000;  // 用户点了「云端重跑」才查活，容器刚醒可以多等一会儿
const LIVE = Symbol('live');   // drive() 成功的标记，和回退结果区分（回退结果是普通对象）

export class SumoError extends Error {
  constructor(code, msg) {
    super(msg || code);
    this.code = code;
  }
}

const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };

// 三种状态 + 必须同屏出现的说明。{s} = 秒；页面不许另写「实时」类文案
export const labels = deepFreeze({
  zh: {
    live: '云端实时运行 · 用时 {s} s',
    baked: '预先跑好的 SUMO 结果',
    sketch: '示意',
    none: '暂时拿不到 SUMO 结果',
    running: 'SUMO 正在云端计算 · 已用 {s} s',
    caveats: ['合成 2×2 路口，不是墨尔本真实几何', '车流、配时、行人需求为模型假设', '零碰撞只说明本次模型检查通过'],
    reasons: {
      sumo_off: '云端 SUMO 没有开启', sumo_down: '云端 SUMO 没有响应', sumo_starting: '云端 SUMO 正在启动',
      sumo_rate: '运行太频繁，请一分钟后再试', sumo_busy: '云端 SUMO 正忙', sumo_failed: '这次运行没通过模型检查',
      not_found: '云端结果不见了（服务可能重启过）', too_big: '请求太大', bad_params: '参数超出允许范围',
      bad_response: '云端返回的内容不对', timeout: '云端运行超时', network: '网络连不上', cancelled: '已取消',
      health_down: '云端 SUMO 连不上', bad_chunk: '结果文件校验没通过',
    },
  },
  en: {
    live: 'Live cloud run · {s} s',
    baked: 'Pre-computed SUMO results',
    sketch: 'Illustrative',
    none: 'SUMO results unavailable',
    running: 'SUMO running in the cloud · {s} s',
    caveats: ['Synthetic 2×2 grid, not real Melbourne geometry', 'Traffic volumes, signal timing and pedestrian demand are model assumptions', 'Zero collisions only means this model run passed its checks'],
    reasons: {
      sumo_off: 'Cloud SUMO is switched off', sumo_down: 'Cloud SUMO is not responding', sumo_starting: 'Cloud SUMO is starting up',
      sumo_rate: 'Too many runs; try again in a minute', sumo_busy: 'Cloud SUMO is busy', sumo_failed: 'This run failed the model checks',
      not_found: 'Cloud result is gone (service may have restarted)', too_big: 'Request too large', bad_params: 'Parameters out of range',
      bad_response: 'Unexpected response from the cloud', timeout: 'Cloud run timed out', network: 'Network unreachable', cancelled: 'Cancelled',
      health_down: 'Cloud SUMO is unreachable', bad_chunk: 'Result file failed its checksum',
    },
  },
});

// 真实 CBD 路网（contract v2）的状态条和说明：页面第 2 步 SUMO 模式用；{s} = 秒
export const realLabels = deepFreeze({
  zh: {
    live: '云端现场 · 用时 {s} s',
    baked: 'SUMO · 预先跑好',
    none: '暂时拿不到 SUMO 结果',
    running: 'SUMO 正在云端重跑 · 已用 {s} s',
    note: 'SUMO 1.27.1 · 真实 CBD 路网（OSM）+ SCATS 工作日 08:00 车流 · 信号配时和转向比例是假设',
    caveats: ['真实墨尔本 CBD 路网，来自 OpenStreetMap', '车流取 SCATS 工作日 08:00 的计数', '信号配时和转向比例是假设', '绕行比例来自引擎对路牌的解读，不是实测'],
  },
  en: {
    live: 'Cloud · live · {s} s',
    baked: 'SUMO · pre-computed',
    none: 'SUMO results unavailable',
    running: 'Re-running SUMO in the cloud · {s} s',
    note: 'SUMO 1.27.1 · real CBD network (OSM) + SCATS 08:00 flows · signal timing and turn shares assumed',
    caveats: ['Real Melbourne CBD street network from OpenStreetMap', 'Traffic volumes from SCATS weekday 08:00 counts', 'Signal timing and turn shares are assumed', "Diversion shares come from the engine's reading of the sign, not measured"],
  },
});

// 真实路网的状态条：只有 source === 'live' 且有用时才会出现「云端现场」
export function realSourceLabel(result, lang = 'zh') {
  const L = realLabels[lang] || realLabels.zh;
  if (result && result.source === 'live' && Number.isFinite(result.elapsedMs)) return L.live.replace('{s}', (result.elapsedMs / 1000).toFixed(1));
  if (result && result.source === 'baked') return L.baked;
  return L.none;
}

// 状态条文案：只有 source === 'live' 才会出现「云端实时」；network === 'real' 的结果（runReal / loadReal）用真实路网文案
export function sourceLabel(result, lang = 'zh') {
  if (result && result.network === 'real') return realSourceLabel(result, lang);
  const L = labels[lang] || labels.zh;
  if (result && result.source === 'live' && Number.isFinite(result.elapsedMs)) return L.live.replace('{s}', (result.elapsedMs / 1000).toFixed(1));
  if (result && result.source === 'baked') return L.baked;
  return L.none;
}

export function reasonLabel(code, lang = 'zh') {
  const L = labels[lang] || labels.zh;
  return (code && L.reasons[code]) || code || '';
}

const pick = (params) => {
  const out = {};
  for (const k of FIELDS) if (params && params[k] !== undefined) out[k] = params[k];
  return out;
};

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const normalize = (params) => {
  const p = pick(params);
  const out = { ...DEFAULT_PARAMS, ...p };
  for (const k of ['seed', 'demand_duration_s', 'clearance_s', 'demand_scale', 'diversion_share']) out[k] = num(out[k], DEFAULT_PARAMS[k]);
  return out;
};
const same = (a, b) => Math.abs(a - b) < 1e-9;
const sameRun = (a, b) => ['seed', 'demand_duration_s', 'clearance_s', 'demand_scale', 'diversion_share'].every((k) => same(num(a[k], NaN), num(b[k], NaN)));

function reasonOf(status, data) {
  const code = data && typeof data.error === 'string' ? data.error : '';
  if (KNOWN.has(code)) return code;
  if (status === 429) return 'sumo_busy'; // 没带已知短码的 429 一律当忙
  if (status === 404) return 'not_found';
  if (status === 400 || status === 413 || status === 415) return 'bad_params';
  if (status >= 500) return 'sumo_down';
  return 'bad_response';
}
const msgOf = (r) => (r.data && (r.data.msg || r.data.error)) || (r.text || '').slice(0, 300) || `HTTP ${r.status}`;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new SumoError('cancelled'));
    const t = setTimeout(done, ms);
    function done() { if (signal) signal.removeEventListener('abort', stop); resolve(); }
    function stop() { clearTimeout(t); reject(new SumoError('cancelled')); }
    if (signal) signal.addEventListener('abort', stop, { once: true });
  });
}

async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createSumoClient({ base = '/api/sumo/v1', baked = '/sumo/public/baked', real = '/sumo/public/real', fetch = globalThis.fetch, timeoutMs = 45000, pollMs = 1000 } = {}) {
  const api = base.replace(/\/+$/, '');
  const root = baked.replace(/\/+$/, '');
  const realRoot = real.replace(/\/+$/, '');
  let realP = null;
  const doFetch = fetch; // 不当成方法调：浏览器里 obj.fetch() 会报 Illegal invocation
  const now = globalThis.performance && typeof performance.now === 'function' ? () => performance.now() : () => Date.now();
  let catalogP = null;
  const files = new Map(); // 预跑 index 路径 → Promise（换参数来回点不重复下载）

  // → { status, data（JSON；不是 JSON 为 undefined）, text }；超时 / 取消 / 连不上抛 SumoError
  async function request(url, { method = 'GET', body, ms = REQ_MS, signal } = {}) {
    const ctl = new AbortController();
    let why = null;
    const timer = setTimeout(() => { why = 'timeout'; ctl.abort(); }, Math.max(0, ms));
    const onAbort = () => { why = why || 'cancelled'; ctl.abort(); };
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    try {
      const headers = body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' };
      const res = await doFetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : null; } catch { data = undefined; }
      return { status: res.status, data, text };
    } catch (e) {
      throw new SumoError(why || 'network', why === 'timeout' ? `${Math.round(ms)} ms 内没有响应` : String((e && e.message) || e));
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  async function health({ signal, ms = HEALTH_MS, limitMs = timeoutMs } = {}) {
    try {
      const r = await request(`${api}/health`, { ms: Math.min(ms, limitMs), signal });
      if (r.status === 200 && r.data && r.data.status === 'ready' && r.data.engine) {
        return { ok: true, engine: r.data.engine, activeJobs: r.data.active_jobs ?? null, status: 200 };
      }
      const error = r.status !== 200 ? reasonOf(r.status, r.data) : r.data && typeof r.data.status === 'string' ? 'sumo_starting' : 'bad_response';
      return { ok: false, error, msg: msgOf(r), status: r.status };
    } catch (e) {
      return { ok: false, error: e.code || 'network', msg: e.message };
    }
  }

  function loadBaked() {
    if (!catalogP) {
      catalogP = (async () => {
        const r = await request(`${root}/baked.json`, { ms: FILE_MS });
        if (r.status !== 200 || !r.data || r.data.version !== 1) throw new SumoError('baked_missing', `预跑目录 baked.json 取不到（${msgOf(r)}）`);
        return r.data;
      })();
      catalogP.catch(() => { catalogP = null; }); // 失败不缓存，下次再试
    }
    return catalogP;
  }

  // 预设 + complete 的格点里挑离请求最近的：绕行、流量各按格距归一再算距离；和预设同参数的点直接用预设（它有逐帧轨迹）
  function nearest(cat, want) {
    const cands = [];
    if (cat.preset && cat.preset.path) cands.push({ key: 'preset', params: cat.preset.params, path: cat.preset.path, preset: true });
    for (const g of cat.grid || []) if (g && g.status === 'complete' && g.path) cands.push({ key: g.key, params: g.params, path: g.path, preset: false });
    if (!cands.length) throw new SumoError('baked_missing', '预跑结果里没有可用的点');
    const step = (k) => {
      const v = [...new Set(cands.map((c) => num(c.params[k], 0)))].sort((a, b) => a - b);
      let s = Infinity;
      for (let i = 1; i < v.length; i++) s = Math.min(s, v[i] - v[i - 1]);
      return Number.isFinite(s) && s > 0 ? s : 1;
    };
    const sd = step('diversion_share'), sx = step('demand_scale');
    const score = (c) => Math.hypot((num(c.params.diversion_share, 0) - want.diversion_share) / sd, (num(c.params.demand_scale, 0) - want.demand_scale) / sx);
    return cands
      .map((c) => ({ ...c, d: score(c) }))
      .sort((a, b) => a.d - b.d || (a.d < 1e-9 && b.d < 1e-9 ? b.preset - a.preset : 0) || Math.abs(a.params.demand_scale - want.demand_scale) - Math.abs(b.params.demand_scale - want.demand_scale) || (a.key < b.key ? -1 : 1))[0];
  }

  async function bakedFor(params = {}) {
    const cat = await loadBaked();
    const want = normalize(params);
    let c = nearest(cat, want);
    // 和预设参数完全相同的格点 → 用预设（同一批结果，多了轨迹）
    if (!c.preset && cat.preset && cat.preset.path && sameRun(c.params, cat.preset.params)) c = { key: 'preset', params: cat.preset.params, path: cat.preset.path, preset: true };
    if (!/^(preset\/index|grid\/[\w.-]+)\.json$/.test(c.path)) throw new SumoError('baked_missing', `预跑路径不合规：${c.path}`);
    if (!files.has(c.path)) {
      const p = request(`${root}/${c.path}`, { ms: FILE_MS }).then((r) => {
        if (r.status !== 200 || !r.data || !Array.isArray(r.data.scenarios)) throw new SumoError('baked_missing', `${c.path} 取不到（${msgOf(r)}）`);
        return r.data;
      });
      files.set(c.path, p);
      p.catch(() => files.delete(c.path));
    }
    const index = await files.get(c.path);
    const failed = (cat.grid || []).find((g) => g && g.status !== 'complete' && g.params && sameRun(g.params, want));
    return {
      key: c.key, exact: sameRun(c.params, want), params: c.params, requested: want, index,
      engine: cat.engine, generatedAt: cat.generated_at, bakedOn: cat.source, generator: cat.generator_sha256,
      hasReplay: c.preset,
      ...(failed ? { failedExact: { key: failed.key, error: failed.error || '' } } : {}),
      source: 'baked', // 放最后：文件里写了什么 source 都盖掉
    };
  }

  async function fallback(params, reason, extra) {
    try {
      return { ...(await bakedFor(params)), reason, ...extra, source: 'baked' };
    } catch (e) {
      return { source: 'none', reason, ...extra, index: null, hasReplay: false, bakedError: e.message };
    }
  }

  // 云端一次运行：health → POST /runs → 每 pollMs 轮询 → complete 后取 index.json。
  // 成功返回 { [LIVE]: true, runId, elapsedMs, data, h }；任何失败都交给 fb(reason, extra) 回预跑（它的返回值原样返回）
  async function drive(body, { onStatus, signal, limitMs, fb, healthMs = HEALTH_MS, healthReason = (h) => h.error, indexOk = (d) => Array.isArray(d.scenarios) }) {
    const t0 = now();
    const left = () => limitMs - (now() - t0);
    const emit = (phase, extra) => { if (onStatus) try { onStatus({ phase, elapsedMs: now() - t0, ...extra }); } catch { /* 页面回调出错不影响运行 */ } };
    const back = (reason, extra = {}) => { emit('fallback', { reason }); return fb(reason, extra); };
    if (signal && signal.aborted) return back('cancelled');

    emit('health');
    const h = await health({ signal, ms: healthMs, limitMs });
    if (!h.ok) {
      const reason = healthReason(h);
      // 真实路网把查活失败统一叫 health_down，具体原因（sumo_starting / timeout / network …）留在 detail
      return back(reason, { error: h.msg, status: h.status, ...(reason !== h.error ? { detail: h.error } : {}) });
    }

    let runId, last = null;
    try {
      emit('submit');
      const r = await request(`${api}/runs`, { method: 'POST', body, ms: Math.min(REQ_MS, left()), signal });
      if (r.status !== 202 || !r.data || !RUN_ID.test(r.data.id || '')) {
        return back(r.status === 202 ? 'bad_response' : reasonOf(r.status, r.data), { error: msgOf(r), status: r.status });
      }
      runId = r.data.id;
      last = r.data.status || 'queued';
      emit(last, { runId });
    } catch (e) {
      return back(e.code, { error: e.message });
    }

    // 在跑的那次只作记录（liveRunId），不会让预跑结果带上 runId
    let misses = 0;
    for (;;) {
      if (left() <= 0) return back('timeout', { error: `${Math.round(limitMs / 1000)} s 内没跑完`, liveRunId: runId });
      try { await sleep(Math.min(pollMs, left()), signal); } catch { return back('cancelled', { liveRunId: runId }); }
      if (left() <= 0) return back('timeout', { error: `${Math.round(limitMs / 1000)} s 内没跑完`, liveRunId: runId });
      let r;
      try {
        r = await request(`${api}/runs/${runId}`, { ms: Math.min(REQ_MS, left()), signal });
      } catch (e) {
        if (e.code === 'cancelled') return back('cancelled', { liveRunId: runId });
        if (++misses >= 3 || left() <= 0) return back(left() <= 0 ? 'timeout' : e.code, { error: e.message, liveRunId: runId });
        continue;
      }
      if (r.status !== 200 || !r.data) {
        if (r.status === 404 || ++misses >= 3) return back(reasonOf(r.status, r.data), { error: msgOf(r), status: r.status, liveRunId: runId });
        continue;
      }
      misses = 0;
      const st = r.data.status;
      if (st !== last) { emit(st, { runId }); last = st; }
      if (st === 'failed') return back('sumo_failed', { error: String(r.data.error || ''), liveRunId: runId });
      if (st !== 'complete') continue;
      try {
        // 结果已经算完：取 index 至少给 5 s，别因为总时限刚好用完就丢掉
        const ix = await request(`${api}/runs/${runId}/index.json`, { ms: Math.min(REQ_MS, Math.max(left(), 5000)), signal });
        if (ix.status !== 200 || !ix.data || !indexOk(ix.data)) {
          return back(reasonOf(ix.status, ix.data), { error: msgOf(ix), status: ix.status, liveRunId: runId });
        }
        const elapsedMs = now() - t0;
        emit('done', { runId });
        return { [LIVE]: true, runId, elapsedMs, data: ix.data, h };
      } catch (e) {
        return back(e.code, { error: e.message, liveRunId: runId });
      }
    }
  }

  async function run(params = {}, { onStatus, signal } = {}) {
    const body = pick(params);
    const r = await drive(body, { onStatus, signal, limitMs: timeoutMs, fb: (reason, extra) => fallback(params, reason, extra) });
    if (!r || !r[LIVE]) return r;
    return { runId: r.runId, elapsedMs: r.elapsedMs, index: r.data, engine: r.data.engine || r.h.engine, params: r.data.config || body, hasReplay: true, source: 'live' };
  }

  // ---- 真实 CBD 路网（contract v2）----
  const isRealIndex = (d) => !!d && d.version === 2 && d.network === 'real' && Array.isArray(d.scenarios);

  // 预先跑好的真实路网结果：/sumo/public/real/index.json（只下载一次；失败不缓存）
  function loadReal() {
    if (!realP) {
      realP = (async () => {
        const r = await request(`${realRoot}/index.json`, { ms: FILE_MS });
        if (r.status !== 200 || !isRealIndex(r.data)) throw new SumoError('baked_missing', `真实路网预跑 index.json 取不到或格式不对（${msgOf(r)}）`);
        return { network: 'real', index: r.data, engine: r.data.engine, generator: r.data.generator_sha256, source: 'baked' };
      })();
      realP.catch(() => { realP = null; });
    }
    return realP;
  }

  async function realFallback(reason, extra) {
    try {
      return { ...(await loadReal()), reason, ...extra, network: 'real', source: 'baked' };
    } catch (e) {
      return { network: 'real', reason, ...extra, index: null, bakedError: e.message, source: 'none' };
    }
  }

  // 真实路网的请求体：只带有限的数（和数组形式的 scenarios）；范围由 serve.py 的 validate_real 判，越界 → 400 → 回预跑 bad_params
  function realBody(params = {}) {
    const out = { network: 'real' };
    for (const k of ['seed', 'p_original', 'p_ai']) if (typeof params[k] === 'number' && Number.isFinite(params[k])) out[k] = params[k];
    if (Array.isArray(params.scenarios) && params.scenarios.length) out.scenarios = params.scenarios.filter((x) => REAL_SCENARIOS.includes(x));
    return out;
  }

  // 云端重跑真实路网：成功 {source:'live', network:'real', runId, elapsedMs, index}；任何失败回预跑 {source:'baked', reason, index}
  async function runReal(params = {}, { onStatus, signal, timeoutMs: limitMs = REAL_TIMEOUT_MS } = {}) {
    const body = realBody(params);
    const r = await drive(body, {
      onStatus, signal, limitMs, fb: realFallback, healthMs: REAL_HEALTH_MS, indexOk: isRealIndex,
      healthReason: (h) => (h.error === 'cancelled' ? 'cancelled' : 'health_down'),
    });
    if (!r || !r[LIVE]) return r;
    return { network: 'real', runId: r.runId, elapsedMs: r.elapsedMs, index: r.data, engine: r.data.engine || r.h.engine, params: r.data.params || body, source: 'live' };
  }

  function realBase(ref) {
    if (ref && ref.source === 'live' && RUN_ID.test(ref.runId || '')) return `${api}/runs/${ref.runId}`;
    if (ref && ref.source === 'baked') return realRoot;
    throw new SumoError('no_replay', '没有可回放的真实路网结果（source 不是 live / baked）');
  }

  async function realManifest(ref, scenario, { signal } = {}) {
    if (!REAL_SCENARIOS.includes(scenario)) throw new SumoError('bad_params', `未知情景：${scenario}`);
    const r = await request(`${realBase(ref)}/${scenario}/manifest.json`, { ms: FILE_MS, signal });
    if (r.status !== 200 || !r.data || !Array.isArray(r.data.chunks)) throw new SumoError(reasonOf(r.status, r.data), msgOf(r));
    return r.data;
  }

  // file 可以是文件名，也可以直接传 manifest.chunks[i]：带 sha256 且有 WebCrypto 时核对；没有 WebCrypto（http 页面等）就跳过，不让页面挂
  async function realChunk(ref, scenario, file, { signal } = {}) {
    const entry = file && typeof file === 'object' ? file : { file };
    if (!REAL_SCENARIOS.includes(scenario) || !/^frames-\d{3}\.json$/.test(entry.file || '')) throw new SumoError('bad_params', `不认识的块：${scenario}/${entry.file}`);
    const r = await request(`${realBase(ref)}/${scenario}/${entry.file}`, { ms: FILE_MS, signal });
    if (r.status !== 200 || !r.data || !Array.isArray(r.data.frames)) throw new SumoError(reasonOf(r.status, r.data), msgOf(r));
    if (entry.sha256) {
      let got = null;
      try { if (globalThis.crypto && globalThis.crypto.subtle) got = await sha256Hex(r.text); } catch { got = null; }
      if (got !== null && got !== entry.sha256) throw new SumoError('bad_chunk', `${scenario}/${entry.file} 的 sha256 和 manifest 对不上`);
    }
    return r.data;
  }

  function replayBase(ref) {
    if (ref && ref.source === 'live' && RUN_ID.test(ref.runId || '')) return `${api}/runs/${ref.runId}`;
    if (ref && ref.source === 'baked' && ref.hasReplay === true) return `${root}/preset`;
    throw new SumoError('no_replay', '这个结果只有指标，没有逐帧轨迹（预跑格点只存了 index）');
  }

  async function manifest(ref, scenario, { signal } = {}) {
    if (!SCENARIOS.includes(scenario)) throw new SumoError('bad_params', `未知情景：${scenario}`);
    const r = await request(`${replayBase(ref)}/${scenario}/manifest.json`, { ms: FILE_MS, signal });
    if (r.status !== 200 || !r.data || !Array.isArray(r.data.chunks)) throw new SumoError(reasonOf(r.status, r.data), msgOf(r));
    return r.data;
  }

  // file 可以是文件名，也可以直接传 manifest.chunks[i]：带 sha256 时在有 WebCrypto 的环境里核对
  async function chunk(ref, scenario, file, { signal } = {}) {
    const entry = file && typeof file === 'object' ? file : { file };
    if (!SCENARIOS.includes(scenario) || !/^frames-\d{3}\.json$/.test(entry.file || '')) throw new SumoError('bad_params', `不认识的块：${scenario}/${entry.file}`);
    const r = await request(`${replayBase(ref)}/${scenario}/${entry.file}`, { ms: FILE_MS, signal });
    if (r.status !== 200 || !r.data || !Array.isArray(r.data.frames)) throw new SumoError(reasonOf(r.status, r.data), msgOf(r));
    if (entry.sha256 && globalThis.crypto && globalThis.crypto.subtle && (await sha256Hex(r.text)) !== entry.sha256) {
      throw new SumoError('bad_chunk', `${scenario}/${entry.file} 的 sha256 和 manifest 对不上`);
    }
    return r.data;
  }

  return { health, run, loadBaked, bakedFor, manifest, chunk, loadReal, runReal, realManifest, realChunk };
}
