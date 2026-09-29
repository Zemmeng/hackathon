// T22 按库存出 3 套方案：be.options(施工 | 方案) → 最省 / 标准 / 引导，每套都用引擎跑、带租金和库存检查。
// 真路网 + 真 equipment.json（按 URL 取文件的地方注入假的 fetch，不联网）。数字全由引擎算；哪套更少堵只记录，不硬断言
import { readFileSync, existsSync } from 'node:fs';
import { ok, t, done } from './_t.mjs';
import { connect, PATHS } from '../public/js/backend.js';
import { vmsTextOk, daysOf, resolveNeeds, hireOf, TIERS, tierNeeds, vmsRead } from '../public/js/options.js';
import { signsOn } from '../public/js/reading.js';
const clone = x => JSON.parse(JSON.stringify(x));

const APPS = new URL('../../', import.meta.url); // apps/
const file = p => new URL('.' + p, APPS);
const has = p => existsSync(file(p));
if (!has(PATHS.network) || !has(PATHS.equipment)) { ok(false, '找不到 apps/roads/public/cbd/network.json 或 equipment.json'); done(); }
const fakeFetch = async url => (existsSync(file(url)) ? { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file(url), 'utf8')) } : { ok: false, status: 404 });
const repoImporter = async url => { if (!existsSync(file(url))) throw new Error('404 ' + url); return import(file(url).href); };
const noImporter = async url => { throw new Error('404 ' + url); };
const INV = JSON.parse(readFileSync(file(PATHS.equipment), 'utf8'));
const stockOfItem = (inv, id) => inv.items.find(i => i.id === id)?.qty ?? 0;
const usedByItem = plan => {
  const m = new Map();
  for (const ws of plan.worksites) for (const e of ws.equipment || []) if (e.item) m.set(e.item, (m.get(e.item) || 0) + e.qty);
  return m;
};
const vmsOf = o => o.plan.worksites[0].equipment.find(e => e.type === 'vms');

const be = await connect({ fetch: fakeFetch, importer: noImporter });
const LON = be.demo('lonsdale');

await t('lonsdale：3 套方案的形状', async () => {
  const r = await be.options(LON);
  ok(r.options.map(o => o.id).join() === 'o1,o2,o3' && r.options.map(o => o.label).join() === 'Minimum,Standard,Guided', '三档 id / label 固定：o1 Minimum、o2 Standard、o3 Guided');
  ok(r.worksite === 'B-12' && r.when.hour === 8 && r.days === 5 && r.site.len_m > 0 && r.inventory.assumed === true, `配的是 B-12、8 点、租 ${r.days} 天、封闭 ${r.site.len_m} 米`);
  ok(r.options.every(o => be.validate(o.plan).length === 0 && o.plan.worksites[0].equipment.every(e => typeof e.item === 'string' && INV.items.some(i => i.id === e.item) && Number.isInteger(e.qty) && e.qty >= 1 && e.qty <= 500)),
    '每套 plan 引擎能跑；每件设备带 item（equipment.json 的 id）和 qty（1–500），pack.js 能按同一份方案报价');
  const [o1, o2, o3] = r.options;
  ok(!vmsOf(o1) && !o1.plan.worksites[0].equipment.some(e => e.type === 'arrow') && o1.plan.worksites[0].equipment.some(e => e.type === 'barrier') && o1.plan.worksites[0].equipment.some(e => e.text === 'END ROADWORK'),
    '最省：护栏 + 静态标志（含 END ROADWORK），没有 VMS、没有箭头板');
  ok(JSON.stringify(vmsOf(o2)?.frames) === '[["ROADWORK","AHEAD"]]' && o2.plan.worksites[0].equipment.some(e => e.type === 'arrow'), '标准：加箭头板 + 一块写 ROADWORK / AHEAD 的 VMS');
  ok(o3.flags.guided && vmsOf(o3).frames.flat().includes('USE') && vmsOf(o3).at_m === vmsOf(o2).at_m, `引导：同一位置（${vmsOf(o3).at_m} 米）的 VMS 点名最快绕行：${vmsOf(o3).frames.map(f => f.join(' / ')).join(' | ')}`);
  const barrier = o1.plan.worksites[0].equipment.find(e => e.type === 'barrier');
  const unit = INV.items.find(i => i.id === barrier.item).unit_len_m;
  ok(barrier.item === 'barrier_water' && barrier.qty === Math.ceil(r.site.len_m / unit), `护栏件数 = ⌈${r.site.len_m} 米 ÷ 每节 ${unit} 米⌉ = ${barrier.qty}`);
  ok(r.options.every(o => ['queue_m', 'delay_min', 'affected_min', 'mean_delay_s', 'detour_share'].every(k => Number.isFinite(o.result[k]) && o.result[k] >= 0) && !('raw' in o.result)),
    '每套的结果是引擎数字（排队、延误、绕行比例），不带 raw');
  ok(r.options.every(o => o.result.transit?.src && Number.isFinite(o.result.transit.pax_min)), '电车公交摘要带上（transit.json 加载了）');
});

