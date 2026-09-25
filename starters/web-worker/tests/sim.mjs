// 无头模拟：用假 ctx（Map 当 storage、假闹钟、假 WebSocket）直接驱动 src/room.js 的 Room
// 3 个成员随机发动作（含非法动作），每一步检查不变量：v 单调、计数守恒、广播送达、存储一致、别人的 secret 不外泄
// 用法：node tests/sim.mjs [步数=300] [种子=42]
import { ok, eq, sec, done } from "./mini.mjs";
import { Room } from "../src/room.js";
import { MAX_ROUNDS, LOG_MAX } from "../public/js/shared/logic.js";

// 随机步数要给后面几节留出动作额度，所以不超过 MAX_ROUNDS 的一半
const STEPS = Math.min(Number(process.argv[2] ?? 300), MAX_ROUNDS / 2);
const SEED = Number(process.argv[3] ?? 42);
const CODE = "SIMRM";

// 固定种子的伪随机：失败时同一个种子能复现
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// ---------- 假 Durable Object 环境 ----------

function makeCtx() {
  const data = new Map();
  const sockets = [];
  const ctx = {
    data,
    sockets,
    alarmAt: null,
    ready: null,
    storage: {
      // structuredClone 模拟真实存储的序列化：内存对象和存进去的不共享引用
      async get(k) { return data.has(k) ? structuredClone(data.get(k)) : undefined; },
      async put(k, v) { data.set(k, structuredClone(v)); },
      async setAlarm(t) { ctx.alarmAt = t; },
      async deleteAlarm() { ctx.alarmAt = null; },
      async deleteAll() { data.clear(); },
    },
    blockConcurrencyWhile(fn) { ctx.ready = fn(); return ctx.ready; },
    acceptWebSocket(ws) { sockets.push(ws); },
    getWebSockets() { return sockets.filter((w) => !w.closed); },
  };
  return ctx;
}

function fakeWs(name) {
  return {
    name,
    att: null,
    sent: [],
    closed: false,
    send(s) { if (this.closed) throw new Error("socket closed"); this.sent.push(JSON.parse(s)); },
    serializeAttachment(a) { this.att = structuredClone(a); },
    deserializeAttachment() { return this.att == null ? null : structuredClone(this.att); },
    close() { this.closed = true; },
    last(t) { for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i].t === t) return this.sent[i]; return null; },
  };
}

async function newRoom(ctx) {
  const room = new Room(ctx, { MOCK: "1" });
  await ctx.ready;
  return room;
}

// 发一条消息，返回这一步里这条连接新收到的消息
async function say(room, ws, msg) {
  const before = ws.sent.length;
  await room.webSocketMessage(ws, typeof msg === "string" ? msg : JSON.stringify(msg));
  return ws.sent.slice(before);
}

async function connect(room, ctx, name, token) {
  const ws = fakeWs(name);
  ctx.acceptWebSocket(ws);
  const got = await say(room, ws, { t: "join", token, nick: name });
  return { ws, token, got };
}

// ---------- 不变量（违反就抛，所在分节记 1 个失败并带上步数）----------

function inv(cond, msg) {
  if (!cond) throw new Error("不变量被破坏：" + msg);
}

function checkInvariants(room, ctx, people, where) {
  const s = room.s;
  inv(s.counter === s.members.reduce((a, m) => a + m.contrib, 0), `${where} 计数守恒 counter === Σ contrib`);
  inv(s.counter >= 0, `${where} counter >= 0`);
  inv(s.round <= MAX_ROUNDS, `${where} round <= MAX_ROUNDS`);
  inv(s.log.length <= LOG_MAX, `${where} 消息流不超过 LOG_MAX`);
  inv(JSON.stringify(ctx.data.get("state")) === JSON.stringify(s), `${where} storage 与内存状态一致（每次变更都 commit 了）`);
  inv(ctx.alarmAt !== null, `${where} 设置了闲置清房闹钟`);
  for (const p of people) {
    if (p.ws.closed) continue;
    const view = p.ws.last("state")?.s;
    inv(view && view.v === s.v, `${where} ${p.ws.name} 收到的是最新版本（${view?.v} vs ${s.v}）`);
    const me = s.members.find((m) => m.token === p.token);
    inv(view.me === me.id, `${where} ${p.ws.name} 的视图属于自己`);
    inv(view.members.find((m) => m.id === me.id).secret === me.secret, `${where} ${p.ws.name} 能看到自己的暗号`);
    // 🔒 反向断言：别人的 secret、所有人的 token 在我的视图里连子串都不许出现
    const raw = JSON.stringify(view);
    for (const other of s.members) {
      if (other.id !== me.id) inv(!raw.includes(other.secret), `${where} ${p.ws.name} 的视图里漏出了 ${other.id} 的暗号`);
      inv(!raw.includes(other.token), `${where} ${p.ws.name} 的视图里漏出了 ${other.id} 的令牌`);
    }
    // 每条连接收到的 state 版本严格递增：客户端才能放心丢弃旧广播
    const vs = p.ws.sent.filter((m) => m.t === "state").map((m) => m.s.v);
    inv(vs.every((v, i) => i === 0 || v > vs[i - 1]), `${where} ${p.ws.name} 收到的 v 严格递增`);
  }
}

