// 用途：用假容器（假的 Durable Object stub）和假限流器测 src/proxy.js + src/worker.js —— 白名单、只有 /runs 收 POST、删头、
//       路径改写、缓存头、限流、忙闸、错误码（含 @cloudflare/containers 包装层的文字报错和 serve.py 的 JSON 报错）
// 用法：node tests/worker.test.mjs（test.sh 会自动跑）；不需要 npm i、不需要 Docker、不联网；最后一行固定「N passed, M failed」
import * as nodeModule from 'node:module';
import * as proxy from '../src/proxy.js';

const { handle, parseRoute, IMMUTABLE, MAX_BODY, CONTAINER_ENV } = proxy;

let P = 0, F = 0;
const ok = (cond, msg) => { if (cond) { P++; console.log('✅ ' + msg); } else { F++; console.log('❌ ' + msg); } };
const BASE = 'https://hackathon-site.example.workers.dev';
const req = (path, init) => new Request(BASE + path, init);
const ID = '0123456789abcdef0123456789abcdef';
const J = { 'content-type': 'application/json' };
const noCors = (res) => ![...res.headers.keys()].some((k) => k.startsWith('access-control-'));

// 假容器：按路径模拟 serve.py；记下收到的每个请求（连同请求体文字）
function fakeStub(opts = {}) {
  const seen = [];
  const stub = {
    seen,
    async fetch(r) {
      const text = r.body ? await r.text() : '';
      seen.push({ url: new URL(r.url), method: r.method, headers: r.headers, text });
      const u = new URL(r.url);
      if (opts.throws) throw opts.throws;
      if (u.pathname === '/sumo/v1/health') {
        if (opts.health) return opts.health();
        return new Response(JSON.stringify({ version: 1, engine: 'Eclipse SUMO sumo 1.27.1', status: 'ready', active_jobs: opts.active ?? 0 }), { status: 200, headers: J });
      }
      if (opts.reply) return opts.reply(u, r);
      if (u.pathname === '/sumo/v1/runs') return new Response(JSON.stringify({ version: 1, id: ID, status: 'queued' }), { status: 202, headers: J });
      return new Response(JSON.stringify({ path: u.pathname, search: u.search }), { status: 200, headers: { ...J, server: 'BaseHTTP/0.6 Python/3.12' } });
    },
  };
  return stub;
}
const fakeRL = (success = true) => {
  const keys = [];
  return { keys, limit: async ({ key }) => { keys.push(key); return { success }; } };
};
const run = (path, init, stub, env = {}) => handle(req(path, init), env, () => stub);
const isErr = async (res, status, code) => {
  const b = await res.json().catch(() => null);
  return res.status === status && b && b.ok === false && b.error === code && typeof b.msg === 'string' && b.msg.length > 0
    && (res.headers.get('content-type') || '').startsWith('application/json') && res.headers.get('cache-control') === 'no-store';
};
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