await t('租金：件数 × 日租价 × 天数，标假设值（反向断言：不能不标）', async () => {
  const r = await be.options(LON);
  ok(daysOf({ from: '2026-10-05', to: '2026-10-09' }) === 5 && daysOf({ from: '2026-10-05', to: '2026-10-05' }) === 1 && daysOf(undefined) === 1, '天数 = 日历天数含两头；没写日期按 1 天');
  ok(r.options.every(o => o.hire.assumed === true && /assumed/i.test(o.hire.note) && o.flags.assumed.includes('hire.day_rate_aud') && o.flags.assumed.includes('stock.qty')), '每套 hire.assumed = true、note 写明假设值、flags.assumed 列出租金和库存（D-0929-1536）');
  ok(r.options.every(o => o.hire.lines.every(l => l.cost_aud === l.qty * l.day_rate_aud * l.days && l.days === 5) && o.hire.total_aud === o.hire.lines.reduce((s, l) => s + l.cost_aud, 0)), '每行 cost = qty × day_rate × days，total = 各行相加');
  ok(r.options.every(o => { const u = usedByItem(o.plan); return o.hire.lines.length === u.size && o.hire.lines.every(l => u.get(l.item) === l.qty); }), '报价行和方案里的设备一一对上（同一种设备合并成一行）');
  ok(r.options[1].hire.total_aud > r.options[0].hire.total_aud && r.options[1].vs.hire_aud === r.options[1].hire.total_aud - r.options[0].hire.total_aud, `标准比最省多 A$${r.options[1].vs.hire_aud}（VMS + 箭头板）`);
});

