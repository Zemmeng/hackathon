// 参数入口测试：T12 的 params.json → 引擎（逐项回退、校准目标跟着变、读不到不抛错、不能改坏默认值）
import { ok, t, done, wsA, WHEN } from './_t.mjs';
import {
  applyParams, loadParams, PARAMS_URL, createEngine, makeGrid, mockReadSigns, calibrate, anchorRequest,
  TYPES, MIX, PERSONAS, ANCHORS,
} from '../public/js/index.js';

const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const snap = () => JSON.stringify({ MIX, PERSONAS, lo: ANCHORS.lo.real, hi: ANCHORS.hi.real });
const before = snap();
const v = x => ({ value: x, range: [x, x], source: 'test', confidence: 'low' });
const good = () => ({
  version: 1,
  mix: { commuter: v(0.4), local: v(0.3), tourist: v(0.1), delivery: v(0.2) },
  anchors: { generic_warning_divert: v(0.05), named_route_divert: v(0.25), stated_to_actual: v(0.2) },
  persona: {
    commuter: { hurry: v(1.2), familiar: v(0.5) },
    tourist: { familiar: v(null), trust: v(0.9) },
  },
  value_of_time: { car: v(20) },
  vms: {},
});

await t('applyParams：没有 / 不是对象 → 全用假设值', async () => {
  const d = applyParams(null);
  ok(d.used.src === 'default' && d.used.errors.length === 0 && JSON.stringify(d.mix) === JSON.stringify(MIX) && d.anchors.lo === ANCHORS.lo.real && d.anchors.hi === ANCHORS.hi.real, 'null → 假设值，不报错');
  ok(applyParams([1, 2]).used.src === 'default' && applyParams('x').used.errors.length === 1, '数组 / 字符串 → 假设值，记一条错');
});

await t('applyParams：合格的数照用，缺的逐项回退', async () => {
  const p = applyParams(good());
  ok(p.used.src === 'params' && p.used.version === 1 && p.used.mix === 'params' && near(p.mix.commuter, 0.4) && near(p.mix.delivery, 0.2), 'mix 用 params 的');
  ok(p.used.anchors === 'params' && p.anchors.lo === 0.05 && p.anchors.hi === 0.25, 'anchors 用 params 的');
  ok(p.personas.commuter.hurry === 1.2 && p.personas.commuter.familiar === 0.5 && p.used.persona.commuter.hurry === 'params', 'persona：给了的项用 params');
  ok(p.personas.commuter.trust === PERSONAS.commuter.trust && p.used.persona.commuter.trust === 'default', 'persona：没给的项用假设值');
  ok(p.personas.tourist.familiar === PERSONAS.tourist.familiar && p.personas.tourist.trust === 0.9 && p.used.errors.length === 0, 'value 是 null（没找到）→ 回退，不算错');
  ok(JSON.stringify(p.used.ignored) === JSON.stringify(['anchors.stated_to_actual', 'value_of_time', 'vms']), '引擎还不用的字段列在 ignored（带完整路径，含嵌套的 anchors.stated_to_actual）');
  ok(TYPES.every(t => near(applyParams({ mix: { commuter: 0.505, local: 0.25, tourist: 0.1, delivery: 0.15 } }).mix[t] * 1.005, [0.505, 0.25, 0.1, 0.15][TYPES.indexOf(t)], 1e-9)), 'mix 加起来 1.005（在容差里）→ 归一');
});

