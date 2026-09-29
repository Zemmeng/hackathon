// grid.js —— 真路网（T3 的 network.json / flows.json）到之前用的小方格路网：Hoddle Grid 的真街名，200 米一格。
// 格式照 docs/contract.md「路网数据文件」，换成真数据不改引擎代码。车流、配时、车道都是假设（flows.method 标 class_default）。
// 用法：const { network, flows } = makeGrid();

export const EW = ['La Trobe St', 'Lonsdale St', 'Bourke St', 'Collins St', 'Flinders St']; // 北 → 南
export const NS = ['Spencer St', 'King St', 'William St', 'Queen St', 'Elizabeth St', 'Swanston St', 'Russell St', 'Exhibition St', 'Spring St']; // 西 → 东
const BLOCK_M = 200;
const SIGNAL_S = 20; // 每个路口平均等灯（假设）：t0 = 行驶时间 + 等灯
const ORIGIN = [-37.81, 144.953]; // La Trobe St / Spencer St 附近（示意；方格没按真实的约 20° 旋转）
// 晚高峰（17 点）每个方向的车流，veh/h（假设）
const PEAK = {
  'La Trobe St': 1100, 'Lonsdale St': 700, 'Bourke St': 400, 'Collins St': 650, 'Flinders St': 1000,
  'Spencer St': 900, 'King St': 1000, 'William St': 750, 'Queen St': 450, 'Elizabeth St': 550,
  'Swanston St': 120, 'Russell St': 450, 'Exhibition St': 800, 'Spring St': 900,
};
// 一天 24 小时相对 17 点的比例（假设）；周末 × 0.7
export const PROFILE = [0.1, 0.06, 0.05, 0.05, 0.08, 0.2, 0.45, 0.8, 0.95, 0.75, 0.65, 0.7, 0.72, 0.7, 0.72, 0.8, 0.92, 1, 0.85, 0.6, 0.45, 0.35, 0.25, 0.15];
const TRAM = new Set(['La Trobe St', 'Collins St', 'Bourke St', 'Flinders St', 'Spencer St', 'William St', 'Elizabeth St', 'Swanston St']);
// Swanston St 的 CBD 段基本只给电车、自行车和行人：车速压低、禁货车（truck 是在契约字段之外加的，加字段随时可以）
const SLOW = { 'Swanston St': 20 };
const NO_TRUCK = new Set(['Swanston St']);

export function makeGrid() {
  const dLat = BLOCK_M / 111320, dLon = BLOCK_M / (111320 * Math.cos((ORIGIN[0] * Math.PI) / 180));
  const nid = (r, c) => `n${r}_${c}`;
  const nodes = [];
  for (let r = 0; r < EW.length; r++) {
    for (let c = 0; c < NS.length; c++) {
      nodes.push({ id: nid(r, c), lat: +(ORIGIN[0] - r * dLat).toFixed(6), lon: +(ORIGIN[1] + c * dLon).toFixed(6), osm: null, signal: true });
    }
  }
  const at = (r, c) => nodes[r * NS.length + c];
  const links = [];
  const add = (a, b, name) => {
    const kmh = SLOW[name] || 40;
    links.push({
      id: `L-${a.id}-${b.id}`, from: a.id, to: b.id, name, highway: 'secondary', len_m: BLOCK_M, lanes: 2,
      speed_kmh: kmh, cap_vph: 1800, t0_s: Math.round(BLOCK_M / (kmh / 3.6) + SIGNAL_S),
      tram: TRAM.has(name), bike_lane: false, osm_way: null, geometry: [[a.lat, a.lon], [b.lat, b.lon]],
      ...(NO_TRUCK.has(name) ? { truck: false } : {}),
    });
  };
  for (let r = 0; r < EW.length; r++) for (let c = 0; c + 1 < NS.length; c++) { add(at(r, c), at(r, c + 1), EW[r]); add(at(r, c + 1), at(r, c), EW[r]); }
  for (let c = 0; c < NS.length; c++) for (let r = 0; r + 1 < EW.length; r++) { add(at(r, c), at(r + 1, c), NS[c]); add(at(r + 1, c), at(r, c), NS[c]); }

  const lats = nodes.map(n => n.lat), lons = nodes.map(n => n.lon);
  const network = {
    version: 1,
    area: 'hoddle-grid-toy',
    bbox: [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)],
    generated: 'apps/engine/public/js/grid.js',
    sources: ['assumed'],
    assumptions: [
      '5 × 9 小方格，Hoddle Grid 真街名，每格 200 米，双向各 2 车道，通行能力 900 veh/h/车道',
      `t0 = 行驶时间（40 km/h）+ 每个路口平均等灯 ${SIGNAL_S} 秒；Swanston St 按 20 km/h、禁货车`,
      '车流按街道给晚高峰值 × 24 小时比例，周末 × 0.7，全部是假设',
    ],
    nodes,
    links,
  };
  const wd = {}, we = {}, method = {};
  for (const l of links) {
    wd[l.id] = PROFILE.map(p => Math.round(PEAK[l.name] * p));
    we[l.id] = PROFILE.map(p => Math.round(PEAK[l.name] * p * 0.7));
    method[l.id] = 'class_default';
  }
  const flows = { version: 1, unit: 'veh/h', period: 'assumed', days: { wd, we }, method, coverage: { links: links.length, measured: 0, estimated: links.length } };
  return { network, flows };
}