await t('不超库存（反向断言）', async () => {
  const r = await be.options(LON);
  ok(r.options.every(o => [...usedByItem(o.plan)].every(([id, q]) => q <= stockOfItem(INV, id)) && o.stock.ok && o.stock.short.length === 0), '真库存：每种设备件数 ≤ 库存，stock.ok');
  const tiny = clone(INV);
  const set = (id, q) => { tiny.items.find(i => i.id === id).qty = q; };
  set('barrier_water', 5); set('barrier_klemmfix', 0); set('barrier_steel', 0); set('arrow_board', 0); set('vms_a', 0); set('vms_c', 1);
  const be2 = await connect({ fetch: fakeFetch, importer: noImporter, equipment: tiny });
  const r2 = await be2.options(be2.demo('lonsdale'));
  ok(r2.options.every(o => [...usedByItem(o.plan)].every(([id, q]) => q <= stockOfItem(tiny, id))), '库存很少时每种设备件数照样 ≤ 库存（不硬塞）');
  const o3 = r2.options[2];
  ok(!o3.stock.ok && !o3.flags.ok && o3.stock.short.some(s => s.item === 'barrier_water' && s.got === 5 && s.need > 5) && o3.stock.short.some(s => s.item === 'arrow_board' && s.got === 0),
    `缺的写进 stock.short（护栏要 ${o3.stock.short.find(s => s.item === 'barrier_water')?.need} 件只有 5 件、箭头板 0 件），flags.ok = false`);
  ok(vmsOf(o3)?.item === 'vms_c' && !o3.plan.worksites[0].equipment.some(e => e.type === 'arrow'), 'A 类 VMS 没货 → 换 C 类；箭头板没货 → 方案里就不摆');
  set('vms_c', 0);
  const r3 = await (await connect({ fetch: fakeFetch, importer: noImporter, equipment: tiny })).options(LON);
  ok(!vmsOf(r3.options[2]) && r3.options[2].stock.short.some(s => s.equipment === 'VMS-1' && s.got === 0), 'VMS 全没货 → 引导档不摆 VMS，short 里记 VMS-1');
  const { equipment, short } = resolveNeeds([{ id: 'X', type: 'sign', at_m: 0, text: 'ROADWORK AHEAD', items: ['no_such_item'] }], INV);
  ok(equipment.length === 0 && short[0].why === 'not_in_inventory', '库存里没有的条目不摆，记 not_in_inventory');
  ok(hireOf([{ id: 'X', item: 'no_such_item', qty: 1 }], INV, 3).unpriced[0] === 'no_such_item', '对不上价格的设备列进 unpriced，不当 0 元');
  // 多件设备抢同一种库存：封车道 + 两侧人行道，水马 5 件、FOOTPATH CLOSED 1 块
  set('sign_footpath_closed', 1);
  const fpT = be.demo('lonsdale'); fpT.worksites[0].closes = { lanes: 1, footpath: 'both' };
  const o4 = (await (await connect({ fetch: fakeFetch, importer: noImporter, equipment: tiny })).options(fpT, { n: 1 })).options[0];
  ok([...usedByItem(o4.plan)].every(([id, q]) => q <= stockOfItem(tiny, id)), `几件设备抢同一种库存时合计照样 ≤ 库存：${JSON.stringify(Object.fromEntries(usedByItem(o4.plan)))}`);
  ok(['B-1', 'B-FL', 'B-FR', 'S-FR'].every(id => o4.stock.short.some(s => s.equipment === id)) && o4.stock.short.find(s => s.equipment === 'B-FL').got === 5 && !o4.flags.ok,
    '缺口逐件记：人行道先拿到 5 件水马，右侧人行道、车道护栏、第二块 FOOTPATH CLOSED 都进 stock.short');
});

await t('护栏分配：封人行道只用能封人行道的，先配人行道（反向断言）', async () => {
  const site = (len_m, footpath) => ({ len_m, lanes: 2, close_lanes: 1, full: false, footpath, missing: [] });
  const noWater = clone(INV); noWater.items.find(i => i.id === 'barrier_water').qty = 0;
  const a = resolveNeeds(tierNeeds(TIERS[0], {}, site(43, 'left')), noWater);
  ok(!a.equipment.some(e => e.id === 'B-FL') && a.short.some(s => s.equipment === 'B-FL' && s.item === 'barrier_water' && s.got === 0) && a.equipment.find(e => e.id === 'B-1')?.item === 'barrier_klemmfix',
    '水马没货：人行道不拿塑料隔板 / 钢护栏顶（can_close 没有 footpath），缺口进 short；车道照样用塑料隔板');
  const b = resolveNeeds(tierNeeds(TIERS[0], {}, site(300, 'left')), INV);
  ok(b.short.length === 0 && b.equipment.find(e => e.id === 'B-FL').item === 'barrier_water' && b.equipment.find(e => e.id === 'B-1').item === 'barrier_klemmfix' && b.equipment[0].id === 'B-1',
    '封 300 米 + 一侧人行道：人行道拿 150 件水马，车道改用塑料隔板，不误报缺货；输出顺序不变');
  const c = resolveNeeds(tierNeeds(TIERS[0], {}, site(150, 'both')), INV);
  ok(c.short.length === 0 && c.equipment.filter(e => e.item === 'barrier_water').reduce((n, e) => n + e.qty, 0) <= 200, '封 150 米 + 两侧人行道：真库存够，stock 不误报');
});

