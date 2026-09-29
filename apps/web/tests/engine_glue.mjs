// 页面接线层的纯函数（src/js/6-engine.js 里 /* pure:begin */…/* pure:end */ 那一段）+ 用它拼的方案在真路网上跑引擎。
// 由 tests/test_engine.py 调：node tests/engine_glue.mjs；每条断言打一行 ✅ / ❌，不联网
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const WEB = HERE + '../';
const APPS = WEB + '../';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('✅ ' + msg); } else { fail++; console.log('❌ ' + msg); } };

const src = readFileSync(WEB + 'src/js/6-engine.js', 'utf8');
const m = src.match(/\/\* pure:begin[^\n]*\n([\s\S]*?)\/\* pure:end \*\//);
ok(!!m, '6-engine.js 有 pure:begin / pure:end 段');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(m[1] + '\n;globalThis.G={geoToWorld,dirOf,pickLink,parseFrame,planFrom,linkPts,NO_WORKS,WORKS_TIME};', ctx);
const { geoToWorld, dirOf, pickLink, parseFrame, planFrom, linkPts, NO_WORKS } = ctx.G;

const net = JSON.parse(readFileSync(APPS + 'roads/public/cbd/network.json', 'utf8'));
const nodes = new Map(net.nodes.map(n => [n.id, n]));
const namesAt = new Map();
for (const l of net.links) for (const n of [l.from, l.to]) { if (!namesAt.has(n)) namesAt.set(n, new Set()); namesAt.get(n).add(l.name); }
const corner = (a, b) => { const ps = [...namesAt].filter(([, s]) => s.has(a) && s.has(b)).map(([id]) => nodes.get(id)); if (!ps.length) return null; return geoToWorld(ps.reduce((s, p) => s + p.lat, 0) / ps.length, ps.reduce((s, p) => s + p.lon, 0) / ps.length); };
const near = (p, x, y, tol) => p && Math.hypot(p[0] - x, p[1] - y) <= tol;

// 1 真路网坐标 → 页面世界坐标（页面画的是理想化的 Hoddle 方格：Swanston x=0、Russell 200、Elizabeth −200；La Trobe y=0、Lonsdale −200）
const c1 = corner('Swanston Street', 'La Trobe Street'), c2 = corner('Russell Street', 'Lonsdale Street'), c3 = corner('Elizabeth Street', 'Lonsdale Street');
// A'Beckett 在 Swanston 那头斜着接进来（真实几何），往西那段是直的：页面把它画在 y=200
const ab = net.links.filter(l => l.name === "A'Beckett Street").flatMap(l => linkPts(l) || []).filter(p => p[0] < -60 && p[0] > -320);
ok(near(c1, 0, 0, 3), `Swanston × La Trobe → (${c1?.map(v => v.toFixed(1))}) ≈ (0, 0)`);
ok(near(c2, 200, -200, 3), `Russell × Lonsdale → (${c2?.map(v => v.toFixed(1))}) ≈ (200, −200)`);
ok(near(c3, -200, -200, 3), `Elizabeth × Lonsdale → (${c3?.map(v => v.toFixed(1))}) ≈ (−200, −200)`);
ok(ab.length >= 4 && ab.every(p => Math.abs(p[1] - 200) < 8), `A'Beckett（Swanston 以西的直段，${ab.length} 个点）落在页面的 y=200 ± 8`);

// 2 选路段：靠左行驶，点在街的哪一侧就选哪个方向
const cands = net.links.map(l => ({ id: l.id, pts: linkPts(l), hw: l.highway })).filter(c => c.pts);
const byId = new Map(net.links.map(l => [l.id, l]));
// Lonsdale 在 OSM 里是双幅路：西行一条线（y≈−206）、东行一条线（y≈−195.5）
const south = pickLink(cands, 118, -209, 12), north = pickLink(cands, 118, -193, 12);
ok(south && byId.get(south).name === 'Lonsdale Street' && dirOf(linkPts(byId.get(south))) === 'W', `点 Lonsdale St 南侧 → 西行路段（${south}）`);
ok(north && byId.get(north).name === 'Lonsdale Street' && dirOf(linkPts(byId.get(north))) === 'E', `点 Lonsdale St 北侧 → 东行路段（${north}）`);
// 单线双向的街（两个方向的路段几何重合）：靠左行驶，点在行进方向左边的那一侧就选那个方向
const twin = net.links.find(l => { const r = net.links.find(x => x.from === l.to && x.to === l.from); const p = linkPts(l); return r && p && p.length === 2 && !NO_WORKS.has(l.highway) && Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) > 40 && p.every(q => Math.abs(q[0]) < 300 && Math.abs(q[1]) < 280); });
if (twin) {
  const p = linkPts(twin), mx = (p[0][0] + p[1][0]) / 2, my = (p[0][1] + p[1][1]) / 2, dx = p[1][0] - p[0][0], dy = p[1][1] - p[0][1], l = Math.hypot(dx, dy);
  const left = pickLink(cands, mx - dy / l * 4, my + dx / l * 4, 12), right = pickLink(cands, mx + dy / l * 4, my - dx / l * 4, 12);
  ok(left === twin.id && right !== twin.id && byId.get(right)?.from === twin.to, `单线双向的 ${twin.name}：点行进方向左侧 → 这个方向，右侧 → 反方向`);
} else ok(false, '找不到单线双向的路段来测靠左行驶');
ok(pickLink(cands, 100, -150, 12) === null, '点在街区中间（离路 > 12 m）→ 不选');
const lane = net.links.find(l => NO_WORKS.has(l.highway) && l.geometry?.length >= 2);
if (lane) { const p = linkPts(lane), mid = [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2]; const got = pickLink(cands.filter(c => c.id === lane.id), mid[0], mid[1], 12); ok(got === null, `小巷 / 人行道（${lane.highway}）不能当施工路段`); }

