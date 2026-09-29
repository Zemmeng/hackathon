// 用途：用假的 ASSETS / API 绑定测 src/worker.js —— 静态文件直通、/api/* 转发或 503、/api/health 自报、没有 CORS
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
} catch (e) {
  F++;
  console.log('❌ 测试本身崩了：' + (e && e.stack));
}

console.log(`${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);