await t('END ROADWORK 不占读数名额：VMS 在远处也照样被读到（反向断言）', async () => {
  const site = { len_m: 43, lanes: 2, close_lanes: 1, full: false, footpath: 'both', missing: [] };
  const eq = tierNeeds(TIERS[2], {}, site, { vmsAt: 400, frames: [['ROADWORK', 'AHEAD'], ['USE', 'RUSSELL']] }).map(({ items, close, len_m, ...e }) => e);
  const seen = signsOn({ kmh: 40 }, { equipment: eq });
  ok(eq.some(e => e.text === 'END ROADWORK' && e.at_m < 0) && !seen.some(x => x.text === 'END ROADWORK') && seen.some(x => x.kind === 'vms' && x.m === 400) && seen.length === 6 && vmsRead(eq),
    '两侧人行道 + VMS 在 400 米：施工段末端的 END ROADWORK（at_m < 0）不进读数请求，上游 6 块都读到');
  ok(!vmsRead([...eq, { id: 'X', type: 'sign', at_m: 10, text: 'ROADWORK AHEAD' }]), '上游第 7 块牌把最远的 VMS 挤掉 → vmsRead = false');
  const fp = be.demo('lonsdale'); fp.worksites[0].closes = { lanes: 1, footpath: 'both' };
  const [, o2, o3] = (await be.options(fp)).options;
  ok(o2.flags.vms_read && o3.flags.vms_read, '两侧人行道：o2、o3 的 VMS 都进了读数请求（flags.vms_read）');
  ok(!o3.flags.guided || o3.result.queue_m !== o2.result.queue_m || o3.result.delay_min !== o2.result.delay_min, `两侧人行道：引导档点名了绕行，引擎结果就和标准档不同（o2 ${o2.result.queue_m} 米 · o3 ${o3.result.queue_m} 米）`);
  if (o3.flags.guided) {
    const far = clone(o3.plan); far.worksites[0].equipment.find(e => e.type === 'vms').at_m = 400;
    const s = await be.run(far);
    ok(s.queue_m !== o2.result.queue_m || s.delay_min !== o2.result.delay_min, `同一份引导方案 VMS 挪到 400 米照样起作用（${s.queue_m} 米，标准档 ${o2.result.queue_m} 米）`);
  }
});

await t('同一份方案里时间重叠的其他施工共用库存（反向断言）', async () => {
  const other = { ...clone(be.demo('latrobe').worksites[0]), id: 'C-1', time: clone(LON.worksites[0].time) };
  other.equipment = [...(other.equipment || []), { id: 'V-C', type: 'vms', at_m: 300, frames: [['ROADWORK', 'AHEAD']], item: 'vms_a', qty: 4 }];
  const two = { when: clone(LON.when), worksites: [clone(LON.worksites[0]), other] };
  const r = await be.options(two);
  ok(r.options.every(o => [...usedByItem(o.plan)].every(([id, q]) => q <= stockOfItem(INV, id))), '整份 plan 合计（含 C-1 带的 4 块 A 类 VMS）每种设备 ≤ 库存');
  ok(vmsOf(r.options[1]).item === 'vms_c' && r.options.every(o => o.stock.shared_with.includes('C-1')), 'A 类 VMS 被 C-1 占满 → 这处换 C 类；stock.shared_with 记 C-1');
  const later = clone(two); later.worksites[1].time = { from: '2026-11-02', to: '2026-11-03', hours: [7, 19] };
  const rl = await be.options(later);
  ok(vmsOf(rl.options[1]).item === 'vms_a' && rl.options.every(o => o.stock.shared_with.length === 0), '另一处施工不在同几天 → 不共用库存，照常用 A 类');
});

