// 纯逻辑测试：public/js/shared/logic.js（房间码 / reduce / viewFor），不起服务、不碰网络
// 用法：node tests/logic.test.mjs
import { ok, eq, throws, sec, done } from "./mini.mjs";
import {
  CODE_ALPHABET, CODE_LEN, MAX_MEMBERS, MAX_ROUNDS, LOG_MAX, TEXT_MAX, NICK_MAX,
  RuleError, normCode, isRoomCode, randomCode, initState, reduce, viewFor, memberByToken, cleanText,
} from "../public/js/shared/logic.js";

const T = (i) => `token-${i}-xxxxxxxx`; // 令牌至少 8 位
const sum = (s) => s.members.reduce((a, m) => a + m.contrib, 0);

// 建一个有 n 个成员的房间，暗号分别是 S1…Sn（够特别，方便做「不许出现」的反向断言）
function roomWith(n) {
  let s = initState("ABCDE");
  for (let i = 1; i <= n; i++) s = reduce(s, { type: "join", token: T(i), nick: `人${i}`, secret: `S${i}-独有暗号` });
  return s;
}

await sec("房间码", () => {
  for (const c of "0O1IL") ok(!CODE_ALPHABET.includes(c), `字母表不含易混字符 ${c}`);
  ok(isRoomCode("ABCDE") && isRoomCode("23456"), "合法房间码");
  ok(!isRoomCode("ABCD") && !isRoomCode("ABCDEF"), "长度不对要拒绝");
  ok(!isRoomCode("ABCD0") && !isRoomCode("ABCDO") && !isRoomCode("ABCDI"), "含易混字符要拒绝");
  ok(!isRoomCode("abcde") && !isRoomCode(12345) && !isRoomCode(null), "小写 / 非字符串要拒绝");
  eq(normCode("  abcde "), "ABCDE", "normCode 去空白转大写");
  let allOk = true;
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const c = randomCode();
    seen.add(c);
    if (!isRoomCode(c) || c.length !== CODE_LEN) allOk = false;
  }
  ok(allOk, "randomCode 生成的 500 个码全部合法");
  ok(seen.size > 490, "randomCode 基本不重复");
});

await sec("加入", () => {
  const s0 = initState("ABCDE");
  eq([s0.v, s0.round, s0.counter, s0.members.length], [0, 0, 0, 0], "initState 初值");
  const s1 = reduce(s0, { type: "join", token: T(1), nick: "阿一" });
  eq([s1.v, s1.members[0].id, s1.members[0].nick, s1.members[0].online], [1, "m1", "阿一", true], "第一个成员是 m1，v=1");
  eq(s0.members.length, 0, "reduce 不改入参");
  const s2 = reduce(s1, { type: "join", token: T(1), nick: "改名了", secret: "新暗号" });
  eq([s2.members.length, s2.members[0].nick, s2.members[0].secret], [1, "改名了", ""], "同令牌重进：不新增成员、可改名、不换暗号");
  const s3 = reduce(s2, { type: "join", token: T(2) });
  eq(s3.members[1].nick, "成员2", "没填昵称给默认名");
  eq(cleanText("x".repeat(50), NICK_MAX).length, NICK_MAX, "昵称截断到 NICK_MAX");
  throws(() => reduce(s0, { type: "join", token: "short" }), /令牌/, "令牌太短要拒绝");
  const full = roomWith(MAX_MEMBERS);
  throws(() => reduce(full, { type: "join", token: T(99) }), /已满/, `第 ${MAX_MEMBERS + 1} 人要拒绝`);
  ok(memberByToken(full, T(3))?.id === "m3", "memberByToken 找得到人");
});

