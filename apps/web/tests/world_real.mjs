// 真建筑（T15）：/roads/public/cbd/buildings.json → 页面方格上的多边形（src/js/1-world.js 的 buildWorldReal），再生成 2 m 地表分类 / 阴影 / 风影栅格。
// 由 tests/test_world.py 调：node tests/world_real.mjs；每条断言打一行 ✅ / ❌，不联网
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const WEB = HERE + '../';
const APPS = WEB + '../';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('✅ ' + msg); } else { fail++; console.log('❌ ' + msg); } };

// 1-world.js 整个文件不碰 DOM；geoToWorld 取 6-engine.js 的 pure 段（页面里也是它传进 buildWorldReal）
const world = readFileSync(WEB + 'src/js/1-world.js', 'utf8');
const pure = readFileSync(WEB + 'src/js/6-engine.js', 'utf8').match(/\/\* pure:begin[^\n]*\n([\s\S]*?)\/\* pure:end \*\//)[1];
const ctx = { L: a => a, console };
vm.createContext(ctx);
vm.runInContext(world + '\n' + pure + '\n;globalThis.T={WORLD,STREETS,CLS,NX,NY,CELL,streetRect,buildWorld,buildWorldReal,buildGrids,clipSide,clipStreets,inPoly,polyArea,bboxOf,geoToWorld,REAL_MIN,SYN_LANDMARKS,LANDMARK_HOST,STREET_SPAN,CLIP_EPS,MIN_PIECE_W};', ctx);
const T = ctx.T;
const data = JSON.parse(readFileSync(APPS + 'roads/public/cbd/buildings.json', 'utf8'));
const net = JSON.parse(readFileSync(APPS + 'roads/public/cbd/network.json', 'utf8'));
// 点 (x, y) 落在一条页面街道上（路面 + 人行道，含边界线），且那一段在真路网里真的有（Little La Trobe / A'Beckett 只有一段，见 STREET_SPAN）
const onRealStreet = (s, x, y) => {
  const r = T.streetRect(s), sp = T.STREET_SPAN[s.id], u = s.axis === 'h' ? x : y;
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1 && (!sp || (u >= sp[0] && u <= sp[1]));
};

// 1 裁切：U 形楼被街切开得到两块，不留沿切线的零宽连桥；压在街上的部分切掉，整块在街里的丢掉
const U = [[0, 0], [30, 0], [30, 20], [20, 20], [20, 5], [10, 5], [10, 20], [0, 20]];
const top = T.clipSide(U, 1, 12, 1), bot = T.clipSide(U, 1, 12, -1);
const areas = r => r.map(q => Math.abs(T.polyArea(q))).sort((a, b) => a - b);
ok(top.length === 2 && areas(top).every(a => Math.abs(a - 80) < 1e-6) && top.every(q => { const xs = q.map(p => p[0]); return Math.max(...xs) - Math.min(...xs) <= 10 + 1e-9; }),
  `U 形楼切掉下半：两条腿各一块、各 80 m²（得到 ${top.length} 块 ${areas(top).join(' / ')}）`);
ok(bot.length === 1 && Math.abs(areas(bot)[0] - 290) < 1e-6, `U 形楼切掉上半：一块 290 m²（得到 ${bot.length} 块 ${areas(bot).join(' / ')}）`);
const trimmed = T.clipStreets([[-40, -40], [-12, -40], [-12, -20], [-40, -20]]), edge = -15 - T.CLIP_EPS;
ok(trimmed.length === 1 && Math.abs(Math.abs(T.polyArea(trimmed[0])) - (edge + 40) * 20) < 1e-6 && Math.abs(Math.max(...trimmed[0].map(p => p[0])) - edge) < 1e-9 && T.CLIP_EPS > 0 && T.CLIP_EPS < 0.5,
  `压进 Swanston 人行道 3 m 的楼：切到街边外 ${T.CLIP_EPS} m（x = ${edge}），格心正好在街边 x = −15 的那格留给人行道`);
// 只在真路网有的那段切：Little La Trobe 只在 Elizabeth–Swanston 之间、A'Beckett 只在 Swanston 以西（network.json）
const box = (x0, x1, y0, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const llE = T.clipStreets(box(30, 60, 80, 120)), llW = T.clipStreets(box(-100, -70, 80, 120));
const abE = T.clipStreets(box(30, 60, 180, 220)), abW = T.clipStreets(box(-100, -70, 180, 220));
const whole = r => r.length === 1 && Math.abs(Math.abs(T.polyArea(r[0])) - 1200) < 1e-6;
ok(whole(llE) && whole(abE), "Swanston 以东（RMIT）横跨页面上 Little La Trobe / A'Beckett 的楼不切（真路网那里没有这两条街）");
ok(llW.length === 2 && abW.length === 2 && llW.concat(abW).every(q => q.every(p => !T.STREETS.some(s => onRealStreet(s, p[0], p[1])))),
  `反向：Elizabeth–Swanston 之间同样的楼照样被 Little La Trobe / A'Beckett 切成两块（${llW.length} / ${abW.length} 块）`);
const sliver = T.clipStreets(box(-100, -60, -105.7, -80));
ok(sliver.length === 1 && Math.min(...sliver[0].map(p => p[1])) > -95,
  `切剩 0.65 m 宽的细条（< ${T.MIN_PIECE_W} m，假设值）丢掉，只留 Little Lonsdale 北边那块（${sliver.length} 块）`);
// STREET_SPAN 跟 network.json 对得上：这两条街的路段在页面范围里的 x 两头都落在「真实那段两端 ± 路口半宽」内
for (const [id, name] of [['llatrobe', 'Little La Trobe Street'], ['abeckett', "A'Beckett Street"]]) {
  const sp = T.STREET_SPAN[id], xs = [];
  if (!sp) { ok(false, `STREET_SPAN 里没有 ${id}（${name} 在真路网里只有一段）`); continue; }
  for (const l of net.links) {
    if (l.name !== name) continue;
    const gx = l.geometry.map(g => T.geoToWorld(g[0], g[1])[0]), a0 = Math.min(...gx), a1 = Math.max(...gx);
    if (a1 > T.WORLD.x0 && a0 < T.WORLD.x1) xs.push(Math.max(a0, T.WORLD.x0), Math.min(a1, T.WORLD.x1)); // 路段按页面范围截断
  }
  const lo = Math.min(...xs), hi = Math.max(...xs), a = isFinite(sp[0]) ? sp[0] : T.WORLD.x0;
  ok(xs.length > 1 && Math.abs(lo - a) <= 16 && Math.abs(hi - sp[1]) <= 16, `${name} 在真路网里 x = ${lo.toFixed(0)}…${hi.toFixed(0)}，对得上 STREET_SPAN ${sp.join('…')}`);
}
ok(T.clipStreets([[-5, -60], [5, -60], [5, -40], [-5, -40]]).length === 0, '反向：整块落在 Swanston 路面上的楼被丢掉');

// 2 真数据换算到页面
const t0 = Date.now();
const W = T.buildWorldReal(data, T.geoToWorld);
const tBuild = Date.now() - t0;
const ids = new Set(W.buildings.map(b => b.id));
ok(W.real === true && W.count > 150 && ids.size === W.count, `落在页面范围里的真建筑 ${W.count} 栋（> 150），切成 ${W.buildings.length} 块，用时 ${tBuild} ms`);
ok(W.count >= T.REAL_MIN, `够页面换掉程序生成的城市（REAL_MIN = ${T.REAL_MIN}）`);
const bad = W.buildings.filter(b => !(b.pts.length >= 3 && b.pts.every(p => isFinite(p[0]) && isFinite(p[1])) && b.h > 0 && isFinite(b.h) && b.area >= 4
  && b.x0 <= b.x1 && b.y0 <= b.y1 && b.x1 >= T.WORLD.x0 - 80 && b.x0 <= T.WORLD.x1 + 80 && T.inPoly(b.pts, b.cx, b.cy)));
ok(bad.length === 0, `每块都有 ≥ 3 个有限坐标、高度 > 0、面积 ≥ 4 m²、标注点在楼内（不合格 ${bad.length} 块）`);
const src = data.buildings.filter(b => { const P = b.footprint.map(p => T.geoToWorld(p[0], p[1])); return P.some(p => p[0] > T.WORLD.x0 && p[0] < T.WORLD.x1 && p[1] > T.WORLD.y0 && p[1] < T.WORLD.y1); });
ok(W.count >= src.length * 0.95, `数据里有顶点落在页面内的 ${src.length} 栋，画出来 ${W.count} 栋（≥ 95%）`);

// 3 反向断言：La Trobe × Swanston 路口、任何一条街（路面 + 人行道）上都没有楼
const onBox = [];
for (let x = -15; x <= 15; x += 1) for (let y = -15; y <= 15; y += 1) for (const b of W.buildings) if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && T.inPoly(b.pts, x, y)) onBox.push(b.name || b.id);
ok(onBox.length === 0, `La Trobe × Swanston 路口 30 × 30 m 里没有楼（压上的 ${[...new Set(onBox)].slice(0, 3).join('、') || 0}）`);
const onStreet = [];
for (const s of T.STREETS) for (const b of W.buildings) for (const p of b.pts) if (onRealStreet(s, p[0], p[1])) onStreet.push(`${b.name || b.id}@${s.id}`);
ok(onStreet.length === 0, `没有楼的顶点落进 8 条街的路面 / 人行道，街边线上也没有（含边界：${onStreet.slice(0, 3).join('、') || 0}）`);
const thin = W.buildings.filter(b => b.area / Math.max(b.x1 - b.x0, b.y1 - b.y0) < T.MIN_PIECE_W);
ok(thin.length === 0, `没有切剩的细条（平均宽 < ${T.MIN_PIECE_W} m：${thin.slice(0, 3).map(b => b.name || b.id).join('、') || 0}）`);
// 页面上画了、真路网里没有的那几段街（Swanston 以东的 Little La Trobe / A'Beckett、Elizabeth 以西的 Little La Trobe）：真楼照原样画
const fict = [];
for (const s of T.STREETS) {
  if (!T.STREET_SPAN[s.id]) continue;
  const r = T.streetRect(s);
  for (let x = T.WORLD.x0 + 0.5; x < T.WORLD.x1; x += 1) for (let y = r.y0 + 0.5; y < r.y1; y += 1) if (!T.STREETS.some(o => onRealStreet(o, x, y))) fict.push([x, y]);
}
const srcP = data.buildings.map(b => { const P = b.footprint.map(p => T.geoToWorld(p[0], p[1])); return { P, bb: T.bboxOf(P) }; });
const wP = W.buildings.map(b => ({ P: b.pts, bb: b }));
const covered = (list, x, y) => list.some(q => x >= q.bb.x0 && x <= q.bb.x1 && y >= q.bb.y0 && y <= q.bb.y1 && T.inPoly(q.P, x, y));
let srcIn = 0, wIn = 0;
for (const [x, y] of fict) if (covered(srcP, x, y)) { srcIn++; if (covered(wP, x, y)) wIn++; }
ok(srcIn > 2000 && wIn >= srcIn * 0.98, `反向：真路网里没有的那几段街上，真楼 ${srcIn} m² 画出来 ${wIn} m²（≥ 98%，RMIT 8 号楼、Storey Hall 不再被切开）`);

// 4 地表分类 / 阴影 / 风影栅格
const t1 = Date.now();
const G = T.buildGrids(W);
const tGrid = Date.now() - t1;
let roof = 0, roofOnStreet = 0, foot = 0, footShade = 0, wake = 0, boxRoof = 0;
for (let j = 0; j < T.NY; j++) for (let i = 0; i < T.NX; i++) {
  const k = j * T.NX + i, c = G.cls[k], x = T.WORLD.x0 + (i + 0.5) * T.CELL, y = T.WORLD.y1 - (j + 0.5) * T.CELL;
  const isRoof = c === T.CLS.ROOF || c === T.CLS.HERITAGE;
  if (isRoof) roof++;
  if (isRoof && T.STREETS.some(s => onRealStreet(s, x, y))) roofOnStreet++; // 含边界：格心正好压在街边线上的格也算街
  if (isRoof && Math.abs(x) < 15 && Math.abs(y) < 15) boxRoof++;
  if (c === T.CLS.FOOT) { foot++; if (G.shade[k]) footShade++; }
  if (G.wake[k]) wake++;
}
const n = T.NX * T.NY;
ok(roof / n > 0.25 && roof / n < 0.75, `屋顶格占 ${(roof / n * 100).toFixed(1)}%（25–75%），栅格用时 ${tGrid} ms`);
ok(roofOnStreet === 0 && boxRoof === 0, `反向：街上 / 路口没有屋顶格，格心压在街边线上的也没有（街上 ${roofOnStreet}、路口 ${boxRoof}）`);
// 最窄的人行道：Little Lonsdale 北侧只有 y = −95 这一排格，Elizabeth–Swanston、Swanston–Russell 两段都得还是人行道（州立图书馆草坪那段本来就画成草坪，除外）
let llFoot = 0, llAll = 0;
{
  const j = Math.round((T.WORLD.y1 + 95) / T.CELL - 0.5);
  for (let i = 0; i < T.NX; i++) { const x = T.WORLD.x0 + (i + 0.5) * T.CELL; if (((x > -185 && x < -15) || (x > 15 && x < 185)) && !W.parks.some(q => x >= q.x0 && x <= q.x1)) { llAll++; if (G.cls[j * T.NX + i] === T.CLS.FOOT) llFoot++; } }
}
ok(llAll > 100 && llFoot === llAll, `Little Lonsdale 北侧人行道（y = −95 那排）没有被屋顶盖掉（${llFoot} / ${llAll} 格是人行道）`);
ok(footShade > 0 && footShade < foot, `人行道有一部分在楼影里（${footShade} / ${foot} 格）`);
ok(wake > 1000, `楼后有风影区（${wake} 格）`);
ok(tBuild + tGrid < 4000, `换算 + 栅格 ${tBuild + tGrid} ms < 4 s（页面加载时跑一次）`);
// 阴影朝东南（太阳在西北 292°）：楼的东南侧比西北侧更多在影子里
let se = 0, nw = 0;
for (const b of W.buildings) { if (b.h < 20) continue; const d = 6; se += G.shadeAt(b.cx + 0.93 * (b.x1 - b.x0) / 2 + d, b.cy - 0.37 * (b.y1 - b.y0) / 2 - d); nw += G.shadeAt(b.cx - 0.93 * (b.x1 - b.x0) / 2 - d, b.cy + 0.37 * (b.y1 - b.y0) / 2 + d); }
ok(se > nw, `影子落在楼的东南侧（东南 ${se} 处 > 西北 ${nw} 处）`);

// 5 真名字、外框高度、地标
const has = name => data.buildings.some(b => b.name === name);
for (const [name, t] of [['State Library Victoria', 'STATE LIBRARY VICTORIA'], ['Melbourne Central', 'MELBOURNE CENTRAL']]) {
  if (!has(name)) { ok(true, `数据里没有 ${name}，跳过`); continue; }
  const l = W.labels.find(q => q.t === t);
  ok(l && W.buildings.some(b => b.name === name && T.inPoly(b.pts, l.x, l.y)) && l.zh !== t, `注记「${t}」用真名、落在这栋楼上、有中文名`);
}
ok(W.labels.every(l => !T.STREETS.some(s => { const r = T.streetRect(s); return l.x > r.x0 && l.x < r.x1 && l.y > r.y0 && l.y < r.y1; })), `${W.labels.length} 条楼名注记都不压在街上`);
ok(!W.labels.some(l => /^BUILDING \w+$/.test(l.t)), '不出「BUILDING 8」这种编号名（RMIT 校园只标一个 RMIT UNIVERSITY）');
const mcOutline = W.buildings.filter(b => b.name === 'Melbourne Central' && b.area > 5000), mcTower = W.buildings.find(b => b.name === 'Melbourne Central office tower');
if (data.buildings.some(b => b.name === 'Melbourne Central' && b.height_m >= 200) && mcTower) {
  ok(mcOutline.length && mcOutline.every(b => b.h < 60) && mcTower.h >= 200, `Melbourne Central 整体外框不再按 211 m 画（${mcOutline.map(b => b.h).join(' / ')} m），里面的塔楼仍是 ${mcTower.h} m`);
} else ok(true, '数据里没有 211 m 的 Melbourne Central 外框，跳过');
ok(W.landmarks.every(l => W.buildings.some(b => b.name === T.LANDMARK_HOST[l.kind] && T.inPoly(b.pts, l.x, l.y))), `保留的地标（${W.landmarks.map(l => l.kind).join('、') || '无'}）都落在对应的真楼里`);
ok(W.parks.some(p => p.kind === 'lawn' && p.x0 === 15), '州立图书馆门前草坪保留');

// 6 兜底：数据坏了 / 拿不到 → 页面留着程序生成的城市
let threw = false, empties = [];
try { empties = [null, {}, { buildings: 'x' }, { buildings: [{ footprint: [[1, 2]] }, { footprint: [['a', 'b'], [1, 2], [3, 4]] }, null] }].map(d => T.buildWorldReal(d, T.geoToWorld).buildings.length); } catch (e) { threw = e.message; }
ok(!threw && empties.every(v => v === 0) && 0 < T.REAL_MIN, `坏数据不抛错、一栋都不画（${empties.join(',')}），页面按 REAL_MIN 退回程序生成的城市${threw ? '：' + threw : ''}`);
const S = T.buildWorld(), GS = T.buildGrids(S);
ok(S.buildings.length > 100 && S.buildings.every(b => !b.pts) && !S.real && GS.cls.length === n, `程序生成的城市照旧（${S.buildings.length} 个矩形楼，没有 pts）`);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
