// 前端主逻辑：ui 状态 → render()；服务端权威，这里只负责展示和发动作
// 两种模式：online（/api/health 通 → WebSocket 连房间 DO）/ mock（/api 不通，比如纯静态托管 → logic.js 的 reduce 在本页跑）
// 🔒 render() 带签名守卫：签名没变就不重建那块 DOM，免得把用户正要点的按钮、正在输入的框换掉
// 🔒 动效只由新旧 state 对比驱动（见 fx），不解析消息文本
import {
  initState, reduce, viewFor, memberByToken, isRoomCode, normCode, randomCode, RuleError,
} from "./shared/logic.js";

const $ = (id) => document.getElementById(id);

// 每个标签页一个身份令牌：刷新后还是同一个成员；同一浏览器开两个标签页就是两个成员，方便单人调试
const token = (() => {
  try {
    let t = sessionStorage.getItem("room-token");
    if (!t) {
      t = makeToken();
      sessionStorage.setItem("room-token", t);
    }
    return t;
  } catch {
    return makeToken(); // 隐私模式禁用 storage 时退化成每次刷新换人
  }
})();

// 不用 crypto.randomUUID：它只在安全上下文（https 或本机回环）可用，手机连局域网 IP 调试时会是 undefined
function makeToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

const ui = {
  mode: "probe", // probe | online | mock
  health: null, // /api/health 的响应
  screen: "home", // home | room
  code: null,
  conn: "idle", // idle | connecting | open | retry | local
  busy: false, // 建房请求进行中
  err: "", // 首页错误提示
  view: null, // 当前成员视角的状态：服务端下发，或 mock 下本地 viewFor 算出
};

// ---------- 渲染 ----------

const sigs = new Map();
function patch(key, sig, draw) {
  if (sigs.get(key) === sig) return;
  sigs.set(key, sig);
  draw();
}

// 所有用户输入都走 textContent，不拼 innerHTML：昵称和消息里带 <script> 也只是文字
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== "" && v != null) el.setAttribute(k, v);
  el.append(...kids);
  return el;
}

function render() {
  patch("health", `${ui.mode}|${ui.health?.v}|${ui.health?.mock}`, () => {
    const pill = $("health");
    pill.className = "pill " + (ui.mode === "online" ? "ok" : ui.mode === "mock" ? "bad" : "");
    pill.textContent =
      ui.mode === "online" ? `后端 v${ui.health.v}` : ui.mode === "mock" ? "后端不通 · 本地演示" : "检测中…";
    const badge = $("mock-badge");
    badge.hidden = !(ui.mode === "mock" || ui.health?.mock);
    badge.title = ui.mode === "mock"
      ? "后端不可用：规则在本页用 logic.js 跑，只有你自己看得到"
      : "后端开着 MOCK=1：外部 API 用假数据";
  });

  patch("screen", ui.screen, () => {
    $("home").hidden = ui.screen !== "home";
    $("room").hidden = ui.screen !== "room";
  });

  patch("home", `${ui.err}|${ui.busy}|${ui.conn}|${ui.mode}`, () => {
    $("home-err").textContent = ui.err;
    const waiting = ui.busy || ui.conn === "connecting" || ui.mode === "probe";
    $("btn-create").disabled = waiting;
    $("btn-join").disabled = waiting;
    $("btn-create").textContent = ui.conn === "connecting" ? "连接中…" : "创建房间";
  });

  const v = ui.view;
  if (ui.screen !== "room" || !v) return;
  const me = v.members.find((m) => m.id === v.me);
  const live = ui.conn === "open" || ui.conn === "local";
  const capped = v.round >= v.maxRounds;

  patch("head", `${v.code}|${ui.conn}`, () => {
    $("room-code").textContent = v.code;
    const conn = $("conn");
    conn.textContent = { open: "已连接", connecting: "连接中…", retry: "断线重连中…", local: "本地 MOCK" }[ui.conn] ?? "";
    conn.className = "pill " + (live ? "ok" : "bad");
  });

  patch("counter", `${v.counter}|${v.round}|${v.maxRounds}`, () => {
    $("counter-num").textContent = v.counter;
    $("rounds").textContent = capped
      ? `已到 ${v.maxRounds} 次动作上限，请新建房间`
      : `已用 ${v.round} / ${v.maxRounds} 次动作`;
  });

  patch("controls", `${live}|${capped}|${v.counter === 0}`, () => {
    $("btn-inc").disabled = !live || capped;
    $("btn-dec").disabled = !live || capped || v.counter === 0;
    for (const f of ["say-form", "secret-form"]) {
      for (const el of $(f).elements) el.disabled = !live || capped;
    }
  });

  patch("secret", me?.secret ?? "", () => {
    $("my-secret").textContent = me?.secret || "—";
  });

  patch("members", JSON.stringify([v.me, v.members]), () => {
    $("members").replaceChildren(...v.members.map((m) => h("li",
      { "data-id": m.id, class: [m.online ? "online" : "", m.id === v.me ? "me" : ""].join(" ").trim() },
      h("span", { class: "dot" }),
      h("span", { class: "nick" }, m.nick),
      h("span", { class: "contrib" }, (m.contrib > 0 ? "+" : "") + m.contrib),
    )));
  });

  patch("log", JSON.stringify([v.log.at(-1)?.n, v.log.length, v.members.map((m) => m.nick)]), () => {
    const nick = new Map(v.members.map((m) => [m.id, m.nick]));
    $("log").replaceChildren(...v.log.map((e) => {
      const li = h("li", { "data-n": e.n, class: e.kind });
      if (e.kind === "say") li.append(h("span", { class: "who" }, nick.get(e.by) ?? "?"));
      li.append(e.text);
      return li;
    }));
  });
}