await t('引导档 VMS 文字合规范（反向断言）', async () => {
  const r = await be.options(LON);
  const f = vmsOf(r.options[2]).frames;
  ok(vmsTextOk(f) && f.length <= 2 && f.every(fr => fr.length <= 4 && fr.every(l => l.length <= 10 && l === l.toUpperCase())) && f.flat().join(' ').split(/\s+/).length <= 8, `≤ 2 帧 × ≤ 4 行 × ≤ 10 字符、≤ 8 个词、大写：${JSON.stringify(f)}`);
  ok(!vmsTextOk([['ROADWORKSAHEAD']]) && !vmsTextOk([['use', 'russell']]) && !vmsTextOk([['A'], ['B'], ['C']]) && !vmsTextOk([['ONE TWO', 'THREE FOUR', 'FIVE SIX', 'SEVEN'], ['EIGHT', 'NINE']]), 'vmsTextOk 拦得住：一行 14 字、小写、3 帧、9 个词');
  if (!has(PATHS.check)) { ok(true, '（跳过 T5 checkSigns：仓库里没有 apps/api/public/js/check.js）'); return; }
  const beT5 = await connect({ fetch: fakeFetch, importer: repoImporter });
  const r5 = await beT5.options(LON);
  ok(r5.options.every(o => o.flags.sign_errors.length === 0 && o.flags.failed === 0 && beT5.check(o.plan).every(c => c.ok)), 'T5 checkSigns 查三套都没错（含 END ROADWORK 静态牌），T5 读数一条没挂');
});

await t('同样输入同样输出、不改输入（确定性）', async () => {
  const input = be.demo('lonsdale');
  const before = JSON.stringify(input);
  const a = JSON.stringify(await be.options(input));
  const b = JSON.stringify(await be.options(input));
  const c = JSON.stringify(await (await connect({ fetch: fakeFetch, importer: noImporter })).options(input));
  ok(a === b && a === c, '同一个 be 调两次、新 connect 再调一次，输出逐字一样');
  ok(JSON.stringify(input) === before, '输入的方案没被改');
});

await t('哪套更少堵：只记录引擎的数，不硬断言', async () => {
  for (const name of be.demos) {
    const r = await be.options(be.demo(name));
    const line = r.options.map(o => `${o.id} 排队 ${o.result.queue_m} 米 · 全网 ${o.result.delay_min} 车·分 · A$${o.hire.total_aud}`).join('；');
    ok(true, `记录 ${name} ${r.when.hour} 点：${line}${r.options[2].flags.no_faster_detour ? '（没有更快的绕行，引导档屏上字同标准档）' : ''}`);
    const [, o2, o3] = r.options;
    ok(o3.flags.no_faster_detour ? JSON.stringify(vmsOf(o3).frames) === JSON.stringify(vmsOf(o2).frames) && !o3.flags.guided : o3.flags.guided, `${name}：没更快的绕行 ⇔ 引导档不点名（no_faster_detour = ${o3.flags.no_faster_detour}）`);
  }
});

