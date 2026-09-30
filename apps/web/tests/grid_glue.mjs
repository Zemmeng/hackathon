// 2×2 grid micro-sim (src/js/4b-grid.js) on the real network: gridlock, works queue, red lights, overlaps, determinism.
// Called by tests/test_grid.py; one ✅ / ❌ line per assertion, no network access.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const WEB = HERE + '../', APPS = WEB + '../';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('✅ ' + msg); } else { fail++; console.log('❌ ' + msg); } };

const eng = readFileSync(WEB + 'src/js/6-engine.js', 'utf8').match(/\/\* pure:begin[^\n]*\n([\s\S]*?)\/\* pure:end \*\//)[1];
const grid = readFileSync(WEB + 'src/js/4b-grid.js', 'utf8').match(/\/\* grid:begin \*\/\n([\s\S]*?)\/\* grid:end \*\//)[1];
const stubs = `const clamp=(v,a,b)=>v<a?a:v>b?b:v;
function rng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const WXP={clear:{v:1,T:1,b:1,ped:1,bike:1,wob:0,rate:1},storm:{v:.82,T:1.4,b:.72,ped:1.12,bike:.85,wob:.15,rate:.9}};
const WORLD={x0:-320,x1:320,y0:-300,y1:300};const RISK_CELL=4,RNX=(WORLD.x1-WORLD.x0)/RISK_CELL,RNY=(WORLD.y1-WORLD.y0)/RISK_CELL;`;
const ctx = {}; vm.createContext(ctx);
vm.runInContext(stubs + '\n' + eng + '\n' + grid + '\n;globalThis.G={gridSpec,GridSim,GRID_BOX,gridSigState,GRID_K};', ctx);
const G = ctx.G;
const net = JSON.parse(readFileSync(APPS + 'roads/public/cbd/network.json', 'utf8'));
const flows = JSON.parse(readFileSync(APPS + 'roads/public/cbd/flows.json', 'utf8'));
const B = G.GRID_BOX, W = { x0: -320, x1: 320, y0: -300, y1: 300 };
const WORKS = { link: 'l595594354_9756035316', lanes: 1 };

const sp8 = G.gridSpec(net.links, flows, 8, null), sp8w = G.gridSpec(net.links, flows, 8, WORKS);
ok(B.x0 >= W.x0 && B.x1 <= W.x1 && B.y0 >= W.y0 && B.y1 <= W.y1, 'GRID_BOX lies inside WORLD');
ok(sp8.junctions.length === 4 && sp8.junctions.every(J => J.x > B.x0 && J.x < B.x1 && J.y > B.y0 && J.y < B.y1),
  'four junctions inside GRID_BOX: ' + sp8.junctions.map(J => `${J.id} (${Math.round(J.x)},${Math.round(J.y)})`).join(' '));
console.log('   dirs: ' + sp8.dirs.map(D => `${D.street.replace(' Street', '')} ${D.dir} ${D.lanes}L ${Math.round(D.vph)}/h`).join(' · '));
ok(sp8w.close && sp8w.dirs[sp8w.close.di].street === 'Lonsdale Street' && sp8w.dirs[sp8w.close.di].dir === 'W' && sp8w.close.n === 1,
  `works link maps to Lonsdale St westbound kerb lane, s ${sp8w.close && Math.round(sp8w.close.s0)}..${sp8w.close && Math.round(sp8w.close.s1)}`);

function run(spec, seed, secs, opt = {}) {
  const sim = new G.GridSim(spec, { seed }); const r = { red: 0, overlap: 0, inPoly: 0, outBox: 0, maxStop: 0, q: [], samples: 0 };
  sim.onCross = (c, ln, q, t) => { if (G.gridSigState(spec, q.j, ln.D.axis, t) === 'R') r.red++; };
  const polys = sim.works().polys;
  const pip = (x, y, P) => { let inside = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } return inside; };
  const t0 = Date.now();
  for (let k = 0; k < secs / 0.25; k++) {
    sim.step(0.25);
    for (const ln of sim.lanes) for (let i = 1; i < ln.cars.length; i++) if (ln.cars[i - 1].s - ln.cars[i - 1].len - ln.cars[i].s < 0) r.overlap++;
    for (const a of sim.agents) {
      if (a.x < B.x0 - 10 || a.x > B.x1 + 10 || a.y < B.y0 - 10 || a.y > B.y1 + 10) r.outBox++;
      for (const P of polys) if (pip(a.x, a.y, P)) r.inPoly++;
    }
    if (k % 40 === 0 && sim.t > 300) {
      const n = sim.agents.length, st = sim.agents.filter(a => a.v < 0.5).length;
      if (n >= 10) r.maxStop = Math.max(r.maxStop, st / n);
      r.q.push(opt.qAt ? sim.queueAt(opt.qAt.di, opt.qAt.s0) : sim.works().queue_m); r.samples++;
    }
  }
  r.ms = Date.now() - t0; r.sim = sim; r.qAvg = r.q.reduce((a, b) => a + b, 0) / Math.max(1, r.q.length); return r;
}
const served = sim => sim.entry.filter(e => e.arr > 0).map(e => ({ e, f: e.ins / e.arr }));

// 1 hour 8, no works
const A = run(sp8, 7, 3600, { qAt: sp8w.close });
const sA = served(A.sim);
console.log(`   1 simulated hour took ${A.ms} ms (${(3600 / (A.ms / 1000)).toFixed(0)}× real time), ${A.sim.stats.done} cars done`);
ok(sA.every(x => x.f >= 0.8), '08:00 no works: every entry served ≥ 80 % of demand — ' + sA.map(x => `${x.e.street.replace(' Street', '')} ${x.e.dir} ${x.e.ins}/${x.e.arr}`).join(', '));
ok(A.maxStop < 0.9 && A.sim.stats.done > 1000, `08:00 no works: no gridlock — stopped share peaks at ${(A.maxStop * 100).toFixed(0)} % (< 90 %), ${A.sim.stats.done} cars through`);
ok(A.ms < 20000, `1 simulated hour runs in ${A.ms} ms (< 20 s)`);

// 2 hour 8 with the demo works (Lonsdale St westbound, 1 lane)
const Bw = run(sp8w, 7, 3600);
const sB = served(Bw.sim);
ok(Bw.qAvg > A.qAvg && Bw.sim.stats.merges > 20, `works: mean queue at the works ${Bw.qAvg.toFixed(0)} m vs ${A.qAvg.toFixed(0)} m without, ${Bw.sim.stats.merges} zipper merges`);
ok(Bw.maxStop < 0.9 && sB.every(x => x.f >= 0.8), `works: no gridlock — stopped share peaks at ${(Bw.maxStop * 100).toFixed(0)} %, every entry served ≥ 80 % (` + sB.map(x => `${x.e.dir}${x.e.street[0]} ${(x.f * 100).toFixed(0)}%`).join(' ') + ')');
ok(Bw.sim.works().polys.length === 1, 'works() returns one closed-lane polygon for lanes: 1');

// 3–5, 8 reverse assertions over both runs
ok(A.inPoly + Bw.inPoly === 0, `reverse: no car centre ever inside a closed-lane polygon (${Bw.inPoly} hits)`);
ok(A.red + Bw.red === 0 && A.sim.redRun + Bw.sim.redRun === 0, `reverse: no car crosses a stop line on red (${A.red + Bw.red} independent, ${A.sim.redRun + Bw.sim.redRun} self-reported)`);
ok(A.overlap + Bw.overlap === 0, `reverse: no overlaps on any lane (gap ≥ 0) — ${A.overlap + Bw.overlap} violations`);
ok(A.outBox + Bw.outBox === 0, `every agent always inside GRID_BOX ± 10 (${A.outBox + Bw.outBox} outside)`);

// 6 determinism
const d1 = run(sp8w, 42, 600), d2 = run(sp8w, 42, 600);
ok(JSON.stringify(d1.sim.stats) === JSON.stringify(d2.sim.stats) && d1.sim.agents.length === d2.sim.agents.length, `same seed → same stats (${JSON.stringify(d1.sim.stats)})`);

// 7 hour 17
const sp17 = G.gridSpec(net.links, flows, 17, null), C = run(sp17, 3, 3600), sC = served(C.sim);
ok(C.maxStop < 0.9 && sC.every(x => x.f >= 0.8) && C.red + C.overlap + C.outBox === 0, `17:00: no gridlock — stopped share peaks at ${(C.maxStop * 100).toFixed(0)} %, ${C.sim.stats.done} cars, entries ≥ 80 %`);
const Cw = run(G.gridSpec(net.links, flows, 17, WORKS), 3, 1800);
ok(Cw.maxStop < 0.9 && Cw.inPoly + Cw.red + Cw.overlap === 0, `17:00 with works: no gridlock (${(Cw.maxStop * 100).toFixed(0)} %), no car in the works, none on red`);

// API shape the page codes against
const s = Bw.sim, a0 = s.agents[0], h = s.signalHeads();
ok(s.isGrid === true && s.risk.constructor.name === "Float32Array" && s.risk.length === 160 * 150 && s.minute.length === 60 && Array.isArray(s.events) && 'riskVer' in s && 'clock0' in s && s.critical === null,
  'GridSim fields: isGrid, agents, events, risk, riskVer, stats, minute, critical, t, clock0');
ok(a0 && ['id', 'kind', 'type', 'x', 'y', 'hx', 'hy', 'v', 'acc', 'len', 'wid', 'trail', 'tag', 'blocked'].every(k => k in a0) && a0.trail.length <= 24,
  'agents carry id, kind, type, x, y, hx, hy, v, acc, len, wid, trail (≤ 24), tag, blocked');
ok(h.length >= 8 && h.every(x => (x.axis === 'EW' || x.axis === 'NS') && 'GAR'.includes(x.state)), `signalHeads(): ${h.length} heads with axis and G / A / R`);
ok(s.agents.some(a => a.type === 'tram'), 'trams run on Swanston St');
s.setWeather('storm', null); s.step(5); ok(s.wxk === 'storm', 'setWeather switches the weather multipliers');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
