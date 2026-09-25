// 前后端共用的规则：房间码、状态归约 reduce(state, action)、按成员裁剪 viewFor(state, memberId)
// DO（src/room.js）、浏览器 mock（public/js/app.js）、Node 测试三处 import 同一份，规则只写一遍
// 🔒 这里不碰 DOM / 网络 / storage / Date.now()：否则 Node 测试和本地 mock 就跑不起来
// 唯一的例外是 randomCode()：房间码必须不可猜，只能用 crypto

// 去掉 0/O/1/I/L：口头报房间码、手机上手输都不会认错
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LEN = 5;

export const MAX_MEMBERS = 8;
// 每房间可接受的成员动作总数上限：挡住挂机脚本 / 前端死循环把房间刷成无底洞
export const MAX_ROUNDS = 1000;
// 消息流只留最近这么多条：每次广播都带全量视图，太长会拖慢手机
export const LOG_MAX = 50;
export const NICK_MAX = 12;
export const TEXT_MAX = 120;
export const SECRET_MAX = 40;

// 规则拒绝（玩家能看懂的原因）和程序 bug 分开：前者原样回给客户端，后者只报「服务器出错了」
export class RuleError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "RuleError";
  }
}
const fail = (msg) => {
  throw new RuleError(msg);
};

// ---------- 房间码 ----------

export function normCode(s) {
  return String(s ?? "").trim().toUpperCase();
}

export function isRoomCode(s) {
  if (typeof s !== "string" || s.length !== CODE_LEN) return false;
  for (const c of s) if (!CODE_ALPHABET.includes(c)) return false;
  return true;
}

export function randomCode(len = CODE_LEN) {
  const n = CODE_ALPHABET.length;
  const limit = 256 - (256 % n); // 拒绝采样：直接取模会让前几个字母概率偏高
  let s = "";
  while (s.length < len) {
    const buf = new Uint8Array(len * 2);
    globalThis.crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit && s.length < len) s += CODE_ALPHABET[b % n];
    }
  }
  return s;
}

// ---------- 状态 ----------

export function initState(code) {
  return {
    code,
    v: 0, // 单调递增：每个成功的动作 +1，客户端丢弃 v 不更大的广播
    round: 0, // 已接受的成员动作数，到 MAX_ROUNDS 封顶
    memberSeq: 0,
    logSeq: 0,
    counter: 0, // 不变量：counter === 所有成员 contrib 之和
    members: [], // { id, token, nick, secret, contrib, online }；token 和 secret 是私有字段
    log: [], // { n, by, kind: "sys" | "say", text }
  };
}

// 服务端专用：按令牌找成员（返回的是含私有字段的原始对象，别直接下发）
export function memberByToken(state, token) {
  return state?.members.find((m) => m.token === token) ?? null;
}

// 纯函数：不改入参，返回新状态；不合法的动作抛 RuleError
export function reduce(state, action) {
  if (!state) fail("房间不存在或已过期");
  const a = action && typeof action === "object" ? action : {};
  const s = structuredClone(state);
  switch (a.type) {
    case "join":
      join(s, a);
      break;
    case "presence":
      memberOf(s, a.by).online = !!a.online;
      break;
    case "inc":
    case "say":
    case "secret": {
      const m = memberOf(s, a.by);
      if (s.round >= MAX_ROUNDS) fail(`本房间已到 ${MAX_ROUNDS} 次动作上限，请新建房间`);
      MEMBER_ACTIONS[a.type](s, m, a);
      s.round += 1;
      break;
    }
    default:
      fail("未知动作");
  }
  s.v += 1;
  return s;
}

const MEMBER_ACTIONS = {
  inc(s, m, a) {
    if (a.n !== 1 && a.n !== -1) fail("n 只能是 1 或 -1");
    if (s.counter + a.n < 0) fail("计数不能小于 0");
    s.counter += a.n;
    m.contrib += a.n;
  },
  say(s, m, a) {
    const text = cleanText(a.text, TEXT_MAX);
    if (!text) fail("消息不能为空");
    pushLog(s, m.id, "say", text);
  },
  secret(s, m, a) {
    const text = cleanText(a.text, SECRET_MAX);
    if (!text) fail("暗号不能为空");
    m.secret = text;
  },
};

function join(s, a) {
  const token = typeof a.token === "string" ? a.token : "";
  if (token.length < 8 || token.length > 64) fail("缺少身份令牌");
  const nick = cleanText(a.nick, NICK_MAX);
  const old = s.members.find((m) => m.token === token);
  if (old) {
    // 同一令牌再次加入 = 刷新或断线重连：沿用原来的 id、贡献和暗号
    old.online = true;
    if (nick) old.nick = nick;
    return;
  }
  if (s.members.length >= MAX_MEMBERS) fail(`房间已满（最多 ${MAX_MEMBERS} 人）`);
  s.memberSeq += 1;
  const m = {
    id: "m" + s.memberSeq,
    token,
    nick: nick || `成员${s.memberSeq}`,
    secret: cleanText(a.secret, SECRET_MAX),
    contrib: 0,
    online: true,
  };
  s.members.push(m);
  pushLog(s, m.id, "sys", `${m.nick} 加入了房间`);
}

function memberOf(s, id) {
  const m = s.members.find((x) => x.id === id);
  if (!m) fail("请先加入房间");
  return m;
}

function pushLog(s, by, kind, text) {
  s.logSeq += 1;
  s.log.push({ n: s.logSeq, by, kind, text });
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
}

// 去控制字符、去首尾空白、按字符（不是 UTF-16 单元）截断，免得把 emoji 切成半个
export function cleanText(x, max) {
  if (typeof x !== "string") return "";
  return Array.from(x.replace(/[\u0000-\u001f\u007f]/g, "").trim()).slice(0, max).join("").trim();
}

// ---------- 视图 ----------

// 🔒 按成员裁剪：用白名单逐字段拼新对象，而不是复制后删字段——以后给成员加私有字段默认不会漏出去
export function viewFor(state, memberId) {
  return {
    code: state.code,
    v: state.v,
    round: state.round,
    maxRounds: MAX_ROUNDS,
    counter: state.counter,
    me: memberId,
    members: state.members.map((m) => {
      const pub = { id: m.id, nick: m.nick, contrib: m.contrib, online: m.online };
      if (m.id === memberId) pub.secret = m.secret;
      return pub;
    }),
    log: state.log.map((e) => ({ n: e.n, by: e.by, kind: e.kind, text: e.text })),
  };
}