await t('applyParams：不合格的整组 / 单项回退并报错', async () => {
  const bad = applyParams({ mix: { commuter: 0.6, local: 0.3, tourist: 0.1, delivery: 0.15 } });
  ok(bad.used.mix === 'default' && JSON.stringify(bad.mix) === JSON.stringify(MIX) && /加起来/.test(bad.used.errors[0]), 'mix 加起来 1.15 → 整组用假设值');
  const miss = applyParams({ mix: { commuter: 0.5, local: 0.5, tourist: null, delivery: 0 } });
  ok(miss.used.mix === 'default' && miss.used.errors.length === 1, 'mix 缺一类 → 整组用假设值');
  const inv = applyParams({ anchors: { generic_warning_divert: 0.3, named_route_divert: 0.2 } });
  ok(inv.used.anchors === 'default' && inv.anchors.lo === ANCHORS.lo.real && inv.used.errors.length === 1, 'anchors 低点 ≥ 高点 → 用假设值');
  ok(applyParams({ anchors: { generic_warning_divert: v(null), named_route_divert: v(null) } }).used.errors.length === 0, 'anchors 两个都没找到 → 用假设值，不算错');
  const zero = applyParams({ persona: { local: { familiar: 0, hurry: -1, trust: 1.5 } } });
  ok(zero.personas.local.familiar === PERSONAS.local.familiar && zero.personas.local.hurry === PERSONAS.local.hurry && zero.personas.local.trust === 1.5 && zero.used.errors.length === 2, 'familiar = 0（进 ln 会炸）、hurry < 0 → 这两项回退，trust 照用');
  ok(applyParams({ persona: { delivery: { truck_only: { value: false } } } }).personas.delivery.truck_only === false, 'truck_only 布尔值照用');
  const rf = applyParams({ persona: { tourist: { route_familiarity: v(0.25) }, local: { familiar: 0.9, route_familiarity: 0.7 } } });
  ok(rf.personas.tourist.familiar === 0.25 && rf.used.persona.tourist.familiar === 'params' && rf.personas.local.familiar === 0.9, 'route_familiarity（T12 的叫法）= familiar；两个都给时用 familiar');
  ok(applyParams({ persona: { delivery: { truck_only: 'yes' } } }).personas.delivery.truck_only === true, 'truck_only 不是布尔 → 假设值');
});

await t('applyParams：sign_trust（照屏走的比例）→ 相对倍数', async () => {
  const st = { commuter: 0.4, local: 0.2, tourist: 0.6, delivery: 0.3 };
  const p = applyParams({ persona: Object.fromEntries(TYPES.map(t => [t, { sign_trust: v(st[t]) }])) });
  const mean = TYPES.reduce((s, t) => s + MIX[t] * st[t], 0);
  ok(TYPES.every(t => near(p.personas[t].trust, st[t] / mean) && p.used.persona[t].trust === 'sign_trust'), '4 类都有 → trust = sign_trust ÷ 按占比加权的平均');
  ok(near(TYPES.reduce((s, t) => s + MIX[t] * p.personas[t].trust, 0), 1), '换算后按占比加权的平均 = 1');
  const both = applyParams({ persona: { ...Object.fromEntries(TYPES.map(t => [t, { sign_trust: st[t] }])), local: { sign_trust: 0.2, trust: 0.7 } } });
  ok(both.personas.local.trust === 0.7 && both.used.persona.local.trust === 'params', '直接给了 trust 的类型不被 sign_trust 覆盖');
  const part = applyParams({ persona: { commuter: { sign_trust: 0.4 } } });
  ok(part.personas.commuter.trust === PERSONAS.commuter.trust && part.used.errors.length === 1, '只有一类有 sign_trust → 不换算，报一条');
});

await t('反向断言：params.json 不能塞进引擎不认识的类型、不能改坏默认值', async () => {
  const evil = JSON.parse('{"mix":{"commuter":0.5,"local":0.25,"tourist":0.1,"delivery":0.15,"hacker":0.9,"__proto__":{"polluted":1}},"persona":{"__proto__":{"hurry":{"value":9}},"hacker":{"hurry":2},"constructor":{"trust":2}}}');
  const p = applyParams(evil);
  ok(Object.keys(p.mix).sort().join() === [...TYPES].sort().join() && Object.keys(p.personas).sort().join() === [...TYPES].sort().join(), 'mix / personas 里只有 4 类人');
  ok(({}).polluted === undefined && ({}).hurry === undefined && p.personas.commuter.hurry === PERSONAS.commuter.hurry, '__proto__ 键不污染原型、不改任何一类人');
  applyParams(good());
  ok(snap() === before, 'MIX / PERSONAS / ANCHORS 本身没被改动（applyParams 返回副本）');
});

