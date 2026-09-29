// params.js —— 引擎参数的入口：T12 @Unzzip 交的 `/params/public/params.json`（每个数带出处，格式见 docs/arch/T12-params-PRD.md 第 4 节）。
// 读得到就用有出处的数，读不到 / 缺项 / 不合格就逐项回退到 choice.js、calibrate.js 里的假设值［待核］，并记下每一项用的是哪个。
// 用法：const params = await loadParams();  const engine = createEngine({ network, flows, readSigns, params });
//        node 里：applyParams(JSON.parse(fs.readFileSync('apps/params/public/params.json', 'utf8')))
//
// 引擎认的字段（其余字段照收不用，列在 used.ignored）：
//   mix.<类型>                    4 类人占比，4 个都要有、各在 0–1、加起来 1 ± 0.02（会归一），否则整组用假设值
//   anchors.generic_warning_divert 只写「前方施工」的绕行比例 → 两点校准低点；named_route_divert 写推荐路线 → 高点。两个都要有、0–1 之间、低 < 高
//   persona.<类型>.hurry | familiar | trust | queue_averse | truck_only   直接对应 choice.js 的 PERSONAS，逐项回退
//   persona.<类型>.route_familiarity（T12 #31 的叫法，知道替代路线的比例 0–1）= familiar 的别名，familiar 没给时用它
//   persona.<类型>.sign_trust     照屏上说的走的比例（0–1）。某类人没给 trust、而 4 类都有 sign_trust 时，
//                                 换算成相对倍数 sign_trust ÷（按占比加权的平均），平均的人 = 1（绝对高低由两点校准的推荐力度 B 吸收）
// 每个数可以写成 { value: 数 } 或直接写数；value 是 null（没找到）就当没给。

import { TYPES, MIX, PERSONAS } from './choice.js';
import { ANCHORS } from './calibrate.js';

export const PARAMS_URL = '/params/public/params.json';

// 每项的合法范围（超出就当没给；familiar 进 ln()，必须 > 0）
const PERSONA_KEYS = {
  hurry: [0.05, 5],
  familiar: [0.01, 1],
  trust: [0, 3],
  queue_averse: [0, 5],
};
const MIX_TOL = 0.02;