// ---------- 动效：只看新旧 state 的差 ----------

function restart(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth; // 强制回流，同一个 class 才能再播一次
  el.classList.add(cls);
}

function fx(prev, next) {
  if (!prev || prev.code !== next.code) return; // 刚进房时整屏都是「新」的，不放动效
  const d = next.counter - prev.counter;
  if (d) {
    const box = $("counter");
    restart(box, d > 0 ? "bump-up" : "bump-down");
    const float = h("span", { class: "float " + (d > 0 ? "up" : "down") }, (d > 0 ? "+" : "") + d);
    float.addEventListener("animationend", () => float.remove());
    box.append(float);
  }
  const old = new Map(prev.members.map((m) => [m.id, m]));
  for (const m of next.members) {
    const li = $("members").querySelector(`[data-id="${m.id}"]`);
    if (!li) continue;
    if (!old.has(m.id)) restart(li, "fresh");
    else if (old.get(m.id).contrib !== m.contrib) restart(li, "flash");
  }
  const lastN = prev.log.at(-1)?.n ?? 0;
  if ((next.log.at(-1)?.n ?? 0) > lastN) {
    for (const li of $("log").children) if (Number(li.dataset.n) > lastN) restart(li, "fresh");
    $("log").scrollTop = $("log").scrollHeight;
  }
}

function applyView(next) {
  const prev = ui.view;
  // 同一房间里 v 不比手上的新就丢掉：乱序到达的旧广播不能把界面倒回去
  if (prev && prev.code === next.code && next.v <= prev.v) return;
  ui.view = next;
  render();
  fx(prev, next);
}

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- online：WebSocket 连房间 DO ----------

let ws = null;
let joined = false;
let leaving = false;
let retryMs = 1000;
let retryTimer = null;

function connect(code) {
  clearTimeout(retryTimer);
  leaving = false;
  joined = false;
  ui.code = code;
  ui.conn = "connecting";
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const sock = new WebSocket(`${proto}://${location.host}/ws?room=${code}`);
  ws = sock;
  sock.onopen = () => sock.send(JSON.stringify({ t: "join", token, nick: nickVal() }));
  // 只处理当前这条连接的事件：重连后旧连接迟到的消息 / close 一律忽略
  sock.onmessage = (ev) => { if (sock === ws) onMsg(JSON.parse(ev.data)); };
  sock.onclose = () => {
    if (sock !== ws || leaving) return;
    if (ui.screen !== "room") return leave("连不上房间，稍后再试");
    ui.conn = "retry";
    render();
    retryTimer = setTimeout(() => connect(ui.code), retryMs);
    retryMs = Math.min(retryMs * 2, 8000);
  };
  render();
}

function onMsg(m) {
  if (m.t === "joined") {
    joined = true;
    retryMs = 1000;
    ui.screen = "room";
    ui.conn = "open";
    ui.code = m.code;
    ui.err = "";
    history.replaceState(null, "", "?room=" + m.code);
    render();
  } else if (m.t === "state") {
    applyView(m.s);
  } else if (m.t === "err") {
    // 加入就被拒（房间不存在 / 已满 / 已过期）→ 回首页；已在房间里 → 只提示，状态不动
    if (!joined) leave(m.msg);
    else toast(m.msg);
  }
}

// ---------- mock：后端不通时，logic.js 在本页跑同一套规则 ----------