await t('审查确认的 8 条（review-params-correctness / interop）', async () => {
  const { network, flows } = makeGrid();
  const raw = { version: 1, used: ['VicRoads 2019'], mix: { commuter: v(0.5), local: v(0.25), tourist: v(0.1), delivery: v(0.15) } };
  const eu = createEngine({ network, flows, readSigns: mockReadSigns, params: raw });
  const planU = { when: WHEN, worksites: [wsA()] };
  await eu.prepare(planU);
  ok(eu.params.src === 'params' && eu.params.ignored.includes('used') && Number.isFinite(eu.evaluate(planU).delay_min) && eu.calib.ok, 'params.json 顶层恰好有 used 键：照样按原文处理，不崩');
  const str = applyParams({ anchors: { generic_warning_divert: v('0.05'), named_route_divert: v('0.25') }, persona: { commuter: { hurry: '1.5' } } });
  ok(str.used.anchors === 'default' && str.used.persona.commuter.hurry === 'default' && str.used.errors.filter(e => /不是数/.test(e)).length === 3, '值写成字符串 → 用假设值，但每个都报「不是数」');
  const clip = applyParams({ persona: { commuter: { sign_trust: 0.2 }, local: { sign_trust: 0.2 }, tourist: { sign_trust: 0.8 }, delivery: { sign_trust: 0.2 } } });
  ok(clip.personas.tourist.trust === 3 && clip.used.persona.tourist.trust === 'sign_trust' && near(clip.personas.commuter.trust, 0.2 / 0.26) && clip.used.errors.length === 1, 'sign_trust 换算超上限 → 截到 3（不退回假设值 1.1），报一条');
  const three = applyParams({ persona: { commuter: { sign_trust: 0.4 }, local: { sign_trust: 0.2 }, tourist: { sign_trust: v(null) }, delivery: { sign_trust: 0.3 } } });
  const w3 = MIX.commuter + MIX.local + MIX.delivery, m3 = (MIX.commuter * 0.4 + MIX.local * 0.2 + MIX.delivery * 0.3) / w3;
  ok(near(three.personas.commuter.trust, 0.4 / m3) && three.used.persona.tourist.trust === 'default' && three.personas.tourist.trust === PERSONAS.tourist.trust && three.used.errors.length === 0, '只有 3 类有 sign_trust：这 3 类照换算（在它们之间加权平均 = 1），第 4 类用假设值');
  ok(applyParams({ persona: { local: { familiar: 0.015 } } }).used.persona.local.familiar === 'default', 'familiar 下限和 choice.js 一致（0.02）：0.015 不收');
  const nest = applyParams({ mix: { commuter: 0.5, local: 0.25, tourist: 0.1, delivery: 0.15, visitor: 0.1 }, persona: { commuter: { speed: 1 }, pedestrian: {} } });
  ok(['mix.visitor', 'persona.commuter.speed', 'persona.pedestrian'].every(k => nest.used.ignored.includes(k)), '嵌套的不认识字段也列进 ignored（带路径）');
  const read = async which => Object.fromEntries(await Promise.all(TYPES.map(async t => [t, await mockReadSigns(anchorRequest(which, t))])));
  const lo = await read('lo'), hi = await read('hi');
  lo.tourist = { ...lo.tourist, advice: { 'La Trobe Street': 'avoid' }, trust: 0.2 };
  const c = calibrate(lo, hi, { anchors: { lo: 0.002, hi: 0.2 } });
  ok(c.ok === false && c.lo_detour > 0.003, `低点目标 0.2%、实际 ${c.lo_detour}（差一倍）→ ok = false（相对容差）`);
});