await t('输入形式：单条施工、when、n、worksite', async () => {
  const ws = clone(LON.worksites[0]);
  const r = await be.options(ws);
  ok(r.when.date === ws.time.from && r.when.hour === 8, `只给施工 → 开工那天、时段里第一个采样小时（${r.when.date} ${r.when.hour} 点）`);
  const r17 = await be.options(ws, { when: { date: '2026-10-06', hour: 17 } });
  ok(r17.when.hour === 17 && r17.options.every(o => o.plan.when.hour === 17), '给了 when 就用它');
  ok((await be.options(LON, { n: 1 })).options.map(o => o.id).join() === 'o1' && (await be.options(LON, { n: 2 })).options.map(o => o.id).join() === 'o1,o2' && (await be.options(LON, { n: 9 })).options.length === TIERS.length, 'n = 1 / 2 / 9 → 1 / 2 / 3 套');
  const two = { when: LON.when, worksites: [clone(LON.worksites[0]), { ...clone(be.demo('latrobe').worksites[0]), id: 'C-1' }] };
  const rc = await be.options(two, { worksite: 'C-1' });
  ok(rc.worksite === 'C-1' && rc.options.every(o => JSON.stringify(o.plan.worksites[0]) === JSON.stringify(two.worksites[0])), '整份方案 + worksite 指定 → 只换那一条的设备，别的施工原样一起算');
  const bad = async (x, o) => { try { await be.options(x, o); return null; } catch (e) { return e.code; } };
  ok(await bad({ ...ws, links: [ws.links[0], 'no-such-link'] }) === 'bad_plan', '只有一部分路段不在路网 → 也是 bad_plan（不按 0 米少算护栏）');
  ok(await bad({ ...ws, time: { ...ws.time, from: '2026-10-09', to: '2026-10-05' } }) === 'bad_plan' && await bad({ ...ws, time: { ...ws.time, from: '2026-13-01' } }) === 'bad_plan'
    && await bad({ ...ws, time: { ...ws.time, hours: [] } }) === 'bad_plan' && await bad(ws, { when: { date: '2026-10-06', hour: null } }) === 'bad_plan',
    'from 晚于 to、日期不存在、hours 为空、when.hour 不是 0–23 → bad_plan（不再悄悄按 1 天、0 排队）');
  const off = await be.options(ws, { when: { date: '2026-10-06', hour: 3 } });
  ok(off.options.every(o => o.flags.inactive && !o.flags.ok), `施工在 when 那个小时不施工（3 点，时段 ${JSON.stringify(ws.time.hours)}）→ flags.inactive、flags.ok = false`);
  ok(await bad({ ...ws, links: ['no-such-link'] }) === 'bad_plan' && await bad({ ...ws, time: undefined }) === 'bad_plan' && await bad(two, { worksite: 'nope' }) === 'bad_plan' && await bad({ ...ws, closes: { lanes: 1, footpath: 'north' } }) === 'bad_plan',
    '路段不在路网、没 time 又没 when、指定的施工不存在、closes.footpath 写错 → bad_plan');
  const noInv = await connect({ fetch: async url => (url.endsWith('equipment.json') ? { ok: false, status: 404 } : fakeFetch(url)), importer: noImporter });
  ok(await (async () => { try { await noInv.options(LON); return null; } catch (e) { return e.code; } })() === 'no_inventory', '库存取不到 → 抛 no_inventory（不装作 0 元）');
});

await t('全封、封人行道', async () => {
  const full = be.demo('lonsdale'); full.worksites[0].closes = { lanes: 2 };
  const rf = await be.options(full);
  const eq = rf.options[1].plan.worksites[0].equipment;
  ok(rf.site.full && rf.options.every(o => o.flags.full_closure) && eq.some(e => e.item === 'sign_detour_straight') && !eq.some(e => e.type === 'arrow'), '全封：车道牌换成 DETOUR AHEAD，不摆箭头板，flags.full_closure');
  const fp = be.demo('lonsdale'); fp.worksites[0].closes = { lanes: 1, footpath: 'both' };
  const rp = await be.options(fp, { n: 1 });
  const e1 = rp.options[0].plan.worksites[0].equipment;
  const fb = e1.filter(e => e.type === 'barrier' && e.id.startsWith('B-F'));
  ok(fb.length === 2 && fb.every(e => INV.items.find(i => i.id === e.item).can_close.includes('footpath')) && e1.filter(e => e.item === 'sign_footpath_closed').length === 2, '两侧人行道：每侧一排能封人行道的护栏 + 一块 FOOTPATH CLOSED');
  ok(rp.options[0].result.peds && Number.isFinite(rp.options[0].result.peds.extra_min), `封了人行道 → 结果带行人绕行（多 ${rp.options[0].result.peds?.extra_min} 人·分钟）`);
});

done();
