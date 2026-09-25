// Worker 薄路由：只做入口校验和分发，不放业务规则（规则在 public/js/shared/logic.js）
// GET /api/health 自检 · POST /api/create 生成房间码并在 DO 里 claim
// /ws?room=CODE 升级 WebSocket 交给该房间的 DO（src/room.js）· 其余交给静态资源 public/
import { Room } from "./room.js";
import { isRoomCode, normCode, randomCode } from "../public/js/shared/logic.js";

// wrangler 要求 DO 类从入口文件导出
export { Room };

// 部署时可用 --var VERSION:$(git rev-parse --short HEAD) 覆盖，线上一眼看出跑的是哪个提交
const VERSION = "0.1.0";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/health") {
      return json({ ok: true, v: env.VERSION || VERSION, mock: env.MOCK === "1" });
    }

    if (path === "/api/create") {
      if (request.method !== "POST") return json({ ok: false, error: "只接受 POST" }, 405);
      // 码空间 31^5 ≈ 2800 万，撞上活跃房间的概率极低；重试几次兜底，不无限循环
      for (let i = 0; i < 5; i++) {
        const code = randomCode();
        const res = await roomStub(env, code).fetch(`https://room/claim?code=${code}`, { method: "POST" });
        if (res.ok) return json({ ok: true, code });
      }
      return json({ ok: false, error: "房间码连续撞车，稍后再试" }, 503);
    }

    if (path === "/ws") {
      const code = normCode(url.searchParams.get("room"));
      // 先校验再转发：乱写的房间码不该为它唤醒（甚至新建）一个 DO 实例
      if (!isRoomCode(code)) return json({ ok: false, error: "房间码格式不对" }, 400);
      if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
        return json({ ok: false, error: "这里只接受 WebSocket" }, 426);
      }
      return roomStub(env, code).fetch(request);
    }

    // 未知 /api/* 明确回 404 JSON：不交给 ASSETS，免得前端把一页 HTML 当成接口响应
    if (path.startsWith("/api/")) return json({ ok: false, error: "没有这个接口" }, 404);

    return env.ASSETS.fetch(request);
  },
};

function roomStub(env, code) {
  return env.ROOM.get(env.ROOM.idFromName(code));
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    // 健康检查和建房结果都不能被缓存，否则会看到旧版本号 / 拿到别人的房间码
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