const mock = { state: null, me: null };
// 本地假队友：mock 下也能看到成员列表，也能验证「别人的暗号看不到」
const MOCK_PEER = "mock-peer-token";

function mockEnter(code) {
  let s = initState(code);
  s = reduce(s, { type: "join", token, nick: nickVal(), secret: "暗号-" + randomCode(6) });
  s = reduce(s, { type: "join", token: MOCK_PEER, nick: "假队友", secret: "暗号-" + randomCode(6) });
  s = reduce(s, { type: "say", by: memberByToken(s, MOCK_PEER).id, text: "后端没连上：这是只在你浏览器里的 MOCK 房间" });
  mock.state = s;
  mock.me = memberByToken(s, token).id;
  Object.assign(ui, { screen: "room", code, conn: "local", err: "" });
  history.replaceState(null, "", "?room=" + code);
  applyView(viewFor(s, mock.me));
}

function mockAct(msg) {
  try {
    mock.state = reduce(mock.state, { type: msg.t, by: mock.me, n: msg.n, text: msg.text });
  } catch (e) {
    if (e instanceof RuleError) return toast(e.message);
    throw e;
  }
  applyView(viewFor(mock.state, mock.me));
}

// ---------- 用户动作 ----------

function act(msg) {
  if (ui.mode === "mock") return mockAct(msg);
  if (ws?.readyState !== WebSocket.OPEN || !joined) return toast("还没连上，稍等一下");
  ws.send(JSON.stringify(msg));
}

async function createRoom() {
  if (ui.mode === "mock") return mockEnter(randomCode());
  ui.busy = true;
  ui.err = "";
  render();
  try {
    const r = await fetch("/api/create", { method: "POST" });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    connect(j.code);
  } catch (e) {
    ui.err = "建房失败：" + e.message;
  }
  ui.busy = false;
  render();
}

function joinRoom(raw) {
  const code = normCode(raw);
  if (!isRoomCode(code)) {
    ui.err = "房间码是 5 位字母或数字（没有 0 O 1 I L）";
    return render();
  }
  ui.err = "";
  if (ui.mode === "mock") mockEnter(code);
  else connect(code);
}

function leave(errMsg = "") {
  leaving = true;
  clearTimeout(retryTimer);
  try { ws?.close(); } catch {}
  ws = null;
  joined = false;
  mock.state = null;
  Object.assign(ui, { screen: "home", code: null, conn: "idle", view: null, err: errMsg });
  history.replaceState(null, "", location.pathname);
  render();
}

function nickVal() {
  return $("nick").value.trim().slice(0, 12);
}

// ---------- 启动 ----------

async function probe() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    const r = await fetch("/api/health", { cache: "no-store", signal: ctl.signal });
    clearTimeout(timer);
    // 纯静态托管会回 404 页面（HTML），json() 直接抛，同样走 mock
    const j = r.ok ? await r.json() : null;
    if (j?.ok !== true) throw new Error("health 不 ok");
    ui.health = j;
    ui.mode = "online";
  } catch {
    ui.health = null;
    ui.mode = "mock";
  }
  render();
  const code = normCode(new URLSearchParams(location.search).get("room"));
  if (isRoomCode(code)) joinRoom(code);
}

function bind() {
  try { $("nick").value = localStorage.getItem("room-nick") ?? ""; } catch {}
  $("nick").addEventListener("change", () => {
    try { localStorage.setItem("room-nick", nickVal()); } catch {}
  });
  $("btn-create").onclick = createRoom;
  $("btn-join").onclick = () => joinRoom($("join-code").value);
  $("join-code").addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom($("join-code").value); });
  $("btn-inc").onclick = () => act({ t: "inc", n: 1 });
  $("btn-dec").onclick = () => act({ t: "inc", n: -1 });
  $("say-form").onsubmit = (e) => {
    e.preventDefault();
    const text = $("say-input").value.trim();
    if (!text) return;
    act({ t: "say", text });
    $("say-input").value = "";
  };
  $("secret-form").onsubmit = (e) => {
    e.preventDefault();
    const text = $("secret-input").value.trim();
    if (!text) return;
    act({ t: "secret", text });
    $("secret-input").value = "";
  };
  $("btn-leave").onclick = () => leave();
  $("btn-copy").onclick = async () => {
    const url = `${location.origin}${location.pathname}?room=${ui.code}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("已复制：" + url);
    } catch {
      prompt("复制这个链接发给队友", url); // 非 https 下没有 clipboard API
    }
  };
}

bind();
render();
probe();