// 3 拼方案（docs/contract.md §施工方案）
const EP = { link: 'l595594354_9756035316', street: 'Lonsdale Street', lanes: 1, hour: 8, f1: ' roadwork \n\n ahead ', f2: '', vmsAt: 300, sign: 'right lane  closed', signAt: 100, arrowAt: 60 };
const before = JSON.stringify(EP);
const plan = planFrom(EP), ws = plan.worksites[0], vms = ws.equipment.find(e => e.type === 'vms');
ok(JSON.stringify(EP) === before, 'planFrom 不改页面状态');
ok(JSON.stringify(vms.frames) === '[["ROADWORK","AHEAD"]]' && vms.at_m === 300, '屏上文字：转大写、去空行和多余空格，空的第 2 帧不发');
ok(ws.equipment.find(e => e.type === 'sign').text === 'RIGHT LANE CLOSED' && ws.equipment.some(e => e.type === 'arrow') && ws.equipment.some(e => e.type === 'barrier'), '标志牌转大写；箭头板、护栏都在');
ok(ws.links[0] === EP.link && ws.closes.lanes === 1 && plan.when.hour === 8 && /^\d{4}-\d\d-\d\d$/.test(ws.time.from) && ws.time.hours.length === 2, '路段、封几条道、时段、日期都按契约');
ok(!planFrom({ ...EP, f1: '  \n ', f2: '' }).worksites[0].equipment.some(e => e.type === 'vms') && !planFrom({ ...EP, sign: ' ' }).worksites[0].equipment.some(e => e.type === 'sign'), '反向断言：VMS / 标志牌写空了就不放，不发空字');
ok(JSON.stringify(parseFrame('use\nrussell   st\n\n')) === '["USE","RUSSELL ST"]', 'parseFrame：一行一句');

// 4 页面拼的方案交给真的 backend.js（真路网 + T12 参数 + T5 读屏，不联网）
const file = p => APPS + p.replace(/^\//, '');
const fakeFetch = async url => (existsSync(file(url)) ? { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file(url), 'utf8')) } : { ok: false, status: 404 });
const importer = async url => { if (!existsSync(file(url))) throw new Error('404 ' + url); return import(pathToFileURL(file(url)).href); };
const { connect } = await import(pathToFileURL(APPS + 'engine/public/js/backend.js').href);
const be = await connect({ fetch: fakeFetch, importer });
const s0 = await be.run(planFrom(EP));
ok(s0.street === 'Lonsdale Street' && s0.queue_m > 0 && s0.mean_delay_s > 0 && s0.flags.sign_errors.length === 0, `页面默认方案（只写 ROADWORK / AHEAD）：排队 ${s0.queue_m} 米、每车 +${s0.mean_delay_s} 秒`);
const s1 = await be.run(planFrom({ ...EP, f2: 'USE\nRUSSELL ST' }));
ok(s1.queue_m < s0.queue_m && s1.detour_share > s0.detour_share, `加第 2 帧 USE / RUSSELL ST：排队 ${s0.queue_m} → ${s1.queue_m} 米，绕行 ${(s0.detour_share * 100).toFixed(0)}% → ${(s1.detour_share * 100).toFixed(0)}%`);
const bad = be.check(planFrom({ ...EP, f1: 'ROADWORKSAHEAD' }));
ok(bad.some(c => !c.ok), `一行 14 个字符 → check 报错（${bad.find(c => !c.ok)?.error?.code}），页面不交给 run`);
const all = await be.run(planFrom({ ...EP, lanes: byId.get(EP.link).lanes }));
ok(all.queue_m === 0 && all.detour_share > 0.99, `全封：车全部改道（绕行 ${(all.detour_share * 100).toFixed(0)}%）`);
const off = await be.run(planFrom({ ...EP, hour: 22 }));
ok(off.flags.inactive && off.queue_m === 0, '22 点不在施工时段 → flags.inactive，数字为 0');
const adv = await be.advise(planFrom(EP));
ok(adv.options.some(o => o.better && o.plan), `顾问至少给出一个更好的改法（${adv.options.map(o => o.kind + ' ' + o.delta_min).join(' · ')}）`);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
