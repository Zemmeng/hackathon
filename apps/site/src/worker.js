// site 的 Worker：一个网址挂全部模块。静态文件 = build.mjs 拷好的 out/（/<模块>/public/…），由 ASSETS 绑定托管；
// /api/sumo、/api/sumo/* 交给 hackathon-sumo（apps/sumo，现场 SUMO 容器，服务绑定 SUMO，T37）：原请求原样转，删头、白名单、限流都在那边做。
//   没绑 → 503 sumo_off，绑了但抛错 → 502 sumo_down；网页见到这两个就改用预先跑好的结果（/sumo/public/baked/）。必须排在下面 /api/* 之前
// /api/* 交给 T5 的 api Worker（服务绑定 API，D-0929-1436）。没绑时 /api/health 自报「api 还没接」，其余 /api/* 回 503。
// /api/public/* 是 apps/api/public/ 的静态文件（reader.js 等），不转发。
// 故意不加 CORS 头：网页、引擎、数据、接口都在同一个网址下（docs/contract.md）。
// ⚠️ 这个文件除了 default 不许有别的 export：workerd 把每个具名导出都当入口，导出一个字符串整个 Worker 起不来（实测）
const VERSION = 'site-0.1';

export default {
  async fetch(request, env = {}) {
    const path = new URL(request.url).pathname;
    // 只认 /api/sumo 和 /api/sumo/…；/api/sumoX 这种不算，照常交给 API
    const isSumo = path === '/api/sumo' || path.startsWith('/api/sumo/');
    const isApi = (path === '/api' || path.startsWith('/api/')) && !(path === '/api/public' || path.startsWith('/api/public/'));

    if (isSumo) {
      if (!env.SUMO || typeof env.SUMO.fetch !== 'function') {
        return fail(503, 'sumo_off', '现场 SUMO 服务没接上：请改用预先跑好的结果（/sumo/public/baked/）');
      }
      try {
        return await env.SUMO.fetch(request);
      } catch (e) {
        console.error('SUMO 服务绑定出错', path, e && e.stack);
        return fail(502, 'sumo_down', '现场 SUMO 服务没有响应：请改用预先跑好的结果（/sumo/public/baked/）');
      }
    }

    if (isApi) {
      if (env.API && typeof env.API.fetch === 'function') {
        try {
          return await env.API.fetch(request);
        } catch (e) {
          console.error('API 服务绑定出错', path, e && e.stack);
          return fail(502, 'api_unreachable', '接口 Worker 没有响应，稍后再试');
        }
      }
      if (path === '/api/health') return json({ ok: true, v: VERSION, mock: true, api: false });
      return fail(503, 'api_not_deployed', '接口还没接上：T5 的 api Worker 部署后，在 apps/site/wrangler.jsonc 打开 services 绑定再部署一次');
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return fail(500, 'no_assets', '没有 ASSETS 绑定（wrangler.jsonc 的 assets 配置丢了？）');
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// docs/contract.md §错误格式
const fail = (status, error, msg) => json({ ok: false, error, msg }, status);
