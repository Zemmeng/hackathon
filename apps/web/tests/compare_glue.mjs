// T23 方案对比（src/js/8-compare.js 的 pure:begin…pure:end）+ 真的 backend.js / 顾问 + T5 的 pack.js 执行包，全在 node 里跑。
// 由 tests/test_compare.py 调：node tests/compare_glue.mjs；每条断言打一行 ✅ / ❌，不联网
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const WEB = HERE + '../';
const APPS = WEB + '../';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('✅ ' + msg); } else { fail++; console.log('❌ ' + msg); } };
const pure = f => { const m = readFileSync(WEB + 'src/js/' + f, 'utf8').match(/\/\* pure:begin[^\n]*\n([\s\S]*?)\/\* pure:end \*\//); ok(!!m, `${f} 有 pure:begin / pure:end 段`); return m ? m[1] : ''; };

const ctx = {};
vm.createContext(ctx);
vm.runInContext(pure('6-engine.js') + '\n' + pure('8-compare.js') + '\n;globalThis.G={planFrom,cmpSources,cmpNumbers,cmpBest,cmpVms,CMP_MAX};', ctx);
const { planFrom, cmpSources, cmpNumbers, cmpBest, cmpVms, CMP_MAX } = ctx.G;

// 1 选哪几套来比（纯函数）
const P = { worksites: [{ id: 'W-1', links: ['x'], equipment: [{ id: 'VMS-1', type: 'vms', at_m: 300, frames: [['ROADWORK', 'AHEAD'], ['USE', 'RUSSELL ST']] }] }] };
const adv = { options: [
  { kind: 'shift', plan: P, days: 5 },
  { kind: 'text', plan: P, frames: [['USE', 'RUSSELL ST']] },
  { kind: 'move', plan: null, skipped: 'no_vms' },
  { kind: 'move', plan: P, equipment: 'VMS-1', at_m: 450 },
  { kind: 'text', plan: P, frames: [['A']] },
] };
const src = cmpSources(P, adv);
ok(CMP_MAX === 3 && src.length === 3, '最多 3 套');
ok(src.map(x => x.id).join('') === 'ABC' && src[0].kind === 'now', '第一套是表单里现在的方案，编号 A B C');
ok(!src.some(x => x.kind === 'shift'), '错开日期不进对比（它按整个施工期算，不是这一小时）');
ok(src[1].kind === 'text' && src[2].kind === 'move' && src[2].at_m === 450, '跳过没方案的改法（skipped / plan 为空）');
ok(cmpSources(P, null).length === 1, '顾问没结果时只有 A');
ok(cmpVms(P) === 'ROADWORK / AHEAD  ▸  USE / RUSSELL ST' && cmpVms({ worksites: [{ equipment: [] }] }) === '', 'VMS 每一帧用 / 连、帧之间 ▸；没有 VMS 给空串');

// 2 数字和「最少」标记（纯函数）
ok(JSON.stringify(cmpNumbers(null)) === '{"car":null,"transit":null,"peds":null}', '没算出来 → 全 null');
ok(cmpNumbers({ delay_min: 12, transit: { src: null }, peds: { src: 'peds', extra_min: 0 } }).transit === null, '没有公交数据 → null（不是 0）');
ok(cmpNumbers({ delay_min: 12, transit: { src: null }, peds: { src: 'peds', extra_min: 0 } }).peds === 0, '人行道照常 → 行人 0');
const b = cmpBest([{ car: 10, hire: 5 }, { car: 4, hire: 5 }, { car: 4, hire: null }], ['car', 'hire', 'peds']);
ok(JSON.stringify(b.car) === '[1,2]', '并列最少的都标');
ok(!('hire' in b), '两套一样多：不标');
ok(!('peds' in b), '都没有这个数：不标');

// 3 真路网：页面默认方案（只写 ROADWORK / AHEAD）→ 顾问 → 逐套 run() → pack.js 执行包
const file = p => APPS + p.replace(/^\//, '');
const fakeFetch = async url => (existsSync(file(url)) ? { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file(url), 'utf8')) } : { ok: false, status: 404 });
const importer = async url => { if (!existsSync(file(url))) throw new Error('404 ' + url); return import(pathToFileURL(file(url)).href); };
const { connect } = await import(pathToFileURL(APPS + 'engine/public/js/backend.js').href);
const be = await connect({ fetch: fakeFetch, importer });
const EP = { link: 'l595594354_9756035316', street: 'Lonsdale Street', lanes: 1, hour: 8, f1: 'ROADWORK\nAHEAD', f2: '', vmsAt: 300, sign: 'RIGHT LANE CLOSED', signAt: 100, arrowAt: 60, foot: 'none' };
const plan = planFrom(EP);
const a = await be.advise(plan);
const rows = cmpSources(plan, a);
ok(rows.length >= 2, `Lonsdale 早 8 点：顾问给出可比的改法，共 ${rows.length} 套`);
for (const r of rows) r.s = await be.run(r.plan);
const nums = rows.map(r => cmpNumbers(r.s));
ok(nums.every(n => Number.isFinite(n.car) && n.car > 0), `每套都有车延误：${nums.map(n => Math.round(n.car)).join(' / ')} 车·分钟`);
ok(nums.every(n => n.transit !== null && n.peds !== null), '电车公交、行人都有数（数据都加载上了）');
const best = cmpBest(nums, ['car']);
ok(best.car && !best.car.includes(0), `顾问的改法车延误比现在的方案少（最少的是 ${best.car && best.car.map(i => rows[i].id).join(',')}）`);

const packUrl = APPS + 'api/public/js/pack.js', exUrl = APPS + 'api/public/js/explain.js';
if (!existsSync(packUrl) || !existsSync(exUrl)) {
  console.log('⏭ 跳过执行包一节：没有 apps/api 的 pack.js / explain.js');
} else {
  const pack = await import(pathToFileURL(packUrl).href), ex = await import(pathToFileURL(exUrl).href);
  const inventory = await pack.loadInventory({ fetch: fakeFetch });
  const net = be.engine.net, ws = rows[1].plan.worksites[0];
  const links = new Map(ws.links.map(id => [id, net.links.get(id)]));
  const q = pack.quote(ws, inventory, { links });
  ok(q.total_aud > 0 && q.days === 5 && q.unmatched.length === 0, `选定方案的租金：A$${q.total_aud}（5 天，设备都对上了库存）`);
  const impacts = ex.optionFromRun(rows[1].id, 'plan', rows[1].s).metrics;
  const p = pack.buildPack({ ...ws, title: ws.name, status: 'decided', decision: { option: rows[1].id, by: 'council', reason: 'shorter queue', at: '2026-09-30T00:00:00.000Z' } }, { inventory, links, impacts });
  const zh = pack.packText(p, 'zh'), en = pack.packText(p, 'en');
  ok(/选 B（市政，2026-09-30）：shorter queue/.test(zh), '执行包写上选了 B、谁选的、理由');
  ok(/假设值，以 RPM Hire 正式报价为准/.test(zh) && /assumptions; RPM Hire's formal quote applies/.test(en), '反向断言：执行包里写明日租价是假设值');
  ok(/Frame 1:/.test(en) && /Lonsdale Street/.test(en), '执行包有 VMS 排程和路名');
  ok(p.notify.some(n => n.who === 'transit'), '有电车公交乘客受影响 → 通知运营方');
}

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