try {
  // ---- 0. worker.js：只导出 default 和 SumoContainer；容器类字段；固定取 'main' 这一个实例 ----
  {
    const FAKE = new URL('./fake-containers.mjs', import.meta.url).href;
    const hook = (specifier, context, next) => (specifier === '@cloudflare/containers' ? { url: FAKE, shortCircuit: true } : next(specifier, context));
    if (typeof nodeModule.registerHooks === 'function') nodeModule.registerHooks({ resolve: hook });
    else nodeModule.register('data:text/javascript,' + encodeURIComponent(
      `export async function resolve(s, c, n) { return s === '@cloudflare/containers' ? { url: ${JSON.stringify(FAKE)}, shortCircuit: true } : n(s, c); }`));
    const mod = await import('../src/worker.js');
    const fake = await import('./fake-containers.mjs');
    ok(JSON.stringify(Object.keys(mod).sort()) === '["SumoContainer","default"]', `src/worker.js 只导出 default 和 SumoContainer（实际：${Object.keys(mod).join(', ')}；workerd 把具名导出都当入口）`);
    const c = new mod.SumoContainer({}, {});
    ok(c instanceof fake.Container, 'SumoContainer 继承 @cloudflare/containers 的 Container');
    ok(c.defaultPort === 8080 && c.envVars.PORT === String(c.defaultPort), `defaultPort = 8080 = envVars.PORT（${c.defaultPort} / ${c.envVars.PORT}）`);
    ok(c.sleepAfter === '12h', `sleepAfter = 12h（${c.sleepAfter}）`);
    ok(JSON.stringify(c.envVars) === JSON.stringify({ HOST: '0.0.0.0', PORT: '8080', SUMO_DATA_DIR: '/data', SUMO_KEEP_RUNS: '20' }), `容器环境变量 ${JSON.stringify(c.envVars)}`);
    ok(!('ALLOW_ORIGINS' in c.envVars) && !('SUMO_API_KEY' in c.envVars), '反向：不传 ALLOW_ORIGINS / SUMO_API_KEY（Origin 在 Worker 里删掉，容器没有公网入口）');
    ok(/\/sumo\/v1\/health$/.test(c.pingEndpoint), `启动探针打 serve.py 的 health（${c.pingEndpoint}）`);

    const stub = fakeStub();
    const env = { SUMO_CONTAINER: { stub } };
    const res = await mod.default.fetch(req('/api/sumo/v1/health'), env);
    ok(res.status === 200 && stub.seen.length === 1 && fake.calls.length === 1 && fake.calls[0].binding === env.SUMO_CONTAINER && fake.calls[0].name === 'main',
      `default.fetch 用 getContainer(env.SUMO_CONTAINER, 'main') 取容器（${JSON.stringify(fake.calls.map((x) => x.name))}）`);
    const miss = await mod.default.fetch(req('/api/sumo/v1/nope'), env);
    ok(miss.status === 404 && fake.calls.length === 1, '不在白名单的路径 404，而且根本没去取容器（乱敲不会唤醒容器）');
    const nobind = await quiet(() => mod.default.fetch(req('/api/sumo/v1/health'), {}));
    ok(await isErr(nobind, 502, 'sumo_down'), '没有 SUMO_CONTAINER 绑定 → 502 sumo_down（不崩）');
  }

  // ---- 1. 白名单：放行的路径原样改写到容器的 /sumo/v1/… ----
  {
    const cases = [
      ['GET', '/api/sumo/v1/health', '/sumo/v1/health'],
      ['GET', `/api/sumo/v1/runs/${ID}`, `/sumo/v1/runs/${ID}`],
      ['GET', `/api/sumo/v1/runs/${ID}/index.json`, `/sumo/v1/runs/${ID}/index.json`],
      ['GET', `/api/sumo/v1/runs/${ID}/baseline/manifest.json`, `/sumo/v1/runs/${ID}/baseline/manifest.json`],
      ['GET', `/api/sumo/v1/runs/${ID}/closure/frames-000.json`, `/sumo/v1/runs/${ID}/closure/frames-000.json`],
      ['GET', `/api/sumo/v1/runs/${ID}/guided/frames-123.json`, `/sumo/v1/runs/${ID}/guided/frames-123.json`],
      ['GET', `/api/sumo/v1/runs/${ID}/footpath/manifest.json`, `/sumo/v1/runs/${ID}/footpath/manifest.json`],
      ['GET', `/api/sumo/v1/runs/${ID}/frame?scenario=closure&t=118.9`, `/sumo/v1/runs/${ID}/frame`],
      // 真实路网（contract v2）：情景 original / ai
      ['GET', `/api/sumo/v1/runs/${ID}/original/manifest.json`, `/sumo/v1/runs/${ID}/original/manifest.json`],
      ['GET', `/api/sumo/v1/runs/${ID}/original/frames-014.json`, `/sumo/v1/runs/${ID}/original/frames-014.json`],
      ['GET', `/api/sumo/v1/runs/${ID}/ai/manifest.json`, `/sumo/v1/runs/${ID}/ai/manifest.json`],
      ['GET', `/api/sumo/v1/runs/${ID}/ai/frames-000.json`, `/sumo/v1/runs/${ID}/ai/frames-000.json`],
    ];
    for (const [method, path, up] of cases) {
      const stub = fakeStub();
      const res = await run(path, { method }, stub);
      ok(res.status === 200 && stub.seen.length === 1 && stub.seen[0].url.pathname === up && stub.seen[0].method === method, `${method} ${path} → 容器 ${up}`);
    }
    // 查询串：只有 frame 原样带过去；别的丢掉（serve.py 按整条路径比对，带了反而 404）
    const s1 = fakeStub();
    await run(`/api/sumo/v1/runs/${ID}/frame?scenario=closure&t=118.9`, {}, s1);
    ok(s1.seen[0].url.search === '?scenario=closure&t=118.9', `frame 的查询串原样转：${s1.seen[0].url.search}`);
    const s2 = fakeStub();
    await run('/api/sumo/v1/health?nocache=123', {}, s2);
    ok(s2.seen[0].url.search === '' && s2.seen[0].url.pathname === '/sumo/v1/health', 'health?nocache=… 的查询串被丢掉，容器收到干净的 /sumo/v1/health');
  }

  // ---- 2. 白名单：别的路径一律 404 not_found，不碰容器 ----
  {
    const bad = [
      '/api/sumo', '/api/sumo/', '/api/sumo/v1', '/api/sumo/v1/', '/api/sumo/v2/health', '/api/sumo/v1/health/', '/api/sumo/v1/runs/',
      '/api/sumo/v1/HEALTH', `/api/sumo/v1/runs/${ID.toUpperCase()}`, `/api/sumo/v1/runs/${ID.slice(1)}`, `/api/sumo/v1/runs/${ID}0`,
      `/api/sumo/v1/runs/${ID}/job.json`, `/api/sumo/v1/runs/${ID}/raw/sumo.log`, `/api/sumo/v1/runs/${ID}/closure/frames-1.json`,
      `/api/sumo/v1/runs/${ID}/closure/frames-0001.json`, `/api/sumo/v1/runs/${ID}/unknown/manifest.json`, `/api/sumo/v1/runs/${ID}/closure/other.json`,
      `/api/sumo/v1/runs/${ID}/index.json.bak`, `/api/sumo/v1/runs/${ID}/index.json/`, `/api/sumo/v1/runs/${ID}/../../../etc/passwd`,
      `/api/sumo/v1/runs/${ID}/%2e%2e/job.json`, `/api/sumo/v1/runs/${ID}/closure%2fmanifest.json`, '/api/sumo/v1/health%00', '/sumo/v1/health', '/api/sumox/v1/health',
      // 真实路网情景名只认小写全名
      `/api/sumo/v1/runs/${ID}/AI/manifest.json`, `/api/sumo/v1/runs/${ID}/aix/manifest.json`, `/api/sumo/v1/runs/${ID}/originals/manifest.json`,
      `/api/sumo/v1/runs/${ID}/xai/frames-000.json`, `/api/sumo/v1/runs/${ID}/ai/frames-00.json`, `/api/sumo/v1/runs/${ID}/original/index.json`, `/api/sumo/v1/runs/${ID}/real/manifest.json`,
    ];
    for (const path of bad) {
      const stub = fakeStub();
      const res = await run(path, {}, stub);
      ok((await isErr(res, 404, 'not_found')) && stub.seen.length === 0, `GET ${path} → 404 not_found，容器没收到`);
    }
    ok(parseRoute(`/api/sumo/v1/runs/${ID}/closure/frames-007.json`).immutable === true && parseRoute('/api/sumo/v1/health').immutable === false, 'parseRoute：frames 可缓存、health 不可');
  }

  // ---- 3. 方法：GET / HEAD 只读；POST 只在 /runs；405 带 Allow，不碰容器 ----
  {
    const cases = [
      ['POST', '/api/sumo/v1/health', 'GET, HEAD'], ['GET', '/api/sumo/v1/runs', 'POST'], ['HEAD', '/api/sumo/v1/runs', 'POST'],
      ['PUT', '/api/sumo/v1/runs', 'POST'], ['OPTIONS', '/api/sumo/v1/runs', 'POST'], ['POST', `/api/sumo/v1/runs/${ID}`, 'GET, HEAD'],
      ['DELETE', `/api/sumo/v1/runs/${ID}`, 'GET, HEAD'], ['PATCH', `/api/sumo/v1/runs/${ID}/index.json`, 'GET, HEAD'], ['OPTIONS', '/api/sumo/v1/health', 'GET, HEAD'],
      ['POST', `/api/sumo/v1/runs/${ID}/frame?scenario=closure&t=1`, 'GET, HEAD'],
    ];
    for (const [method, path, allow] of cases) {
      const stub = fakeStub();
      const init = method === 'POST' || method === 'PUT' || method === 'PATCH' ? { method, headers: J, body: '{}' } : { method };
      const res = await run(path, init, stub, { SUMO_RL: fakeRL() });
      ok(res.headers.get('allow') === allow && (await isErr(res, 405, 'method_not_allowed')) && stub.seen.length === 0, `${method} ${path} → 405 method_not_allowed，Allow: ${allow}`);
    }
    const stub = fakeStub();
    const h = await run(`/api/sumo/v1/runs/${ID}/index.json`, { method: 'HEAD' }, stub);
    ok(h.status === 200 && h.body === null && stub.seen[0].method === 'HEAD' && h.headers.get('cache-control') === IMMUTABLE, 'HEAD index.json：原样转 HEAD，没有响应体，缓存头照 GET');
  }

  // ---- 4. 删头：Origin / Cookie / Authorization 不进容器，别的头原样；响应不带容器的杂头、没有 CORS ----
  {
    const stub = fakeStub();
    const res = await run(`/api/sumo/v1/runs/${ID}`, {
      headers: { origin: 'https://evil.example', cookie: 'sid=secret', authorization: 'Bearer xyz', 'x-trace': 'keep-me', 'accept-language': 'zh-CN' },
    }, stub);
    const hs = stub.seen[0].headers;
    ok(!hs.has('origin') && !hs.has('cookie') && !hs.has('authorization'), '转给容器的请求没有 Origin / Cookie / Authorization');
    ok(hs.get('x-trace') === 'keep-me' && hs.get('accept-language') === 'zh-CN', '其余请求头原样转');
    ok(res.headers.get('server') === null && noCors(res), '响应不带容器的 Server 头，也没有任何 Access-Control-*（同源）');
    const h = proxy.stripHeaders(new Headers({ Origin: 'x', COOKIE: 'y', Authorization: 'z', 'Content-Type': 'application/json' }));
    ok([...h.keys()].join(',') === 'content-type', `stripHeaders 不分大小写：剩 ${[...h.keys()].join(',')}`);
  }

  // ---- 5. 缓存头：完成后的 index / manifest / frames 的 200 缓存一天，其余 no-store ----
  {
    const immut = [`/api/sumo/v1/runs/${ID}/index.json`, `/api/sumo/v1/runs/${ID}/closure/manifest.json`, `/api/sumo/v1/runs/${ID}/guided/frames-002.json`,
      `/api/sumo/v1/runs/${ID}/original/manifest.json`, `/api/sumo/v1/runs/${ID}/ai/frames-009.json`];
    for (const p of immut) {
      const res = await run(p, {}, fakeStub());
      ok(res.status === 200 && res.headers.get('cache-control') === IMMUTABLE, `${p.replace(ID, '<id>')} → cache-control: ${res.headers.get('cache-control')}`);
    }
    const store = ['/api/sumo/v1/health', `/api/sumo/v1/runs/${ID}`, `/api/sumo/v1/runs/${ID}/frame?scenario=closure&t=1`];
    for (const p of store) {
      const res = await run(p, {}, fakeStub());
      ok(res.status === 200 && res.headers.get('cache-control') === 'no-store', `${p.replace(ID, '<id>')} → no-store`);
    }
    const post = await run('/api/sumo/v1/runs', { method: 'POST', headers: J, body: '{}' }, fakeStub());
    ok(post.status === 202 && post.headers.get('cache-control') === 'no-store', 'POST /runs 的 202 → no-store');
    const early = await run(`/api/sumo/v1/runs/${ID}/index.json`, {}, fakeStub({ reply: () => new Response('{"error":"Run is not complete; query its status first"}', { status: 409, headers: J }) }));
    ok(await isErr(early, 409, 'not_ready'), '完成前读 index.json：容器 409 → 409 not_ready，而且 no-store（不会把错误缓存一天）');
  }

  // ---- 6. health 原样透传：一个字节都不加 ----
  {
    const raw = '{"version": 1, "engine": "Eclipse SUMO sumo 1.27.1", "status": "ready", "active_jobs": 1}';
    const stub = fakeStub({ health: () => new Response(raw, { status: 200, headers: { 'content-type': 'application/json' } }) });
    const res = await run('/api/sumo/v1/health', {}, stub);
    ok(res.status === 200 && (await res.text()) === raw && res.headers.get('content-type') === 'application/json', 'health：状态码、content-type、响应体都是容器原样');
  }

  // ---- 7. POST /runs：请求体上限 → 每 IP 限流 → 忙闸 → 转发 ----
  {
    const body = JSON.stringify({ seed: 42, demand_scale: 1.2, clearance_s: 600, diversion_share: 0.3 });
    const post = (extra = {}) => ({ method: 'POST', headers: { ...J, 'cf-connecting-ip': '203.0.113.7', origin: BASE, ...(extra.headers || {}) }, body: extra.body ?? body });

    // 正常：先问 health，再原样转 POST
    {
      const stub = fakeStub({ active: 1 });
      const RL = fakeRL(true);
      const res = await run('/api/sumo/v1/runs', post(), stub, { SUMO_RL: RL });
      const b = await res.json();
      ok(res.status === 202 && b.id === ID, `正常 POST → 202（容器原样）${JSON.stringify(b)}`);
      ok(stub.seen.length === 2 && stub.seen[0].url.pathname === '/sumo/v1/health' && stub.seen[0].method === 'GET' && stub.seen[1].url.pathname === '/sumo/v1/runs', '顺序：先 GET health（忙闸），再 POST /sumo/v1/runs');
      ok(stub.seen[1].method === 'POST' && stub.seen[1].text === body && stub.seen[1].headers.get('content-type') === 'application/json' && !stub.seen[1].headers.has('origin'),
        'POST 的请求体、content-type 原样到容器，Origin 已删');
      ok(RL.keys.length === 1 && RL.keys[0] === '203.0.113.7', `限流键 = CF-Connecting-IP（${RL.keys[0]}）`);
    }
    // 真实路网（contract v2）：新字段原样到容器，Worker 不挑字段、不改写
    {
      const real = JSON.stringify({ network: 'real', seed: 7, p_original: 0.14, p_ai: 0.53, scenarios: ['baseline', 'original', 'ai'] });
      const stub = fakeStub({ active: 0 });
      const res = await run('/api/sumo/v1/runs', post({ body: real }), stub, { SUMO_RL: fakeRL(true) });
      ok(res.status === 202 && stub.seen.length === 2 && stub.seen[1].url.pathname === '/sumo/v1/runs' && stub.seen[1].text === real,
        `真实路网 POST：{network:'real', seed, p_original, p_ai, scenarios} 一个字节不改到容器（${stub.seen[1] && stub.seen[1].text.length} 字节）`);
      const busy = fakeStub({ active: 2 });
      ok((await isErr(await run('/api/sumo/v1/runs', post({ body: real }), busy, {}), 429, 'sumo_busy')) && busy.seen.length === 1, '真实路网 POST 也过忙闸：active_jobs = 2 → 429 sumo_busy');
      const limited = fakeStub();
      ok((await isErr(await run('/api/sumo/v1/runs', post({ body: real }), limited, { SUMO_RL: fakeRL(false) }), 429, 'sumo_rate')) && limited.seen.length === 0, '真实路网 POST 也限流：命中 → 429 sumo_rate，容器没收到');
      const bigReal = JSON.stringify({ network: 'real', seed: 1, p_original: 0.1, p_ai: 0.5, scenarios: Array(400).fill('ai') });
      ok(bigReal.length > MAX_BODY && (await isErr(await run('/api/sumo/v1/runs', post({ body: bigReal }), fakeStub(), {}), 413, 'too_big')), `真实路网 POST 也受 ${MAX_BODY} 字节上限（${bigReal.length} 字节 → 413）`);
      const bad = fakeStub({ reply: () => new Response(JSON.stringify({ error: 'p_ai must be a number in [0, 1]' }), { status: 400, headers: J }) });
      const rb = await run('/api/sumo/v1/runs', post({ body: JSON.stringify({ network: 'real', p_ai: 2 }) }), bad, {});
      const bb = await rb.clone().json();
      ok((await isErr(rb, 400, 'bad_request')) && bb.msg.includes('p_ai must be a number in [0, 1]'), `serve.py 拒真实路网参数 → 400 bad_request，原因留在 msg：${bb.msg}`);
    }
    // 请求体太大：不限流计数、不碰容器
    {
      const stub = fakeStub(); const RL = fakeRL(true);
      const big = JSON.stringify({ seed: 42, pad: 'x'.repeat(MAX_BODY) });
      const res = await run('/api/sumo/v1/runs', post({ body: big }), stub, { SUMO_RL: RL });
      ok((await isErr(res, 413, 'too_big')) && stub.seen.length === 0 && RL.keys.length === 0, `请求体 ${big.length} 字节 > ${MAX_BODY} → 413 too_big，没碰容器也没消耗限流次数`);
      const exact = JSON.stringify({ seed: 42, pad: 'x'.repeat(MAX_BODY - JSON.stringify({ seed: 42, pad: '' }).length) });
      const res2 = await run('/api/sumo/v1/runs', post({ body: exact }), fakeStub(), {});
      ok(exact.length === MAX_BODY && res2.status === 202, `恰好 ${MAX_BODY} 字节放行`);
      // 分块上传、不带 content-length：边读边数
      const chunks = [new TextEncoder().encode('{"a":"'), new Uint8Array(MAX_BODY).fill(120), new TextEncoder().encode('"}')];
      const stream = new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } });
      const s3 = fakeStub();
      const res3 = await run('/api/sumo/v1/runs', { method: 'POST', headers: J, body: stream, duplex: 'half' }, s3, {});
      ok((await isErr(res3, 413, 'too_big')) && s3.seen.length === 0, '分块上传（没有 content-length）超过上限也 413');
      const res4 = await run('/api/sumo/v1/runs', { method: 'POST', headers: { ...J, 'content-length': String(MAX_BODY + 1) }, body: '{}' }, fakeStub(), {});
      ok(await isErr(res4, 413, 'too_big'), 'content-length 声明超过上限直接 413');
    }
    // 限流命中
    {
      const stub = fakeStub(); const RL = fakeRL(false);
      const res = await run('/api/sumo/v1/runs', post(), stub, { SUMO_RL: RL });
      ok(res.headers.get('retry-after') === '60' && (await isErr(res, 429, 'sumo_rate')) && stub.seen.length === 0, '限流命中 → 429 sumo_rate、Retry-After 60，容器一个请求都没收到');
      const noip = fakeRL(true);
      await run('/api/sumo/v1/runs', { method: 'POST', headers: J, body }, fakeStub(), { SUMO_RL: noip });
      ok(noip.keys[0] === 'unknown', '没有 CF-Connecting-IP（本地）时限流键是 unknown，不崩');
    }
    // 没绑限流器 → 跳过；限流器抛错 → 放行（还有忙闸兜底）
    {
      const res = await run('/api/sumo/v1/runs', post(), fakeStub(), {});
      ok(res.status === 202, '没有 SUMO_RL 绑定：跳过限流，照常 202');
      const broken = { limit: async () => { throw new Error('rl down'); } };
      const res2 = await quiet(() => run('/api/sumo/v1/runs', post(), fakeStub(), { SUMO_RL: broken }));
      ok(res2.status === 202, 'SUMO_RL.limit 抛错：放行，照常 202');
    }
    // 忙闸
    {
      const stub = fakeStub({ active: 2 });
      const res = await run('/api/sumo/v1/runs', post(), stub, { SUMO_RL: fakeRL(true) });
      ok((await isErr(res, 429, 'sumo_busy')) && stub.seen.length === 1 && stub.seen[0].url.pathname === '/sumo/v1/health', 'active_jobs = 2 → 429 sumo_busy，POST 没转给容器');
      const s5 = fakeStub({ active: 5 });
      ok(await isErr(await run('/api/sumo/v1/runs', post(), s5, {}), 429, 'sumo_busy'), 'active_jobs = 5 → 429 sumo_busy');
      const starting = fakeStub({ health: () => new Response('There is no Container instance available at this time.\nThis is likely because you have reached your max concurrent instance count (set in wrangler config) or are you currently provisioning the Container.', { status: 503 }) });
      const r2 = await run('/api/sumo/v1/runs', post(), starting, {});
      ok(r2.headers.get('retry-after') === '10' && (await isErr(r2, 503, 'sumo_starting')) && starting.seen.length === 1, '忙闸问 health 时容器还在供应（503 文字）→ 503 sumo_starting，POST 没转');
      const weird = fakeStub({ health: () => new Response('<html>oops</html>', { status: 200, headers: { 'content-type': 'text/html' } }) });
      ok(await isErr(await run('/api/sumo/v1/runs', post(), weird, {}), 502, 'sumo_down'), '忙闸拿到的 health 不是 JSON → 502 sumo_down');
      const thrown = fakeStub({ throws: new Error('Network connection lost.') });
      ok(await isErr(await quiet(() => run('/api/sumo/v1/runs', post(), thrown, {})), 502, 'sumo_down'), '忙闸时容器抛错 → 502 sumo_down');
    }
  }

  // ---- 8. 错误码：包装层的文字报错、serve.py 的 JSON 报错都翻成 { ok:false, error, msg } ----
  {
    const text = (status, t) => fakeStub({ reply: () => new Response(t, { status }) });
    const js = (status, obj) => fakeStub({ reply: () => new Response(JSON.stringify(obj), { status, headers: J }) });
    const P1 = `/api/sumo/v1/runs/${ID}`;
    const cases = [
      [text(503, 'There is no Container instance available at this time.'), 503, 'sumo_starting', '包装层 503（还在供应 / 没有实例）'],
      [text(500, 'Failed to start container: Container did not start after 8000ms'), 503, 'sumo_starting', '包装层 500「did not start」'],
      [text(500, 'Failed to start container: the container is not listening on port 8080'), 503, 'sumo_starting', '包装层 500「not listening」'],
      [text(429, 'you are requesting too many containers per second'), 503, 'sumo_starting', '包装层 429（平台启动限流）'],
      [text(500, 'Container suddenly disconnected, try again'), 502, 'sumo_down', '包装层 500「suddenly disconnected」'],
      [text(500, 'Error proxying request to container: INTERNAL-xyz'), 502, 'sumo_down', '包装层 500「Error proxying」'],
      [text(502, 'Bad Gateway'), 502, 'sumo_down', '别的非 JSON 5xx'],
      [js(404, { error: 'Run not found' }), 404, 'not_found', 'serve.py 404 Run not found（容器重启后旧 id）'],
      [js(409, { error: 'Run is not complete; query its status first' }), 409, 'not_ready', 'serve.py 409'],
      [js(400, { error: 'demand_scale must be a number in [0.1, 1.2]' }), 400, 'bad_request', 'serve.py 400 参数越界'],
      [js(415, { error: 'Use application/json' }), 415, 'bad_request', 'serve.py 415'],
      [js(413, { error: 'JSON body must be between 1 and 16384 bytes' }), 413, 'too_big', 'serve.py 413'],
      [js(429, { error: 'Queue full; retry when an active run completes' }), 429, 'sumo_busy', 'serve.py 429 Queue full'],
      [js(429, { error: 'Too many new runs from this address; wait a minute' }), 429, 'sumo_rate', 'serve.py 429 Too many new runs'],
      [js(500, { error: 'boom' }), 502, 'sumo_down', 'serve.py 500 JSON'],
    ];
    for (const [stub, status, code, what] of cases) {
      const res = await quiet(() => run(P1, {}, stub));
      ok(await isErr(res, status, code), `${what} → ${status} ${code}`);
    }
    const detail = await (await run(P1, {}, js(400, { error: 'demand_scale must be a number in [0.1, 1.2]' }))).json();
    ok(detail.msg.includes('demand_scale must be a number in [0.1, 1.2]'), `serve.py 的英文原因留在 msg 里：${detail.msg}`);
    const leak = await (await quiet(() => run(P1, {}, text(500, 'Error proxying request to container: INTERNAL-xyz')))).text();
    ok(!leak.includes('INTERNAL-xyz'), '反向：包装层的内部报错细节不吐给浏览器');
    const already = await run(P1, {}, js(418, { ok: false, error: 'teapot', msg: '已经是仓库格式' }));
    ok(already.status === 418 && (await already.json()).error === 'teapot', '容器已经回仓库格式的错误就原样给（serve.py 以后改格式也兼容）');
    const thrown = await quiet(() => run(P1, {}, fakeStub({ throws: new Error('INTERNAL-abc Network connection lost.') })));
    const tb = await thrown.text();
    ok(thrown.status === 502 && JSON.parse(tb).error === 'sumo_down' && !tb.includes('INTERNAL-abc'), 'stub.fetch 直接抛错 → 502 sumo_down，不泄露细节');
    const thrown2 = await quiet(() => run(P1, {}, fakeStub({ throws: new Error('there is no container instance that can be provided to this durable object') })));
    ok(await isErr(thrown2, 503, 'sumo_starting'), 'stub.fetch 抛「no container instance」→ 503 sumo_starting');
    const getThrows = await quiet(() => handle(req(P1), {}, () => { throw new Error('no binding'); }));
    ok(await isErr(getThrows, 502, 'sumo_down'), '取容器 stub 就抛错 → 502 sumo_down');
  }

  // ---- 9. 常量和契约一致 ----
  ok(MAX_BODY === 2048 && proxy.BUSY_JOBS === 2 && IMMUTABLE === 'public, max-age=86400, immutable', `常量：body ≤ ${MAX_BODY}、忙闸 ${proxy.BUSY_JOBS}、${IMMUTABLE}`);
  ok(CONTAINER_ENV.HOST === '0.0.0.0' && CONTAINER_ENV.PORT === '8080' && CONTAINER_ENV.SUMO_DATA_DIR === '/data' && CONTAINER_ENV.SUMO_KEEP_RUNS === '20' && Object.isFrozen(CONTAINER_ENV), 'CONTAINER_ENV 是契约 §1 的四个值，而且冻结');

  // ---- 10. 方案模式（T49）：opt-A … opt-E 的 manifest / frames 放行、可缓存；别的写法 404；options 请求体原样到容器 ----
  {
    for (const sc of ['opt-A', 'opt-C', 'opt-E']) {
      for (const file of ['manifest.json', 'frames-000.json', 'frames-042.json']) {
        const path = `/api/sumo/v1/runs/${ID}/${sc}/${file}`;
        const stub = fakeStub();
        const res = await run(path, {}, stub);
        ok(res.status === 200 && stub.seen.length === 1 && stub.seen[0].url.pathname === `/sumo/v1/runs/${ID}/${sc}/${file}` && res.headers.get('cache-control') === IMMUTABLE,
          `GET <id>/${sc}/${file} → 容器，cache-control 一天`);
      }
    }
    const bad = ['opt-F', 'opt-a', 'opt-AB', 'opt-', 'OPT-A', 'opt_A', 'optA', 'opt-A-', 'xopt-A', 'opt-Z'].map((sc) => `/api/sumo/v1/runs/${ID}/${sc}/manifest.json`)
      .concat([`/api/sumo/v1/runs/${ID}/opt-A/frames-1.json`, `/api/sumo/v1/runs/${ID}/opt-A/index.json`, `/api/sumo/v1/runs/${ID}/opt-A/../job.json`, `/api/sumo/v1/runs/${ID}/opt-A/manifest.json/`]);
    for (const path of bad) {
      const stub = fakeStub();
      const res = await run(path, {}, stub);
      ok((await isErr(res, 404, 'not_found')) && stub.seen.length === 0, `GET ${path.replace(ID, '<id>')} → 404 not_found，容器没收到`);
    }
    const five = JSON.stringify({ network: 'real', seed: 2147483647, options: ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id, p: 0.123456789012 })), frames: false });
    const stub = fakeStub({ active: 0 });
    const res = await run('/api/sumo/v1/runs', { method: 'POST', headers: { ...J, 'cf-connecting-ip': '203.0.113.9' }, body: five }, stub, { SUMO_RL: fakeRL(true) });
    ok(res.status === 202 && stub.seen.length === 2 && stub.seen[1].url.pathname === '/sumo/v1/runs' && stub.seen[1].text === five && five.length < MAX_BODY / 4,
      `方案模式 POST {network, seed, options×5, frames} 一个字节不改到容器（${five.length} 字节，远小于 ${MAX_BODY}）`);
    const busy = fakeStub({ active: 2 });
    ok((await isErr(await run('/api/sumo/v1/runs', { method: 'POST', headers: J, body: five }, busy, {}), 429, 'sumo_busy')) && busy.seen.length === 1, '方案模式 POST 也过忙闸：active_jobs = 2 → 429 sumo_busy');
  }
} catch (e) {
  F++;
  console.log('❌ 测试本身崩了：' + (e && e.stack));
}

console.log(`${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);
