// hackathon-sumo 的路由与转发（T37，D-0930-1700）：白名单、删头、限流、忙闸、错误码、缓存头全在这里。
// 不 import 任何 Cloudflare 模块，node 里直接能测；容器从 worker.js 以 getStub() 交进来（测试换成假的）。
// 对外路径 /api/sumo/v1/X（site 原样转来）→ 容器 /sumo/v1/X（apps/web/tools/sumo/serve.py）。
// 错误一律 { ok:false, error, msg }（docs/contract.md §错误格式）；容器自己的 {error:'英文'} 也在这里翻成这个格式。

export const PUBLIC_PREFIX = '/api/sumo/v1';
export const UPSTREAM_PREFIX = '/sumo/v1';
export const UPSTREAM_ORIGIN = 'http://sumo-container'; // 主机名随便写：Container 类只按端口转，serve.py 不看 Host
export const MAX_BODY = 2048; // POST /runs 的请求体上限（字节）；serve.py 自己是 16 KB，这里更紧。真实路网的 {network,seed,p_original,p_ai,scenarios} / 方案模式的 {network,seed,options,frames}（T49，5 个方案约 150 字节）原样转，不在这里挑字段（serve.py 的 validate_real 管）
export const BUSY_JOBS = 2; // 容器里同时有这么多个任务（排队 + 在跑）就回 429 sumo_busy
export const IMMUTABLE = 'public, max-age=86400, immutable'; // 运行 id 是随机的 32 位 hex，完成后的产物不会再变
export const STRIP_HEADERS = ['origin', 'cookie', 'authorization']; // Origin 不删的话 serve.py 回 403（ALLOW_ORIGINS 是空的）

// 容器启动时的环境变量（worker.js 的 SumoContainer.envVars；Dockerfile 的 ENV 也是这几个值，两边一起改）
export const CONTAINER_ENV = Object.freeze({ HOST: '0.0.0.0', PORT: '8080', SUMO_DATA_DIR: '/data', SUMO_KEEP_RUNS: '20', SUMO_REAL_JOBS: '4' }); // 4 = standard-4 的核数

const GET = Object.freeze(['GET', 'HEAD']); // HEAD 只是不要响应体的 GET，serve.py 支持
const ID = '[0-9a-f]{32}';
// 合成 2×2 的四个情景 + 真实路网（contract v2，network:'real'）的 original / ai + 方案模式（T49，options）的 opt-A … opt-E；baseline 共用
const SCENARIO = '(?:baseline|closure|guided|footpath|original|ai|opt-[A-E])';
// 白名单：只有这几种路径会碰到容器；别的一律 404，不唤醒容器
const ROUTES = [
  { kind: 'health', re: /^health$/, methods: GET },
  { kind: 'runs', re: /^runs$/, methods: Object.freeze(['POST']) },
  { kind: 'run', re: new RegExp(`^runs/(${ID})$`), methods: GET },
  { kind: 'index', re: new RegExp(`^runs/(${ID})/index\\.json$`), methods: GET, immutable: true },
  { kind: 'output', re: new RegExp(`^runs/(${ID})/${SCENARIO}/(?:manifest|frames-\\d{3})\\.json$`), methods: GET, immutable: true },
  { kind: 'frame', re: new RegExp(`^runs/(${ID})/frame$`), methods: GET, query: true },
];

// 路径 → 路由（不在白名单返回 null）。只有 frame 带查询串（scenario、t），别的丢掉：serve.py 按整条路径比对
export function parseRoute(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith(PUBLIC_PREFIX + '/')) return null;
  const rest = pathname.slice(PUBLIC_PREFIX.length + 1);
  for (const r of ROUTES) {
    const m = r.re.exec(rest);
    if (m) return { kind: r.kind, id: m[1] || null, methods: r.methods, immutable: !!r.immutable, keepQuery: !!r.query, upstream: `${UPSTREAM_PREFIX}/${rest}` };
  }
  return null;
}

// 转给容器的请求头：原样拷贝，去掉 Origin / Cookie / Authorization
export function stripHeaders(headers) {
  const out = new Headers(headers);
  for (const h of STRIP_HEADERS) out.delete(h);
  return out;
}

// 成功响应的缓存头：只有完成后的 index / manifest / frames-NNN 的 200 能缓存一天，其余一律 no-store
export const cacheControlFor = (route, status) => (route && route.immutable && status === 200 ? IMMUTABLE : 'no-store');

export function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

// docs/contract.md §错误格式
export const fail = (status, error, msg, extra) => json({ ok: false, error, msg }, status, extra);

const MSG = {
  not_found: '没有这个接口',
  method_not_allowed: '这个接口不支持这种请求方法',
  too_big: `请求体太大（上限 ${MAX_BODY} 字节）`,
  sumo_rate: '同一个网络一分钟最多发起 3 次现场 SUMO 运行，请稍后再试，或先看预先跑好的结果',
  sumo_busy: '现场 SUMO 正忙（同时已有 2 个任务），请稍后再试，或先看预先跑好的结果',
  sumo_down: '现场 SUMO 容器没有响应，请改用预先跑好的结果',
  sumo_starting: '现场 SUMO 容器正在启动（刚部署时要几分钟），请稍后再试，或先看预先跑好的结果',
};
const RETRY = { sumo_rate: '60', sumo_busy: '15', sumo_starting: '10' };
const failCode = (status, code, msg = MSG[code]) => fail(status, code, msg, RETRY[code] ? { 'retry-after': RETRY[code] } : undefined);