const own = (o, k) => o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const numOf = x => {
  const v = x != null && typeof x === 'object' ? x.value : x;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
const inRange = (v, [lo, hi]) => v != null && v >= lo && v <= hi;

function defaults() {
  return {
    mix: { ...MIX },
    personas: Object.fromEntries(TYPES.map(t => [t, { ...PERSONAS[t] }])),
    anchors: { lo: ANCHORS.lo.real, hi: ANCHORS.hi.real },
  };
}

// json → { mix, personas, anchors, used }；json 不是对象就全用假设值。不改动 MIX / PERSONAS / ANCHORS 本身
export function applyParams(json) {
  const out = defaults();
  const used = { src: 'default', version: null, mix: 'default', anchors: 'default', persona: {}, ignored: [], errors: [] };
  for (const t of TYPES) used.persona[t] = Object.fromEntries([...Object.keys(PERSONA_KEYS), 'truck_only'].map(k => [k, 'default']));
  if (json == null || typeof json !== 'object' || Array.isArray(json)) {
    if (json != null) used.errors.push('params.json 不是对象');
    return { ...out, used };
  }
  used.src = 'params';
  used.version = numOf(json.version);
  const known = new Set(['version', 'mix', 'anchors', 'persona']);
  used.ignored = Object.keys(json).filter(k => !known.has(k)).sort();

  // 4 类人占比：整组要么全用，要么全不用（缺一类就没法归一）
  if (own(json, 'mix')) {
    const m = Object.fromEntries(TYPES.map(t => [t, own(json.mix, t) ? numOf(json.mix[t]) : null]));
    const sum = TYPES.reduce((s, t) => s + (m[t] ?? NaN), 0);
    if (!TYPES.every(t => inRange(m[t], [0, 1]))) used.errors.push('mix：4 类人要都有 0–1 之间的数');
    else if (!(Math.abs(sum - 1) <= MIX_TOL)) used.errors.push(`mix：加起来是 ${+sum.toFixed(3)}，不是 1`);
    else { for (const t of TYPES) out.mix[t] = m[t] / sum; used.mix = 'params'; }
  }

  // 两点校准的两个目标
  if (own(json, 'anchors')) {
    const lo = own(json.anchors, 'generic_warning_divert') ? numOf(json.anchors.generic_warning_divert) : null;
    const hi = own(json.anchors, 'named_route_divert') ? numOf(json.anchors.named_route_divert) : null;
    if (lo == null && hi == null) { /* 都没找到：用假设值，不算错 */ }
    else if (!(inRange(lo, [0.001, 0.999]) && inRange(hi, [0.001, 0.999]) && lo < hi)) used.errors.push('anchors：generic_warning_divert 和 named_route_divert 要都在 0–1 之间、前者小于后者');
    else { out.anchors = { lo, hi }; used.anchors = 'params'; }
  }

  // 每类人参数：逐项回退
  const P = own(json, 'persona') && json.persona && typeof json.persona === 'object' ? json.persona : null;
  if (P) {
    for (const t of TYPES) {
      const src = own(P, t) ? P[t] : null;
      if (!src || typeof src !== 'object') continue;
      for (const [k, range] of Object.entries(PERSONA_KEYS)) {
        const key = !own(src, k) && k === 'familiar' && own(src, 'route_familiarity') ? 'route_familiarity' : k;
        if (!own(src, key)) continue;
        const v = numOf(src[key]);
        if (v == null) continue; // null = 没找到，不算错
        if (!inRange(v, range)) { used.errors.push(`persona.${t}.${k} = ${v} 超出 ${range[0]}–${range[1]}`); continue; }
        out.personas[t][k] = v;
        used.persona[t][k] = 'params';
      }
      if (own(src, 'truck_only')) {
        const v = src.truck_only != null && typeof src.truck_only === 'object' ? src.truck_only.value : src.truck_only;
        if (typeof v === 'boolean') { out.personas[t].truck_only = v; used.persona[t].truck_only = 'params'; }
      }
    }
    // sign_trust（照屏走的比例）→ 相对倍数，只补没直接给 trust 的类型
    const st = Object.fromEntries(TYPES.map(t => [t, own(P, t) && own(P[t], 'sign_trust') ? numOf(P[t].sign_trust) : null]));
    if (TYPES.every(t => inRange(st[t], [0, 1]))) {
      const mean = TYPES.reduce((s, t) => s + out.mix[t] * st[t], 0);
      if (mean > 0) {
        for (const t of TYPES) {
          if (used.persona[t].trust === 'params') continue;
          const v = st[t] / mean;
          if (!inRange(v, PERSONA_KEYS.trust)) { used.errors.push(`persona.${t}.sign_trust 换算后 ${+v.toFixed(3)} 超出范围`); continue; }
          out.personas[t].trust = v;
          used.persona[t].trust = 'sign_trust';
        }
      }
    } else if (TYPES.some(t => st[t] != null)) {
      used.errors.push('persona.*.sign_trust：要 4 类人都有 0–1 之间的数才换算');
    }
  }
  return { ...out, used };
}

// 浏览器里默认从同源的 /params/public/params.json 读；读不到（404、断网、不是 JSON）一律回退，不抛错
export async function loadParams({ url = PARAMS_URL, fetch: f = globalThis.fetch } = {}) {
  if (typeof f !== 'function') return applyParams(null);
  try {
    const res = await f(url);
    if (!res || !res.ok) {
      const r = applyParams(null);
      r.used.errors.push(`读 ${url} 失败：HTTP ${res ? res.status : '无响应'}`);
      return r;
    }
    return applyParams(await res.json());
  } catch (e) {
    const r = applyParams(null);
    r.used.errors.push(`读 ${url} 失败：${e?.message || e}`);
    return r;
  }
}