await t('loadParams：读得到就用，读不到不抛错', async () => {
  let asked = null;
  const r = await loadParams({ fetch: async url => { asked = url; return { ok: true, status: 200, json: async () => good() }; } });
  ok(asked === PARAMS_URL && PARAMS_URL === '/params/public/params.json' && r.used.src === 'params' && r.anchors.hi === 0.25, '默认读同源 /params/public/params.json');
  const nf = await loadParams({ fetch: async () => ({ ok: false, status: 404 }) });
  ok(nf.used.src === 'default' && /404/.test(nf.used.errors[0]), '404 → 假设值，errors 里写原因');
  const boom = await loadParams({ fetch: async () => { throw new Error('offline'); } });
  ok(boom.used.src === 'default' && /offline/.test(boom.used.errors[0]), '断网 → 假设值');
  const junk = await loadParams({ fetch: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }) });
  ok(junk.used.src === 'default' && /bad json/.test(junk.used.errors[0]), '不是 JSON → 假设值');
  ok((await loadParams({ fetch: null })).used.src === 'default', '没有 fetch（node 老版本）→ 假设值');
});

await t('createEngine({ params })：校准目标、占比、每类人参数都跟着 params 走', async () => {
  const { network, flows } = makeGrid();
  const plan = { when: WHEN, worksites: [wsA([['USE', 'RUSSELL ST']])] };
  const e0 = createEngine({ network, flows, readSigns: mockReadSigns });
  await e0.prepare(plan);
  ok(e0.params.src === 'default' && e0.calib.ok && near(e0.calib.hi_detour, 0.2, 1e-3), '不传 params → 假设值，校准到 3% / 20%');
  const e1 = createEngine({ network, flows, readSigns: mockReadSigns, params: good() });
  await e1.prepare(plan);
  ok(e1.params.src === 'params' && e1.params.mix.commuter === 0.4 && e1.params.personas.commuter.hurry === 1.2, 'engine.params 报出用的是哪组数');
  ok(e1.params.used.mix === 'params' && e1.params.used.anchors === 'params' && e1.params.used.persona.commuter.hurry === 'params' && e1.params.used.persona.local.hurry === 'default' && JSON.stringify(e1.params.ignored) === '["anchors.stated_to_actual","value_of_time","vms"]', 'engine.params.used 逐项报来源（params / default）');
  ok(e1.calib.ok && near(e1.calib.lo_detour, 0.05, 1e-3) && near(e1.calib.hi_detour, 0.25, 1e-3) && e1.calib.target.hi === 0.25, `校准目标换成 5% / 25%（A ${e1.calib.A}、B ${e1.calib.B}）`);
  const r0 = e0.evaluate(plan), r1 = e1.evaluate(plan);
  ok(r1.delay_min !== r0.delay_min && Number.isFinite(r1.delay_min), `结果跟着参数变（总延误 ${r0.delay_min} → ${r1.delay_min}）`);
  const e2 = createEngine({ network, flows, readSigns: mockReadSigns, params: applyParams(good()), mix: MIX });
  ok(e2.params.mix.commuter === MIX.commuter && e2.params.override.join() === 'mix', '显式传的 mix 优先于 params，override 里记着');
  e1.params.mix.commuter = 9;
  ok(e1.params.mix.commuter === 0.4, 'engine.params 返回副本，改了不影响引擎');
});

await t('calibrate：目标够不着时 ok = false', async () => {
  const read = async which => Object.fromEntries(await Promise.all(TYPES.map(async t => [t, await mockReadSigns(anchorRequest(which, t))])));
  const lo = await read('lo'), hi = await read('hi');
  ok(calibrate(lo, hi, { anchors: { lo: 0.03, hi: 0.2 } }).ok, '3% / 20% 够得着');
  ok(calibrate(lo, hi, { anchors: { lo: 0.03, hi: 0.999 } }).ok === false, '高点 99.9%：推荐力度顶到上限也到不了 → ok = false');
});

done();