await sec("计数 / 消息 / 暗号", () => {
  let s = roomWith(2);
  const v0 = s.v;
  s = reduce(s, { type: "inc", by: "m1", n: 1 });
  s = reduce(s, { type: "inc", by: "m2", n: 1 });
  s = reduce(s, { type: "inc", by: "m1", n: -1 });
  eq([s.counter, s.members[0].contrib, s.members[1].contrib, s.round, s.v], [1, 0, 1, 3, v0 + 3], "counter / contrib / round / v 同步变化");
  ok(s.counter === sum(s), "守恒：counter === Σ contrib");
  throws(() => reduce(s, { type: "inc", by: "m1", n: 5 }), /n 只能/, "n 不是 ±1 要拒绝");
  throws(() => reduce(s, { type: "inc", by: "m1", n: "1" }), /n 只能/, "n 是字符串要拒绝");
  s = reduce(s, { type: "inc", by: "m2", n: -1 });
  throws(() => reduce(s, { type: "inc", by: "m2", n: -1 }), /小于 0/, "计数不能减到负数");
  throws(() => reduce(s, { type: "inc", by: "m9", n: 1 }), /先加入/, "不存在的成员要拒绝");
  throws(() => reduce(s, { type: "hack", by: "m1" }), /未知动作/, "未知动作要拒绝");
  throws(() => reduce(null, { type: "inc", by: "m1", n: 1 }), /不存在/, "房间已清要拒绝");
  ok((() => { try { reduce(s, { type: "hack" }); } catch (e) { return e instanceof RuleError; } })(), "规则拒绝抛的是 RuleError");

  throws(() => reduce(s, { type: "say", by: "m1", text: "  \n " }), /不能为空/, "空消息要拒绝");
  s = reduce(s, { type: "say", by: "m1", text: "\u0007你好" + "啊".repeat(300) });
  const last = s.log[s.log.length - 1];
  eq([last.by, last.kind, Array.from(last.text).length, last.text.startsWith("你好")], ["m1", "say", TEXT_MAX, true], "消息去控制字符并截断");
  s = reduce(s, { type: "secret", by: "m2", text: "只给我看" });
  eq(s.members[1].secret, "只给我看", "改自己的暗号");
});

await sec("上限", () => {
  let s = roomWith(1);
  for (let i = 0; i < LOG_MAX + 20; i++) s = reduce(s, { type: "say", by: "m1", text: `第${i}条` });
  eq(s.log.length, LOG_MAX, "消息流只留最近 LOG_MAX 条");
  ok(s.log.every((e, i) => i === 0 || e.n === s.log[i - 1].n + 1), "消息序号连续递增");

  let r = roomWith(1);
  for (let i = 0; i < MAX_ROUNDS; i++) r = reduce(r, { type: "inc", by: "m1", n: 1 });
  eq([r.round, r.counter], [MAX_ROUNDS, MAX_ROUNDS], `能做满 ${MAX_ROUNDS} 次动作`);
  throws(() => reduce(r, { type: "inc", by: "m1", n: 1 }), /上限/, "超过 MAX_ROUNDS 要拒绝");
  throws(() => reduce(r, { type: "say", by: "m1", text: "hi" }), /上限/, "封顶后发消息也拒绝");
});

await sec("视图裁剪", () => {
  let s = roomWith(3);
  s = reduce(s, { type: "presence", by: "m3", online: false });
  const v1 = viewFor(s, "m1");
  eq(v1.members.find((m) => m.id === "m1").secret, "S1-独有暗号", "自己的暗号在自己的视图里");
  ok(v1.members.filter((m) => m.id !== "m1").every((m) => !("secret" in m)), "别人的成员对象里没有 secret 键");
  const raw = JSON.stringify(v1);
  ok(!raw.includes("S2-独有暗号") && !raw.includes("S3-独有暗号"), "🔒 反向断言：别人的暗号不出现在我的视图任何位置");
  ok(![1, 2, 3].some((i) => raw.includes(T(i))), "🔒 反向断言：任何人的令牌都不出现在视图里（包括自己）");
  eq(Object.keys(v1.members[1]).sort(), ["contrib", "id", "nick", "online"], "别人只暴露白名单字段");
  eq([v1.me, v1.maxRounds, v1.members[2].online], ["m1", MAX_ROUNDS, false], "视图带 me / maxRounds / 在线状态");
  const vx = JSON.stringify(viewFor(s, "nobody"));
  ok(![1, 2, 3].some((i) => vx.includes(`S${i}-独有暗号`)), "不认识的 id 看不到任何人的暗号");
});

done();
