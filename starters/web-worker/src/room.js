// Room：一个房间一个 Durable Object 实例，持有权威状态
// 客户端只发动作；这里用 logic.js 的 reduce 校验并演进状态，按成员裁剪视图后逐个广播
// WebSocket Hibernation + 每次变更 commit() 落 storage：实例被回收、唤醒后不丢房
// 动作总数由 logic.js 的 MAX_ROUNDS 封顶（reduce 里拒绝），这样前端 mock 和这里是同一个上限
// 🔒 模块顶层不引用 WebSocketPair 等 Cloudflare 专有全局，Node 才能直接 import 这个类跑 tests/sim.mjs
import { initState, reduce, viewFor, memberByToken, randomCode, RuleError } from "../public/js/shared/logic.js";

// 闲置 6 小时清房：比赛一天内够用，也不会留一堆僵尸房间占 storage
const IDLE_MS = 6 * 60 * 60 * 1000;
// 单条消息上限：挡住误传的大对象和刷屏脚本，正常动作远小于这个数
const MAX_MSG_CHARS = 2048;
// 客户端能直接触发的动作白名单；join / presence 只能由服务端自己构造
const CLIENT_ACTIONS = new Set(["inc", "say", "secret"]);

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.s = null;
    // 被唤醒时先把状态读回来，期间运行时不会投递任何消息
    ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get("state")) ?? null;
    });
  }

  async commit() {
    await this.ctx.storage.put("state", this.s);
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
  }

  // 只有闲置满 IDLE_MS 才会走到这里（每次 commit 都会把闹钟往后推）
  // 有人挂着不动也照清：防止一个忘关的标签页让房间永远占着
  async alarm() {
    this.s = null;
    await this.ctx.storage.deleteAll();
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(1000, "room expired"); } catch {}
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/claim" && request.method === "POST") {
      if (this.s) return new Response("room exists", { status: 409 });
      this.s = initState(url.searchParams.get("code"));
      await this.commit();
      return new Response("ok");
    }

    if (url.pathname === "/ws") {
      const pair = new WebSocketPair();
      // acceptWebSocket（而不是 ws.accept）才能休眠：没人说话时不计费
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return new Response("not found", { status: 404 });
  }

  // ---------- WebSocket（Hibernation 回调）----------

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > MAX_MSG_CHARS) {
      return this.send(ws, { t: "err", msg: "消息太大或格式不对" });
    }
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try {
      await this.handle(ws, msg);
    } catch (e) {
      const expected = e instanceof RuleError;
      this.send(ws, { t: "err", msg: expected ? e.message : "服务器出错了" });
      if (!expected) console.error(e);
    }
  }

  async webSocketClose(ws) {
    // 旧兼容日期下运行时不会替我们回 close 帧，客户端会一直挂着；已关闭时 close 会抛，吞掉
    try { ws.close(1000, "bye"); } catch {}
    const id = ws.deserializeAttachment()?.id;
    if (!this.s || !id) return;
    // 同一成员可能开着多条连接（复制标签页会带上同一令牌），全断了才算离线
    const still = this.ctx.getWebSockets().some((w) => w !== ws && w.deserializeAttachment()?.id === id);
    if (still) return;
    try {
      this.s = reduce(this.s, { type: "presence", by: id, online: false });
    } catch (e) {
      if (e instanceof RuleError) return; // 成员已随房间一起被清掉
      throw e;
    }
    await this.commit();
    this.broadcast();
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  async handle(ws, msg) {
    if (!this.s) throw new RuleError("房间不存在或已过期");
    const t = msg?.t;

    if (t === "join") {
      const token = typeof msg.token === "string" ? msg.token : "";
      // 暗号由服务端生成，客户端传来的一律不认；老成员重连时 reduce 会沿用原暗号
      const next = reduce(this.s, { type: "join", token, nick: msg.nick, secret: "暗号-" + randomCode(6) });
      const me = memberByToken(next, token);
      // attachment 只存公开 id：休眠唤醒后靠它把连接对回成员，令牌不必再带着走
      ws.serializeAttachment({ id: me.id });
      this.s = next;
      await this.commit();
      this.send(ws, { t: "joined", code: this.s.code, me: me.id });
      this.broadcast();
      return;
    }

    const id = ws.deserializeAttachment()?.id;
    if (!id) throw new RuleError("请先加入房间");
    if (!CLIENT_ACTIONS.has(t)) throw new RuleError("未知动作");
    // 逐字段重建动作：by 只认连接上绑定的身份，客户端塞的 by / token / secret 字段全部丢弃
    const action = { type: t, by: id };
    if (t === "inc") action.n = msg.n;
    else action.text = msg.text;
    this.s = reduce(this.s, action);
    await this.commit();
    this.broadcast();
  }

  // ---------- 发送 ----------

  send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }

  // 🔒 每条连接单独算 viewFor：别人的 secret / 所有人的 token 不会出现在任何一条广播里
  broadcast() {
    if (!this.s) return;
    for (const ws of this.ctx.getWebSockets()) {
      const id = ws.deserializeAttachment()?.id;
      if (id) this.send(ws, { t: "state", s: viewFor(this.s, id) });
    }
  }
}
