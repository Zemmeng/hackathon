// 用途：用假的 ASSETS / API / SUMO 绑定测 src/worker.js —— 静态文件直通、/api/sumo/* 转 SUMO 或 503 / 502、/api/* 转发或 503、/api/health 自报、没有 CORS
// 用法：node tests/worker.test.mjs（test.sh 会自动跑）；不需要 wrangler、不联网；最后一行固定「N passed, M failed」
import * as mod from '../src/worker.js';

const worker = mod.default;
const VERSION = 'site-0.1';

let P = 0, F = 0;
const ok = (cond, msg) => { if (cond) { P++; console.log('✅ ' + msg); } else { F++; console.log('❌ ' + msg); } };
const BASE = 'https://hackathon-site.example.workers.dev';
const req = (path, init) => new Request(BASE + path, init);

// 假绑定：记下收到的请求，回一个能认出来的响应
const fake = (tag) => {
  const seen = [];
  return { seen, fetch: async (r) => { seen.push(r); return new Response(`${tag}:${new URL(r.url).pathname}`, { status: 200, headers: { 'x-from': tag } }); } };
};
const noCors = (res) => ![...res.headers.keys()].some((k) => k.startsWith('access-control-'));

try {
  // ---- 0. workerd 把每个具名导出都当入口：导出字符串 / 普通函数会让整个 Worker 起不来（实测报 Incorrect type for map entry）----
  ok(JSON.stringify(Object.keys(mod)) === '["default"]', `src/worker.js 只导出 default（实际：${Object.keys(mod).join(', ')}）`);

  // ---- 1. 没绑 API（T5 还没上线）----
  {
    const ASSETS = fake('assets');
    const env = { ASSETS };

    const h = await worker.fetch(req('/api/health'), env);
    const hb = await h.json();
    ok(h.status === 200 && hb.ok === true && hb.v === VERSION && hb.mock === true && hb.api === false, `没绑 API：/api/health 200 ${JSON.stringify(hb)}`);
    ok((h.headers.get('content-type') || '').startsWith('application/json') && h.headers.get('cache-control') === 'no-store', '/api/health 是 JSON 且 no-store');

    const r = await worker.fetch(req('/api/read', { method: 'POST', body: '{"persona":"commuter"}' }), env);
    const rb = await r.json();
    ok(r.status === 503 && rb.ok === false && rb.error === 'api_not_deployed' && typeof rb.msg === 'string' && rb.msg.length > 0, `没绑 API：POST /api/read → 503 ${rb.error}（契约 §错误格式）`);
    const bare = await worker.fetch(req('/api'), env);
    ok(bare.status === 503, '没绑 API：/api（不带斜杠）也回 503 JSON，不落到静态文件');
    ok(ASSETS.seen.length === 0, '反向：/api/* 一个都没交给 ASSETS（不会把一页 HTML 当接口响应）');
    ok(noCors(h) && noCors(r), '反向：/api 响应里没有任何 Access-Control-* 头（同源，故意不开 CORS）');
  }

  // ---- 2. 静态文件直通 ASSETS ----
  {
    const ASSETS = fake('assets');
    const env = { ASSETS };
    for (const p of ['/', '/sim/public/', '/roads/public/cbd/network.json', '/engine/public/js/index.js', '/apiary', '/api/public/js/reader.js']) {
      const q = req(p);
      const res = await worker.fetch(q, env);
      ok(res.status === 200 && (await res.text()) === `assets:${p}` && ASSETS.seen.at(-1) === q, `${p} → ASSETS 原样收到同一个请求`);
    }
    const none = await worker.fetch(req('/sim/public/'), {});
    ok(none.status === 500 && (await none.json()).error === 'no_assets', '没有 ASSETS 绑定 → 500 JSON no_assets（配置丢了能一眼看出）');
  }

  // ---- 3. 绑了 API：/api/* 原样转发，/api/public/* 仍是静态文件 ----
  {
    const ASSETS = fake('assets'), API = fake('api');
    const env = { ASSETS, API };
    const q = req('/api/read?x=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"persona":"local"}' });
    const res = await worker.fetch(q, env);
    const got = API.seen[0];
    ok(res.status === 200 && (await res.text()) === 'api:/api/read' && res.headers.get('x-from') === 'api', '绑了 API：POST /api/read 的响应原样来自 API Worker');
    ok(got === q && got.method === 'POST' && new URL(got.url).search === '?x=1' && (await got.text()) === '{"persona":"local"}', '转发的是原请求：方法、查询串、请求体都不变');
    const h = await worker.fetch(req('/api/health'), env);
    ok((await h.text()) === 'api:/api/health', '绑了 API：/api/health 交给 T5（不再自报 api:false）');
    const s = await worker.fetch(req('/api/public/js/reader.js'), env);
    ok((await s.text()) === 'assets:/api/public/js/reader.js' && API.seen.length === 2, '绑了 API：/api/public/*（apps/api/public/ 的静态文件）仍走 ASSETS，不转发');
    ok(ASSETS.seen.length === 1, '反向：绑了 API 后 /api/read、/api/health 都没交给 ASSETS');
  }

  // ---- 4. API Worker 出错：502 JSON，不把内部报错吐给浏览器 ----
  {
    const API = { fetch: async () => { throw new Error('INTERNAL-DETAIL-xyz'); } };
    const origErr = console.error; console.error = () => {};
    const res = await worker.fetch(req('/api/read', { method: 'POST', body: '{}' }), { ASSETS: fake('assets'), API });
    console.error = origErr;
    const text = await res.text();
    const body = JSON.parse(text);
    ok(res.status === 502 && body.ok === false && body.error === 'api_unreachable', 'API Worker 抛错 → 502 JSON api_unreachable');
    ok(!text.includes('INTERNAL-DETAIL-xyz') && !text.includes('at '), '反向：502 响应里没有内部报错文本和调用栈');
  }

  // ---- 5. T37：/api/sumo、/api/sumo/* 交给 SUMO（hackathon-sumo），先于 /api/* → API ----
  {
    const ASSETS = fake('assets'), API = fake('api'), SUMO = fake('sumo');
    const env = { ASSETS, API, SUMO };
    const q = req('/api/sumo/v1/health');
    const res = await worker.fetch(q, env);
    ok(res.status === 200 && (await res.text()) === 'sumo:/api/sumo/v1/health' && res.headers.get('x-from') === 'sumo', '绑了 SUMO：/api/sumo/v1/health 的响应原样来自 SUMO Worker');
    ok(SUMO.seen[0] === q && API.seen.length === 0 && ASSETS.seen.length === 0, '反向：/api/sumo/v1/health 没交给 API、也没交给 ASSETS，SUMO 收到的是同一个请求');

    // POST 带 Origin / Cookie：site 不删头、不改路径，原样转（删头、白名单在 hackathon-sumo 里做）
    const p = req('/api/sumo/v1/runs?x=1', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, cookie: 'a=1' }, body: '{"seed":42}' });
    await worker.fetch(p, env);
    const got = SUMO.seen[1];
    ok(got === p && got.method === 'POST' && new URL(got.url).pathname === '/api/sumo/v1/runs' && new URL(got.url).search === '?x=1' && (await got.text()) === '{"seed":42}', 'POST /api/sumo/v1/runs：转发的是原请求，路径前缀 /api/sumo 不剥、查询串和请求体不变');

    const bare = await worker.fetch(req('/api/sumo'), env);
    ok((await bare.text()) === 'sumo:/api/sumo' && SUMO.seen.length === 3, '/api/sumo（不带斜杠）也交给 SUMO');

    for (const x of ['/api/sumoX', '/api/sumo-v1/health', '/api/sumo.json']) {
      const r = await worker.fetch(req(x), env);
      ok((await r.text()) === `api:${x}`, `反向：${x} 不是 /api/sumo/*，照常交给 API`);
    }
    ok(SUMO.seen.length === 3, '反向：上面三个 /api/sumoX 类路径一个都没进 SUMO');

    const h = await worker.fetch(req('/api/health'), env);
    const rd = await worker.fetch(req('/api/read', { method: 'POST', body: '{}' }), env);
    ok((await h.text()) === 'api:/api/health' && (await rd.text()) === 'api:/api/read', '绑了 SUMO 以后 /api/health、/api/read 仍交给 API（原来的转发不变）');
    const s = await worker.fetch(req('/api/public/js/reader.js'), env);
    const b = await worker.fetch(req('/sumo/public/baked/baked.json'), env);
    ok((await s.text()) === 'assets:/api/public/js/reader.js' && (await b.text()) === 'assets:/sumo/public/baked/baked.json' && SUMO.seen.length === 3,
      '/api/public/* 和预先跑好的 /sumo/public/baked/* 仍是静态文件，不进 SUMO');
  }

  // ---- 6. 没绑 SUMO（hackathon-sumo 没部署 / 绑定被删）：503 sumo_off，网页改用预先跑好的结果；不落到 API ----
  {
    const ASSETS = fake('assets'), API = fake('api');
    for (const [label, env] of [['绑了 API 没绑 SUMO', { ASSETS, API }], ['两个都没绑', { ASSETS }], ['SUMO 不是绑定', { ASSETS, API, SUMO: {} }]]) {
      const res = await worker.fetch(req('/api/sumo/v1/runs', { method: 'POST', body: '{}' }), env);
      const body = await res.json();
      ok(res.status === 503 && body.ok === false && body.error === 'sumo_off' && /预先跑好/.test(body.msg || '') && res.headers.get('cache-control') === 'no-store',
        `${label}：POST /api/sumo/v1/runs → 503 sumo_off，msg 让网页用预先跑好的结果（${body.msg}）`);
    }
    const h = await worker.fetch(req('/api/sumo/v1/health'), { ASSETS, API });
    ok(h.status === 503 && (await h.json()).error === 'sumo_off', '没绑 SUMO：/api/sumo/v1/health 也是 503 sumo_off（不会被 API 回成 404 之类的）');
    ok(API.seen.length === 0 && ASSETS.seen.length === 0, '反向：没绑 SUMO 时 /api/sumo/* 既没交给 API 也没交给 ASSETS');
  }

  // ---- 7. SUMO Worker 抛错：502 sumo_down，不把内部报错吐给浏览器 ----
  {
    const API = fake('api');
    const SUMO = { fetch: async () => { throw new Error('INTERNAL-SUMO-detail'); } };
    const origErr = console.error; console.error = () => {};
    const res = await worker.fetch(req('/api/sumo/v1/runs', { method: 'POST', body: '{}' }), { ASSETS: fake('assets'), API, SUMO });
    console.error = origErr;
    const text = await res.text();
    const body = JSON.parse(text);
    ok(res.status === 502 && body.ok === false && body.error === 'sumo_down' && /预先跑好/.test(body.msg || ''), 'SUMO Worker 抛错 → 502 JSON sumo_down，msg 让网页用预先跑好的结果');
    ok(!text.includes('INTERNAL-SUMO-detail') && !text.includes('at ') && noCors(res), '反向：502 响应里没有内部报错文本、调用栈和 CORS 头');
    ok(API.seen.length === 0, '反向：SUMO 抛错后没有退回去找 API');
  }
} catch (e) {
  F++;
  console.log('❌ 测试本身崩了：' + (e && e.stack));
}

console.log(`${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);
