// SUMO replay on the real network (src/js/4c-sumo.js, T40): a contract-v2 replay built in memory (cars along Lonsdale St
// westbound through the works link, a bus, two signal heads, two chunks) drives SumoReplay through the surface the page
// draws from (all / agents, signalHeads, works, stats, minute, clock, loop, wait-for-chunk). When the baked copy exists
// (apps/sumo/public/real/index.json) its files are checked too: format, chunk sizes and sha256, the 16 junctions' signal
// heads, headings along the direction of travel and axis-aligned with the Hoddle grid.
// Called by tests/test_sumo_wire.py; one ✅ / ❌ line per assertion, no network access.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const WEB = HERE + '../', APPS = WEB + '../';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('✅ ' + msg); } else { fail++; console.log('❌ ' + msg); } };

const block = (file, tag) => readFileSync(WEB + 'src/js/' + file, 'utf8').match(new RegExp(`/\\* ${tag}:begin[^\\n]*\\n([\\s\\S]*?)/\\* ${tag}:end \\*/`))[1];
const stubs = `const clamp=(v,a,b)=>v<a?a:v>b?b:v;
function rng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const WXP={clear:{v:1,T:1,b:1,ped:1,bike:1,wob:0,rate:1}};
const WORLD={x0:-320,x1:320,y0:-300,y1:300};const RISK_CELL=4,RNX=(WORLD.x1-WORLD.x0)/RISK_CELL,RNY=(WORLD.y1-WORLD.y0)/RISK_CELL;`;
const ctx = {}; vm.createContext(ctx);
vm.runInContext(stubs + '\n' + block('6-engine.js', 'pure') + '\n' + block('4b-grid.js', 'grid') + '\n' + block('4c-sumo.js', 'sumo') +
  '\n;globalThis.X={geoToWorld,gridSpec,GridSim,GRID_K,SumoReplay,SUMO_LINK,sumoHeadState};', ctx);
const X = ctx.X;
const net = JSON.parse(readFileSync(APPS + 'roads/public/cbd/network.json', 'utf8'));
const flows = JSON.parse(readFileSync(APPS + 'roads/public/cbd/flows.json', 'utf8'));
const spec = X.gridSpec(net.links, flows, 8, { link: X.SUMO_LINK, lanes: 1 });
const polys = new X.GridSim(spec, { seed: 1 }).works().polys;
const works = net.links.find(l => l.id === X.SUMO_LINK);
ok(works && works.name === 'Lonsdale Street' && spec.close && polys.length === 1, 'the SUMO demo link is the Lonsdale St works link the grid sim closes (1 lane polygon)');

// ---- fixture: contract v2 replay in memory -------------------------------------------------------------------------------
// a line along the works link (east → west), metres ↔ lat / lon; SUMO angle of travel from the bearing
const [a, b] = works.geometry, mLat = 111320, mLon = 111320 * Math.cos(a[0] * Math.PI / 180);
const dN = (b[0] - a[0]) * mLat, dE = (b[1] - a[1]) * mLon, L0 = Math.hypot(dN, dE), uN = dN / L0, uE = dE / L0;
const ANG = ((Math.atan2(uE, uN) * 180 / Math.PI) + 360) % 360; // 0 = north, clockwise
const at = s => [a[0] + uN * s / mLat, a[1] + uE * s / mLon]; // s metres past the east end of the works link (negative = upstream)
const DUR = 120, CL0 = 180;
const AG = [{ id: 'c0', type: 'car', length_m: 5, width_m: 1.8 }, { id: 'c1', type: 'car', length_m: 5, width_m: 1.8 }, { id: 'c2', type: 'car', length_m: 5, width_m: 1.8 },
  { id: 'c3', type: 'car', length_m: 5, width_m: 1.8 }, { id: 'b0', type: 'bus', length_m: 12, width_m: 2.5 }];
// car 0 stops at the works from t 30; car 4 (bus) leaves the map at t 50; the rest drive 8 m/s westbound
const posOf = (i, t) => { if (i === 4 && t >= 50) return null; const v = i === 0 && t >= 30 ? 0 : 8, s0 = -40 * i - 60; return { s: i === 0 ? s0 + 8 * Math.min(t, 30) : s0 + 8 * t, v }; };
const tlsAt = t => t < 30 ? 'GGr' : t < 33 ? 'yyr' : 'rrG';
const frame = t => ({ t, a: AG.map((_, i) => { const p = posOf(i, t); if (!p) return null; const [lat, lon] = at(p.s); return [i, Math.round(lon * 1e6), Math.round(lat * 1e6), ANG, Math.round(p.v * 100)]; }).filter(Boolean),
  tls: { J1: tlsAt(t), J2: tlsAt(t) }, q: t * 0.5 });