// ---------- 场景 ----------

const ctx = makeCtx();
let room = await newRoom(ctx);
const people = [];

await sec("建房 claim", async () => {
  const r1 = await room.fetch(new Request(`https://room/claim?code=${CODE}`, { method: "POST" }));
  eq(r1.status, 200, "第一次 claim 成功");
  const r2 = await room.fetch(new Request(`https://room/claim?code=${CODE}`, { method: "POST" }));
  eq(r2.status, 409, "同一个房间再 claim 返回 409（worker 会换码重试）");
  eq(ctx.data.get("state")?.code, CODE, "claim 后状态已落 storage");
});

await sec("3 人加入", async () => {
  for (const name of ["甲", "乙", "丙"]) people.push(await connect(room, ctx, name, `tok-${name}-${SEED}-abcdef`));
  eq(people.map((p) => p.got.find((m) => m.t === "joined")?.me), ["m1", "m2", "m3"], "三人依次拿到 m1 / m2 / m3");
  eq(room.s.members.length, 3, "服务端有 3 个成员");
  ok(room.s.members.every((m) => /^暗号-/.test(m.secret)), "暗号由服务端生成");
  ok(new Set(room.s.members.map((m) => m.secret)).size === 3, "三人暗号互不相同");
  checkInvariants(room, ctx, people, "加入后");
  ok(true, "加入后不变量成立");
});

await sec(`随机 ${STEPS} 步（种子 ${SEED}）`, async () => {
  let accepted = 0;
  let rejected = 0;
  for (let step = 1; step <= STEPS; step++) {
    const p = pick(people);
    const r = rand();
    // 大多是正常动作，混一些非法动作：服务端必须拒绝且状态不动
    const msg =
      r < 0.45 ? { t: "inc", n: pick([1, 1, -1]) } :
      r < 0.65 ? { t: "say", text: `第${step}步 ${p.ws.name} 说话` } :
      r < 0.75 ? { t: "secret", text: `新暗号-${p.ws.name}-${step}` } :
      r < 0.80 ? { t: "inc", n: pick([2, "1", null, -5]) } :
      r < 0.85 ? { t: "say", text: "   " } :
      r < 0.90 ? { t: "presence", online: false } :
      r < 0.95 ? { t: "inc", n: 1, by: "m1", token: "伪造" } :
                 { t: "hack" };
    const vBefore = room.s.v;
    const contribBefore = room.s.members.map((m) => m.contrib);
    const got = await say(room, p.ws, msg);
    const err = got.find((m) => m.t === "err");
    if (err) {
      rejected++;
      inv(room.s.v === vBefore, `第${step}步 被拒绝的动作不许改 v`);
    } else {
      accepted++;
      inv(room.s.v === vBefore + 1, `第${step}步 成功的动作 v 恰好 +1`);
    }
    // 动作只记在发送者身上：消息里伪造的 by / token 不起作用
    const expected = contribBefore.map((c, i) =>
      !err && msg.t === "inc" && room.s.members[i].token === p.token ? c + msg.n : c);
    inv(JSON.stringify(room.s.members.map((m) => m.contrib)) === JSON.stringify(expected), `第${step}步 分数只记在发送者身上`);
    checkInvariants(room, ctx, people, `第${step}步`);
  }
  ok(accepted > STEPS / 2 && rejected > 0, `既有接受（${accepted}）也有拒绝（${rejected}）`);
  ok(true, `${STEPS} 步不变量全部成立`);
});

await sec("伪造身份", async () => {
  const [a, b] = people;
  const bBefore = room.s.members.find((m) => m.token === b.token).contrib;
  const aBefore = room.s.members.find((m) => m.token === a.token).contrib;
  await say(room, a.ws, { t: "inc", n: 1, by: "m2" });
  eq(room.s.members.find((m) => m.token === b.token).contrib, bBefore, "消息里塞 by=m2 不能替乙加分");
  eq(room.s.members.find((m) => m.token === a.token).contrib, aBefore + 1, "分数记在连接绑定的甲身上");
  const got = await say(room, a.ws, { t: "presence", online: false, by: "m2" });
  ok(got.some((m) => m.t === "err"), "客户端不能直接发 presence");
});

