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

import { TYPES, MIX, PERSONAS, FAMILIAR_MIN } from './choice.js';
import { ANCHORS } from './calibrate.js';

export const PARAMS_URL = '/params/public/params.json';

// 每项的合法范围（超出就报错并用假设值；familiar 进 ln()，下限和 choice.js 用同一个常量）
const PERSONA_KEYS = {
  hurry: [0.05, 5],
  familiar: [FAMILIAR_MIN, 1],
  trust: [0, 3],
  queue_averse: [0, 5],
};
const MIX_TOL = 0.02;
const APPLIED = new WeakSet(); // applyParams 的结果打上记号：createEngine 只认这个，别的一律当 params.json 原文处理

const own = (o, k) => o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const inRange = (v, [lo, hi]) => v != null && v >= lo && v <= hi;

export const isApplied = x => x != null && typeof x === 'object' && APPLIED.has(x);

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
  const done = () => { const r = { ...out, used }; APPLIED.add(r); return r; };
  if (json == null || typeof json !== 'object' || Array.isArray(json)) {
    if (json != null) used.errors.push('params.json 不是对象');
    return done();
  }
  // 取一个数：{ value: 数 } 或直接写数。value 是 null / 没写 → 没找到（不算错）；写了但不是有限数（"0.05"、"3%"、true）→ 报错
  const num = (x, path) => {
    const v = x != null && typeof x === 'object' && !Array.isArray(x) ? x.value : x;
    if (v == null) return null;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    used.errors.push(`${path} = ${JSON.stringify(v)} 不是数`);
    return null;
  };
  const ignore = (obj, keep, prefix) => {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) used.ignored.push(...Object.keys(obj).filter(k => !keep.has(k)).map(k => prefix + k));
  };
  used.src = 'params';
  used.version = num(json.version, 'version');
  ignore(json, new Set(['version', 'mix', 'anchors', 'persona']), '');

  // 4 类人占比：整组要么全用，要么全不用（缺一类就没法归一）
  if (own(json, 'mix')) {
    ignore(json.mix, new Set(TYPES), 'mix.');
    const m = Object.fromEntries(TYPES.map(t => [t, own(json.mix, t) ? num(json.mix[t], `mix.${t}`) : null]));
    const sum = TYPES.reduce((s, t) => s + (m[t] ?? NaN), 0);
    if (!TYPES.every(t => inRange(m[t], [0, 1]))) used.errors.push('mix：4 类人要都有 0–1 之间的数');
    else if (!(Math.abs(sum - 1) <= MIX_TOL)) used.errors.push(`mix：加起来是 ${+sum.toFixed(3)}，不是 1`);
    else { for (const t of TYPES) out.mix[t] = m[t] / sum; used.mix = 'params'; }
  }

  // 两点校准的两个目标（要一起换：只换一个，A、B 就是按两套不同来源的数解出来的）
  if (own(json, 'anchors')) {
    ignore(json.anchors, new Set(['generic_warning_divert', 'named_route_divert']), 'anchors.');
    const lo = own(json.anchors, 'generic_warning_divert') ? num(json.anchors.generic_warning_divert, 'anchors.generic_warning_divert') : null;
    const hi = own(json.anchors, 'named_route_divert') ? num(json.anchors.named_route_divert, 'anchors.named_route_divert') : null;
    if (lo == null && hi == null) { /* 都没找到：用假设值，不算错 */ }
    else if (!(inRange(lo, [0.001, 0.999]) && inRange(hi, [0.001, 0.999]) && lo < hi)) used.errors.push('anchors：generic_warning_divert 和 named_route_divert 要都在 0–1 之间、前者小于后者');
    else { out.anchors = { lo, hi }; used.anchors = 'params'; }
  }

  // 每类人参数：逐项回退
  const P = own(json, 'persona') && json.persona && typeof json.persona === 'object' ? json.persona : null;
  if (P) {
    ignore(P, new Set(TYPES), 'persona.');
    const st = {};
    for (const t of TYPES) {
      const src = own(P, t) ? P[t] : null;
      if (!src || typeof src !== 'object') continue;
      const alias = !own(src, 'familiar') && own(src, 'route_familiarity'); // T12 #31 的叫法
      ignore(src, new Set([...Object.keys(PERSONA_KEYS), 'truck_only', 'sign_trust', ...(alias ? ['route_familiarity'] : [])]), `persona.${t}.`);
      for (const [k, range] of Object.entries(PERSONA_KEYS)) {
        const key = k === 'familiar' && alias ? 'route_familiarity' : k;
        if (!own(src, key)) continue;
        const v = num(src[key], `persona.${t}.${key}`);
        if (v == null) continue;
        if (!inRange(v, range)) { used.errors.push(`persona.${t}.${key} = ${v} 超出 ${range[0]}–${range[1]}`); continue; }
        out.personas[t][k] = v;
        used.persona[t][k] = 'params';
      }
      if (own(src, 'truck_only')) {
        const v = src.truck_only != null && typeof src.truck_only === 'object' ? src.truck_only.value : src.truck_only;
        if (typeof v === 'boolean') { out.personas[t].truck_only = v; used.persona[t].truck_only = 'params'; }
        else if (v != null) used.errors.push(`persona.${t}.truck_only = ${JSON.stringify(v)} 不是布尔`);
      }
      if (own(src, 'sign_trust')) {
        const v = num(src.sign_trust, `persona.${t}.sign_trust`);
        if (v == null) continue;
        if (!inRange(v, [0, 1])) { used.errors.push(`persona.${t}.sign_trust = ${v} 不在 0–1`); continue; }
        st[t] = v;
      }
    }
    // sign_trust（照屏走的比例）→ 相对倍数：在给了数的几类人里按占比加权取平均 = 1；至少 2 类才有「相对」可言。
    // 只补没直接给 trust 的类型；超过上限的截到上限（整组比例不变形得最少），不单独退回假设值
    const have = TYPES.filter(t => st[t] != null);
    if (have.length >= 2) {
      const w = have.reduce((s, t) => s + out.mix[t], 0);
      const mean = have.reduce((s, t) => s + out.mix[t] * st[t], 0) / (w || 1);
      if (mean > 0) {
        for (const t of have) {
          if (used.persona[t].trust === 'params') continue;
          let v = st[t] / mean;
          if (v > PERSONA_KEYS.trust[1]) { used.errors.push(`persona.${t}.sign_trust 换算后 ${+v.toFixed(3)}，截到 ${PERSONA_KEYS.trust[1]}`); v = PERSONA_KEYS.trust[1]; }
          out.personas[t].trust = v;
          used.persona[t].trust = 'sign_trust';
        }
      }
    } else if (have.length === 1) {
      used.errors.push(`persona.*.sign_trust：只有 ${have[0]} 有数，至少 2 类人才能换算成相对倍数`);
    }
  }
  used.ignored.sort();
  return done();
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