// @cloudflare/containers 包装层的文字报错（不是 serve.py 的 JSON）：容器还没供应好 / 没起来 / 端口没就绪 → 启动中，其余 → 挂了
const STARTING_RE = /no container instance|provisioning|did not start|not listening|failed to verify port|too many containers/i;
export function wrapperError(status, text) {
  if (status === 503 || status === 429 || STARTING_RE.test(text || '')) return failCode(503, 'sumo_starting');
  return failCode(502, 'sumo_down');
}

// serve.py 的 JSON 报错 {error:'英文'} → 仓库格式；英文原文放进 msg 括号里方便排查
export function containerError(status, detail) {
  const d = String(detail || '').slice(0, 300);
  const tail = d ? `（${d}）` : '';
  if (status >= 500) return failCode(502, 'sumo_down', MSG.sumo_down + tail);
  if (status === 404) return failCode(404, 'not_found', '没有这个运行或文件（容器重启后旧的运行 id 会失效）' + tail);
  if (status === 409) return failCode(409, 'not_ready', '这次运行还没完成，先查状态' + tail);
  if (status === 413) return failCode(413, 'too_big', MSG.too_big + tail);
  if (status === 429) return /too many/i.test(d) ? failCode(429, 'sumo_rate', MSG.sumo_rate + tail) : failCode(429, 'sumo_busy', MSG.sumo_busy + tail);
  return failCode(status, 'bad_request', '参数不对' + tail);
}

// 容器回的 ≥ 400 响应 → 仓库格式的错误
export async function upstreamError(res) {
  const type = res.headers.get('content-type') || '';
  const text = await res.text().catch(() => '');
  if (!type.includes('application/json')) return wrapperError(res.status, text);
  let body = null;
  try { body = JSON.parse(text); } catch { return wrapperError(res.status, text); }
  // 已经是仓库格式（serve.py 以后改了也兼容）就原样给
  if (body && body.ok === false && typeof body.error === 'string' && typeof body.msg === 'string') return json(body, res.status);
  return containerError(res.status, body && (body.error || body.msg));
}

// stub.fetch 直接抛错（Durable Object 连不上、容器类构造失败等）
export function thrownError(e) {
  const text = e && e.message ? e.message : String(e);
  console.error('SUMO 容器请求抛错', text);
  return STARTING_RE.test(text) ? failCode(503, 'sumo_starting') : failCode(502, 'sumo_down');
}

// 读请求体，超过 max 字节返回 null（边读边数，不把大包整个读进内存）
export async function readCapped(request, max = MAX_BODY) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

// 每个 IP 每分钟 3 次（wrangler.jsonc 的 ratelimits SUMO_RL）；没绑（本地 / 测试）就跳过，限流器自己出错也放行（后面还有忙闸）
export async function overRateLimit(env, request) {
  const rl = env && env.SUMO_RL;
  if (!rl || typeof rl.limit !== 'function') return false;
  const key = request.headers.get('cf-connecting-ip') || 'unknown';
  try {
    const { success } = await rl.limit({ key });
    return success === false;
  } catch (e) {
    console.error('SUMO_RL 限流器出错，放行', e && e.message);
    return false;
  }
}

// 忙闸：先问容器 health，active_jobs ≥ BUSY_JOBS 回 429；容器没起来 / 出错直接回对应错误。返回 null = 放行
export async function busyGate(stub) {
  let res;
  try {
    res = await stub.fetch(new Request(`${UPSTREAM_ORIGIN}${UPSTREAM_PREFIX}/health`, { method: 'GET' }));
  } catch (e) {
    return thrownError(e);
  }
  if (res.status >= 400) return upstreamError(res);
  let h = null;
  try { h = await res.json(); } catch { /* 下面按坏响应处理 */ }
  if (!h || typeof h.active_jobs !== 'number') return failCode(502, 'sumo_down', MSG.sumo_down + '（health 响应不对）');
  if (h.active_jobs >= BUSY_JOBS) return failCode(429, 'sumo_busy');
  return null;
}

// 主入口：request = site 原样转来的请求；getStub() 返回容器的 Durable Object stub（只有过了白名单才调用，免得乱敲的路径唤醒容器）
export async function handle(request, env = {}, getStub) {
  const url = new URL(request.url);
  const route = parseRoute(url.pathname);
  if (!route) return failCode(404, 'not_found');
  const method = request.method.toUpperCase();
  if (!route.methods.includes(method)) return fail(405, 'method_not_allowed', MSG.method_not_allowed, { allow: route.methods.join(', ') });

  let stub;
  try {
    stub = getStub();
  } catch (e) {
    return thrownError(e);
  }

  let body;
  if (method === 'POST') {
    body = await readCapped(request, MAX_BODY);
    if (body === null) return failCode(413, 'too_big');
    if (await overRateLimit(env, request)) return failCode(429, 'sumo_rate');
    const gate = await busyGate(stub);
    if (gate) return gate;
  }

  const target = `${UPSTREAM_ORIGIN}${route.upstream}${route.keepQuery ? url.search : ''}`;
  let res;
  try {
    res = await stub.fetch(new Request(target, { method, headers: stripHeaders(request.headers), body }));
  } catch (e) {
    return thrownError(e);
  }
  if (res.status >= 400) return upstreamError(res);

  // 成功：状态码、content-type、响应体原样；容器的其它响应头（Server 等）不往外带
  const headers = new Headers({ 'cache-control': cacheControlFor(route, res.status) });
  const type = res.headers.get('content-type');
  if (type) headers.set('content-type', type);
  return new Response(method === 'HEAD' ? null : res.body, { status: res.status, headers });
}