const chunks = [0, 60].map(s0 => ({ frames: Array.from({ length: 60 }, (_, k) => frame(s0 + k)) }));
const [hLat, hLon] = at(-10);
const MAN = { version: 2, network: 'real', scenario: 'original', duration_s: DUR, sample_s: 1, clock0_s: CL0, agent_columns: ['i', 'lon_e6', 'lat_e6', 'angle_deg', 'speed_cms'], agents: AG,
  signal_heads: [{ id: 'h1', tls: 'J1', idx: [0, 1], lon_e6: Math.round(hLon * 1e6), lat_e6: Math.round(hLat * 1e6) }, { id: 'h2', tls: 'J2', idx: [2], lon_e6: Math.round(hLon * 1e6), lat_e6: Math.round(hLat * 1e6) }],
  chunks: [{ file: 'frames-000.json', start: 0, end: 60 }, { file: 'frames-001.json', start: 60, end: 120 }],
  metrics: { vehicles: 5, completed: 1, teleports: 0, collisions: 0, mean_timeloss_s: 20, mean_extra_s: 12.5, works_queue_max_m: 60, works_queue_mean_m: 30, detour_vehicles: 7 },
  per_minute: { halting: [1, 2], harsh: [2, 3] } };
const IDX = { version: 2, network: 'real', engine: 'Eclipse SUMO sumo 1.27.1', seed: 42, hour: 8, works: { link: X.SUMO_LINK, lanes_closed: 1 },
  scenarios: [{ id: 'original', label: { en: 'Original', zh: '原方案' }, diversion_share: 0.14, manifest: 'original/manifest.json', metrics: { mean_extra_s: 12.5 } }] };
const pg = (i, t) => { const p = posOf(i, t); const [lat, lon] = at(p.s); return X.geoToWorld(Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6); };
const near = (u, v, e = 1e-3) => Math.abs(u - v) <= e;

const R = new X.SumoReplay(IDX, 'original', MAN, { spec, polys, src: { source: 'baked' } });
ok(R.isGrid === true && R.isSumo === true && R.critical === null && Array.isArray(R.events) && R.minute.length === 60 && R.risk.length === 160 * 150 && 'riskVer' in R && R.spec === spec,
  'SumoReplay wears the GridSim surface: isGrid, isSumo, critical, events, minute, risk, riskVer, spec');
R.step(1); ok(!R.ready && R.t === 0 && R.all.length === 0, 'no chunk yet: not ready, step() does nothing');
R.addChunk(0, chunks[0]);
ok(R.ready && R.nLoaded === 60 && R.all.length === 5 && R.agents === R.all, `first chunk in: ready, ${R.all.length} vehicles at t 0, agents === all (what the page draws and counts)`);
R.step(0.5);
{ const c = R.all.find(o => o.id === 'c1'), p0 = pg(1, 0), p1 = pg(1, 1);
  ok(c && near(c.x, (p0[0] + p1[0]) / 2) && near(c.y, (p0[1] + p1[1]) / 2), `t 0.5: positions linear between the 1 s samples (${c && c.x.toFixed(2)}, ${c && c.y.toFixed(2)})`);
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], n = Math.hypot(dx, dy);
  ok(c && near(Math.hypot(c.hx, c.hy), 1) && (c.hx * dx + c.hy * dy) / n > 0.999, `heading from SUMO's angle (${ANG.toFixed(1)}°, 0 = north, clockwise) points along the travel on the page: (${c.hx.toFixed(3)}, ${c.hy.toFixed(3)})`);
  ok(c && near(c.v, 8 * X.GRID_K, 1e-3) && c.kind === 'veh' && c.type === 'car' && near(c.len, 5 * X.GRID_K) && near(c.wid, 1.8 * X.GRID_K) && c.tag === null && c.blocked === false && Array.isArray(c.trail),
    'cars: kind veh, type car, v / len / wid in page units (× GRID_K), tag null, blocked false, trail');
  const bus = R.all.find(o => o.id === 'b0');
  ok(bus && bus.type === 'bus' && near(bus.len, 12 * X.GRID_K), 'the bus keeps type bus and its 12 m length');
}
// on the page the fixture cars drive through the grid sim's closed-lane polygon (same projection as the grid)
{ const P = polys[0], cx = P.reduce((s, p) => s + p[0], 0) / 4, cy = P.reduce((s, p) => s + p[1], 0) / 4, [lat, lon] = at(L0 / 2), q = X.geoToWorld(lat, lon);
  ok(Math.hypot(q[0] - cx, q[1] - cy) < 8, `the works link's midpoint lands on the grid sim's closure polygon (${Math.hypot(q[0] - cx, q[1] - cy).toFixed(1)} units)`); }
{ const H = R.signalHeads();
  ok(H.length === 2 && H[0].state === 'G' && H[1].state === 'R' && H.every(h => h.shown === true && isFinite(h.x) && isFinite(h.y)), `signal heads: G for idx 0–1 of "GGr", R for idx 2 (${H.map(h => h.state).join(' ')})`); }