await sec("休眠唤醒", async () => {
  const snapshot = JSON.stringify(room.s);
  room = await newRoom(ctx); // 同一个 ctx：storage 和连接（含 attachment）都还在，内存状态丢了
  eq(JSON.stringify(room.s), snapshot, "新实例从 storage 读回同一份状态");
  const v = room.s.v;
  await say(room, people[1].ws, { t: "inc", n: 1 });
  eq(room.s.v, v + 1, "唤醒后动作照常生效");
  ok(people.every((p) => p.ws.last("state").s.v === v + 1), "唤醒后靠 attachment 把广播发给了全部 3 人");
  checkInvariants(room, ctx, people, "唤醒后");
  ok(true, "唤醒后不变量成立");
});

await sec("断线与重连", async () => {
  const c = people[2];
  const id = c.ws.deserializeAttachment().id;
  const secret = room.s.members.find((m) => m.id === id).secret;
  c.ws.close();
  await room.webSocketClose(c.ws, 1001, "gone", true);
  eq(people[0].ws.last("state").s.members.find((m) => m.id === id).online, false, "别人看到丙离线");
  const again = await connect(room, ctx, "丙", c.token);
  people[2] = again;
  eq(again.got.find((m) => m.t === "joined")?.me, id, "同令牌重连拿回原 id");
  eq(room.s.members.find((m) => m.id === id).secret, secret, "重连不换暗号");
  eq([room.s.members.length, people[0].ws.last("state").s.members.find((m) => m.id === id).online], [3, true], "不新增成员，重新在线");
  checkInvariants(room, ctx, people, "重连后");
  ok(true, "重连后不变量成立");
});

await sec("坏输入", async () => {
  const stranger = fakeWs("路人");
  ctx.acceptWebSocket(stranger);
  const g1 = await say(room, stranger, { t: "inc", n: 1 });
  ok(g1.some((m) => m.t === "err" && /先加入/.test(m.msg)), "没 join 就发动作要拒绝");
  const g2 = await say(room, stranger, "这不是 JSON");
  eq(g2.length, 0, "非 JSON 静默丢弃，不崩");
  const g3 = await say(room, stranger, JSON.stringify({ t: "say", text: "x".repeat(5000) }));
  ok(g3.some((m) => m.t === "err"), "超大消息要拒绝");
  const g4 = await say(room, stranger, { t: "join", token: "short" });
  ok(g4.some((m) => m.t === "err"), "令牌太短不让进");
  stranger.close();
  checkInvariants(room, ctx, people, "坏输入后");
  ok(true, "坏输入后不变量成立");
});

await sec("MAX_ROUNDS 封顶", async () => {
  const p = people[0];
  let guard = 0;
  // 一直加到被拒绝；guard 防止上限失效时这里自己变成死循环
  while (room.s.round < MAX_ROUNDS && guard++ < MAX_ROUNDS + 10) await say(room, p.ws, { t: "inc", n: 1 });
  eq(room.s.round, MAX_ROUNDS, `round 停在 MAX_ROUNDS=${MAX_ROUNDS}`);
  const v = room.s.v;
  const got = await say(room, p.ws, { t: "inc", n: 1 });
  ok(got.some((m) => m.t === "err" && /上限/.test(m.msg)), "封顶后再动作收到「上限」错误");
  eq(room.s.v, v, "封顶后被拒绝的动作不改 v");
  checkInvariants(room, ctx, people, "封顶后");
  ok(true, "封顶后不变量成立");
});

await sec("闲置清房 alarm", async () => {
  await room.alarm();
  eq(ctx.data.size, 0, "storage 被清空");
  ok(people.every((p) => p.ws.closed), "所有连接被关闭");
  const ws = fakeWs("迟到的人");
  ctx.acceptWebSocket(ws);
  const got = await say(room, ws, { t: "join", token: "tok-late-abcdefgh" });
  ok(got.some((m) => m.t === "err" && /不存在|过期/.test(m.msg)), "清房后加入收到「不存在或已过期」");
  const r = await room.fetch(new Request(`https://room/claim?code=${CODE}`, { method: "POST" }));
  eq(r.status, 200, "清房后同一个码可以重新 claim");
});

done();