R.step(30.7); // t 31.2
ok(R.signalHeads()[0].state === 'A', 'amber while its links show y');
ok(near(R.works().queue_m, 31.2 * 0.5, 1e-3) && R.works().polys === polys, `works(): queue from the frames' q, linear (${R.works().queue_m.toFixed(2)} m), closure polygon passed through`);
R.step(10); ok(R.signalHeads()[0].state === 'R' && R.signalHeads()[1].state === 'G', 'red / green after the switch');
{ const c0 = R.all.find(o => o.id === 'c0'); ok(c0 && c0.v === 0 && c0.acc === 0, 'car 0 stands at the works (v 0)'); }
ok(R.stats.harsh === 2 && R.minute[3] === 2 && R.minute.reduce((s, v) => s + v, 0) === 2 && R.stats.conflicts === 0 && R.stats.critical === 0,
  `stats: harsh = per_minute.harsh summed to this minute (${R.stats.harsh}), minute[] at 08:03 (clock0 ${CL0} s), conflicts / critical 0`);
ok(near(R.clock(), CL0 + R.t), `clock() = clock0_s + t (${R.clock().toFixed(1)} s past 08:00)`);
R.step(100); ok(R.t === 59 && R.all.length === 4, `second chunk not in yet: holds at the last loaded sample (t ${R.t}), no loop; the bus has left`);
R.addChunk(1, chunks[1]); ok(R.complete && R.nLoaded === 120, 'second chunk in: complete');
R.step(3); ok(near(R.t, 62) && R.stats.harsh === 5 && R.minute[4] === 3, `plays on into it (t ${R.t}), harsh 2 + 3 = ${R.stats.harsh}`);
R.step(60); ok(R.t < 10 && R.stats.harsh === 2 && R.all.every(c => c.trail.length <= 4), `loops at the end (t ${R.t.toFixed(1)}), stats and trails start again`);
R.seek(40); ok(R.t === 40 && R.all.every(c => c.trail.length <= 2) && R.stats.harsh === 2, 'seek(t) jumps there (histogram click)');
ok(R.metrics.mean_extra_s === 12.5 && R.metrics.detour_vehicles === 7, 'metrics: manifest metrics over the index entry');
{ const [p, q] = [at(0), at(L0)], M2 = Object.assign({}, MAN, { works: { link: X.SUMO_LINK, lane_shape_e6: [[Math.round(p[1] * 1e6), Math.round(p[0] * 1e6)], [Math.round(q[1] * 1e6), Math.round(q[0] * 1e6)]] } });
  const P = new X.SumoReplay(IDX, 'original', M2, { spec, polys }).works().polys, c = P[0] && P[0].reduce((s, v) => [s[0] + v[0] / P[0].length, s[1] + v[1] / P[0].length], [0, 0]), [lat, lon] = at(L0 / 2), m = X.geoToWorld(lat, lon);
  ok(P.length === 1 && P[0].length === 4 && Math.hypot(c[0] - m[0], c[1] - m[1]) < 0.5 && P !== polys, `manifest works.lane_shape_e6 → the closure polygon is the lane SUMO closed (centroid ${Math.hypot(c[0] - m[0], c[1] - m[1]).toFixed(2)} units off its centre line)`); }
{ const B = new X.SumoReplay(IDX, 'baseline', MAN, { spec, polys }); ok(B.works().polys.length === 0 && B.src.source === 'baked', 'baseline has no works polygon; default source is baked, never live'); }
{ const O = new X.SumoReplay(IDX, 'original', MAN, { spec, polys }); O.addChunk(1, chunks[1]); const r1 = O.ready; O.addChunk(0, chunks[0]);
  ok(!r1 && O.nLoaded === 120 && O.complete, 'chunks may arrive out of order: playable only from t 0, complete once both are in'); }
ok(X.sumoHeadState('rrgr', [0, 2]) === 'G' && X.sumoHeadState('rYr', [1]) === 'A' && X.sumoHeadState('rrr', [0]) === 'R' && X.sumoHeadState(undefined, [0]) === 'R',
  'head colour: any G/g → green, else any y/Y → amber, else red');
let threw = false; try { new X.SumoReplay(IDX, 'original', { agents: 1 }, {}); } catch (e) { threw = true; }
ok(threw, 'reverse: a malformed manifest throws (the page then keeps the grid sim)');

// ---- the baked copy, once the backend has written it ---------------------------------------------------------------------
const REAL = APPS + 'sumo/public/real/';
if (!existsSync(REAL + 'index.json')) console.log('   (apps/sumo/public/real/index.json not there yet: baked-copy checks skipped)');
else {
  const idx = JSON.parse(readFileSync(REAL + 'index.json', 'utf8'));
  ok(idx.version === 2 && idx.network === 'real' && idx.works && idx.works.link === X.SUMO_LINK && ['baseline', 'original', 'ai'].every(id => idx.scenarios.some(s => s.id === id)),
    `baked index.json: v2, real network, works on ${idx.works && idx.works.link}, scenarios ${idx.scenarios.map(s => s.id).join(' / ')}`);
  for (const sc of idx.scenarios) {
    const man = JSON.parse(readFileSync(REAL + sc.manifest, 'utf8')), dir = REAL + sc.id + '/';
    const big = [], badSha = [];
    for (const c of man.chunks) { const f = dir + c.file; if (statSync(f).size >= 1.5e6) big.push(c.file); if (c.sha256 && createHash('sha256').update(readFileSync(f)).digest('hex') !== c.sha256) badSha.push(c.file); }
    ok(man.version === 2 && man.scenario === sc.id && !big.length && !badSha.length, `${sc.id}: ${man.chunks.length} chunks, each < 1.5 MB, sha256 match${big.length ? ' — big ' + big : ''}${badSha.length ? ' — sha ' + badSha : ''}`);
    const Rr = new X.SumoReplay(idx, sc.id, man, { spec, polys });
    man.chunks.forEach((c, k) => Rr.addChunk(k, JSON.parse(readFileSync(dir + c.file, 'utf8'))));
    let n = 0, bad = 0, axis = 0, mv = 0, along = 0, maxCars = 0, heads16 = 0;
    const prev = new Map();
    for (let t = 0; t < Math.min(Rr.nLoaded - 1, 600); t++) {
      Rr.seek(t); maxCars = Math.max(maxCars, Rr.all.length);
      for (const c of Rr.all) {
        n++; if (!isFinite(c.x) || !isFinite(c.y) || !near(Math.hypot(c.hx, c.hy), 1, 1e-3)) bad++;
        if (Math.abs(c.hx) > 0.9 || Math.abs(c.hy) > 0.9) axis++;
        const p = prev.get(c.id); if (p && c.v > 3) { const dx = c.x - p[0], dy = c.y - p[1], d = Math.hypot(dx, dy); if (d > 1) { mv++; if ((dx * c.hx + dy * c.hy) / d > 0.9) along++; } }
      }
      prev.clear(); for (const c of Rr.all) prev.set(c.id, [c.x, c.y]);
    }
    if (sc.id !== 'baseline') { const P = Rr.works().polys[0], G0 = polys[0], cen = Q => Q.reduce((s, v) => [s[0] + v[0] / Q.length, s[1] + v[1] / Q.length], [0, 0]), d = P ? Math.hypot(cen(P)[0] - cen(G0)[0], cen(P)[1] - cen(G0)[1]) : 1e9;
      ok(P && d < 8, `${sc.id}: closure polygon from the lane SUMO closed, ${d.toFixed(1)} units from the grid sim's (same link, other lane)`); }
    const H = Rr.signalHeads();
    heads16 = spec.junctions.filter(J => H.some(h => Math.hypot(h.x - J.x, h.y - J.y) < 45)).length;
    ok(maxCars > 20 && bad === 0, `${sc.id}: up to ${maxCars} vehicles on the page, positions finite, headings unit length (${n} samples)`);
    ok(mv > 50 && along / mv > 0.95, `${sc.id}: heading follows the movement between samples for ${(100 * along / Math.max(1, mv)).toFixed(1)} % of ${mv} moving samples (angle convention and centre positions right)`);
    ok(axis / n > 0.8, `${sc.id}: ${(100 * axis / n).toFixed(0)} % of headings lie along the page axes (Hoddle grid streets)`);
    ok(heads16 === 16, `${sc.id}: signal heads at ${heads16} of the 16 grid junctions`);
  }
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
