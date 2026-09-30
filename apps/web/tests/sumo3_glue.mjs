// T49（lead：屏上交通数字全用 SUMO，引擎退幕后）：6-engine.js 整个文件 + 6e-sumo3.js 在 node 里跑，假的 EP / SU / 引擎结果，
// 渲染 03（engPanel3 → sumoPanel3 / 依据 / 附近施工）、04 顾问（eng4HTML）、05 导出文字（engPlaybook）、01 检查（engMoreHTML），
// 断言 SUMO 方案上一个引擎的交通数字都不出现（918 / 509 / 10,493 / 18,693 / 33,015 / 79 m / 937 / 1,651 / 1,582），
// 别的方案照旧出引擎的数。由 tests/test_sumo_primary.py 调；每条断言打一行 ✅ / ❌，不联网。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const WEB = HERE + '../', APPS = WEB + '../';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('✅ ' + msg); } else { fail++; console.log('❌ ' + msg); } };

// 6-engine.js 顶层只有 BE.ready=import(...) 会动（连后端）：换成空 Promise，其余原样
const engSrc = readFileSync(WEB + 'src/js/6-engine.js', 'utf8');
const eng = engSrc.replace(/BE\.ready=import\([\s\S]*?\.then\(engAfterConnect\);/, 'BE.ready=Promise.resolve();');
ok(eng !== engSrc, '6-engine.js 的 BE.ready=import(...) 换掉了（不连后端）');
const s3 = readFileSync(WEB + 'src/js/6e-sumo3.js', 'utf8');

const SUMO_LINK = 'l595594354_9756035316';
const stubs = `
const LANG={cur:'en'};const L=(en,zh)=>LANG.cur==='zh'?zh:en;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const CITY={x0:-1150,x1:750,y0:-950,y1:450};
const S={step:3,ui:3,booted:true,layers:{works:true}};
const SUMO_LINK='${SUMO_LINK}';
const SU={index:null,src:{source:'baked'},busy:false,scen:'original',seed:42};
const navHTML=()=>'<div class="cta"></div>';
const sumoImpactHTML=()=>'';
const aiPlanSrc=()=>({src:'llm',tone:'ok',rule:false});
const aiSrcLabel=s=>'LLM · '+s;
const sumoReason=k=>'reason:'+k;
let wentTo=0;const goStep=n=>{wentTo=n;};
const toast=()=>{},renderPanel=()=>{},vlAfterRun=()=>{},gridRebuild=()=>{},cmpRender=()=>{};
`;
const ctx = {};
vm.createContext(ctx);
vm.runInContext(stubs + eng + '\n' + s3 + `
;globalThis.G={EP,BE,SU,S,LANG,engPanel3,eng4HTML,engPlaybook,engMoreHTML,engSumFor,sumoPanel3,sumo3Evidence,sumo3Clash,sumo3Eng4,sumo3Playbook,sumo3More,sumoPlanOn,sumo3Held,sumo3Win,sumo3Scen,sumo3P,sumo3Cur};`, ctx);
const G = ctx.G, { EP, BE, SU, LANG } = G;

// ---- 假数据：引擎（这些数一个都不能出现在 SUMO 方案上）----
const BAD = ['918', '509', '10,493', '10493', '18,693', '18693', '33,015', '33015', '79 m', '937', '1,651', '1651', '1,582', '1582'];
const leaks = h => BAD.filter(x => String(h).includes(x));
const bt = (v, d) => ({ vehicles: v, per_capita_min: 33.015, detour: d, informed: .7 });
const SUM = {
  street: 'Lonsdale Street', when: { hour: 8 }, queue_m: 918, mean_delay_s: 509, delay_min: 10493, detour_share: .14, vehicles: 1144, blocked_vph: 0,
  routes: [{ id: 'stay', name: 'Lonsdale Street', share: .86, now_min: 12.3, usual_min: 3.1 }, { id: 'r1', name: 'Russell Street', share: .14, now_min: 4.2, usual_min: 4.0 }],
  by_type: { commuter: bt(500, .14), local: bt(300, .14), tourist: bt(200, .14), delivery: bt(144, .14) },
  approaches: [{ volume: 1144, by_type: { commuter: { detour: .14, informed: .7 }, local: { detour: .14, informed: .7 }, tourist: { detour: .14, informed: .7 }, delivery: { detour: .14, informed: .7 } } }], main: 0,
  hot: [{ id: 'h1', name: 'Spring Street', extra_min: 18693, queue_m: 918 }],
  flags: { ok: true, params: 'params', reading_src: 'llm' }, why: { commuter: 'x' },
  transit: { src: 'gtfs', routes: [{ mode: 'tram', short: '86', headsign: 'Docklands', trips_h: 12, pax_h: 1000, delay_s: 509, links: [] }], pax_min: 33015, trips_h: 12, pax_h: 1000, blocked_routes: 0, assumed: { pax_per_trip: { tram: 80, bus: 30 } } },
  peds: { src: 'x', footpath: 'left', closed: ['w1'], ped_h: 937, detour_m: 79, crossings: 1, extra_min: 1651, measured: true, assumed: { walk_mps: 1.3 } },
  raw: { links: [{ id: SUMO_LINK, v: 1144, cap: 810 }] },
};
const ADV = { src: 'rule', flags: { ok: true, missing: 0, failed: 0 }, window: { single_hour: false, whens: 30 },
  options: [{ kind: 'text', frames: [['USE', 'RUSSELL'], ['SAVE', '9 MIN']], why: 'Name the fastest detour (Russell Street) and the 9 min it saves, 18693 veh·min.', delta_min: -94920, better: true, plan: { worksites: [] } },
    { kind: 'shift', days: 5, why: 'removes about 33015 extra vehicle-minutes', delta_min: -600, better: true, plan: { worksites: [] } }] };
const CMP = { before: { queue_m: 918, mean_delay_s: 509, detour_share: .14, delay_min: 18693, street: 'Lonsdale Street', transit: { src: 'x', pax_min: 33015 }, flags: { ok: true, params: 'params' } },
  after: { queue_m: 79, mean_delay_s: 47, detour_share: .53, delay_min: 1651, street: 'Lonsdale Street', transit: { src: 'x', pax_min: 937 }, flags: { ok: true, params: 'params' } },
  delta: { queue_m: -839, mean_delay_s: -462, detour_share: .39, delay_min: -17042, street: 'Lonsdale Street', main_changed: false } };
// ---- 假数据：SUMO，T48 一小时字段（index.json 的形状）----
const met = (o) => Object.assign({ vehicles: 6400, completed: 14300, collisions: 0, emergency_braking: 1, mean_timeloss_s: 217.2, works_queue_mean_m: 158.9, works_capacity_assumption_vph: 810, works_demand_vph: 1100 }, o);
const IDX = { version: 2, engine: 'Eclipse SUMO sumo 1.27.1', seed: 42, hour: 8, works: { link: SUMO_LINK, lanes_closed: 1 },
  params: { p_original: 0.14, p_ai: 0.53, hour_window: [8, 9], shown_s: 3600, green_2935: 0.5, works_lane_speed_kmh: 30, network_links: 356, demand_veh_per_h: 15677 },
  assumptions: { en: ['Model cross-check, not a field measurement.'], zh: ['模型之间的交叉检验，不是实测。'] },
  scenarios: [
    { id: 'baseline', diversion_share: 0, metrics: met({ works_queue_end_m: 22.7, works_queue_equiv_end_m: 15.2, works_throughput_vph: 1161, detour_vehicles: 0, works_queue_max_m: 152.1, works_traffic_extra_s: null }) },
    { id: 'original', label: { en: 'Original plan · ROADWORK AHEAD', zh: '原方案 · ROADWORK AHEAD' }, diversion_share: 0.14, metrics: met({ works_queue_end_m: 245.8, works_queue_equiv_end_m: 973.1, works_queue_equiv_end_vehicles: { lonsdale_albert: 22.2, side_streets: 15.0, waiting_to_enter: 240.8 }, works_throughput_vph: 805, works_traffic_extra_s: 533.3, mean_extra_s: 38.6, detour_vehicles: 73, works_queue_max_m: 373.2 }) },
    { id: 'ai', label: { en: 'AI plan · USE RUSSELL', zh: 'AI 方案 · USE RUSSELL' }, diversion_share: 0.53, metrics: met({ works_queue_end_m: 260.0, works_queue_equiv_end_m: 304.6, works_queue_equiv_end_vehicles: { lonsdale_albert: 7.6, side_streets: 1.0, waiting_to_enter: 78.4 }, works_throughput_vph: 788, works_traffic_extra_s: 396.4, mean_extra_s: 39.8, detour_vehicles: 287, works_queue_max_m: 278.2 }) }] };

const base = () => Object.assign(EP, { link: SUMO_LINK, lanes: 1, lanesMax: 2, all: false, street: 'Lonsdale Street', dir: 'W', hour: 8, f1: 'ROADWORK\nAHEAD', f2: '', sign: 'RIGHT LANE CLOSED',
  tab3: 'net', view3: 'traffic', badText: false, runErr: null, busy: false, sum: JSON.parse(JSON.stringify(SUM)), adv: JSON.parse(JSON.stringify(ADV)), advBusy: false, pick: 0, cmp: JSON.parse(JSON.stringify(CMP)), cmpBusy: false, mix: null });
BE.api = { engine: null }; LANG.cur = 'en';

// 1 纯函数
ok(G.sumo3Held(IDX.scenarios[1].metrics) === 278 && G.sumo3Held(IDX.scenarios[2].metrics) === 87, '被拦住的车 = works_queue_equiv_end_vehicles 加起来（原方案 278、AI 方案 87）');
ok(G.sumo3Held({ works_queue_equiv_end_m: 973.1 }) === 278, '没有车数字段 → round(works_queue_equiv_end_m × 2 / 7) = 278');
ok(G.sumo3Held({ works_held_end: 301, works_queue_equiv_end_m: 973.1 }) === 301, '有 works_held_end 就用它');
ok(G.sumo3Held({ works_queue_max_m: 160 }) === null, '反向：老的 12 分钟数据没有这些字段 → null（不编）');
ok(JSON.stringify(G.sumo3Win(IDX)) === '[8,9]' && JSON.stringify(G.sumo3Win({ hour: 17 })) === '[17,18]', 'SUMO 的小时：hour_window，否则 index.hour 起 1 小时');
ok(G.sumo3Scen(IDX, .14, '') === 'original' && G.sumo3Scen(IDX, .5, '') === 'ai' && G.sumo3Scen(IDX, null, 'USE RUSSELL') === 'ai' && G.sumo3Scen(IDX, null, 'ROADWORK AHEAD') === 'original',
  '跟方案对应的 SUMO 情景：按这份方案 AI 读牌的绕行比例找最近的；没有读数时屏上写 Russell = AI 方案，默认原方案');

// 2 SUMO 方案 · 03 交通：没跑 SUMO → 卡片 + 去第 2 步的按钮
base(); SU.index = null;
ok(G.sumoPlanOn(), 'Lonsdale 封 1 条道 = SUMO 方案');
let h = G.engPanel3();
ok(h.includes('Run SUMO in step 2 first') && h.includes('data-sumo3-go="2"') && h.includes('data-view3="traffic"'), '没跑过 SUMO：03 显示「Run SUMO in step 2 first」+ 去第 2 步的按钮，页签还在');
ok(!leaks(h).length, `反向：没跑 SUMO 时 03 也不出引擎的数（漏了 ${leaks(h).join(', ')}）`);

// 3 SUMO 方案 · 03 交通：T48 一小时数据，预先跑好的
SU.index = IDX; SU.src = { source: 'baked', reason: 'network', seed: 42 };
h = G.engPanel3();
ok(h.includes('At 09:00, 278 vehicles are held up by the works; the queue on Lonsdale St is 246 m'), '标题：At 09:00, 278 vehicles are held up by the works; the queue on Lonsdale St is 246 m');
ok(['805', '+533', '>73<', '373'].every(x => h.includes(x)), '四块：通过施工段 805 veh/h、每车多花 +533 s、绕行 73 辆、最长排队 373 m');
ok(h.includes('SUMO · pre-computed · seed 42') && h.includes('reason:network'), '来源：预先跑好的 · seed 42 + 原因');
ok(h.includes('<tr class="cur"><th scope="row" style="white-space:nowrap" title="Original plan · ROADWORK AHEAD">Original</th>') && h.includes('<th scope="row" style="white-space:nowrap" title="AI plan · USE RUSSELL">AI plan</th>') && h.includes('>87<') && h.includes('<td>260</td>') && h.includes('>287<'), '原方案 vs AI 方案两行，同一组指标，当前方案那行标出来');
ok(h.includes('SUMO’s input') && h.includes('<b>14%</b>') && h.includes('<b>53%</b>'), 'AI 读牌的绕行比例写明是 SUMO 的输入（14% / 53%）');
ok(h.includes('not covered by SUMO') && !/<p class="[^"]*\bmuted\b[^"]*"[^>]*>Trams, buses/.test(h), '电车 / 公交 / 行人：SUMO 暂不覆盖（不带 muted，简洁模式也看得到）');
ok(!leaks(h).length, `反向：03 交通页一个引擎的数都没有（漏了 ${leaks(h).join(', ')}）`);
ok(!/engine/i.test(h.replace(/data-[a-z0-9-]+="[^"]*"/g, '')), '反向：03 交通页不提引擎（不和引擎的数比）');
ok(!h.includes('Live engine'), '反向：页头不挂「引擎实时」');
SU.src = { source: 'live', elapsedMs: 15234, seed: 7 };
ok(G.engPanel3().includes('Cloud SUMO · computed live · 15.2 s · seed 7'), '来源：云端现场计算 · 15.2 s · seed 7');
EP.sum.detour_share = .53;
h = G.engPanel3();
ok(h.includes('At 09:00, 87 vehicles are held up by the works; the queue on Lonsdale St is 260 m') && h.includes('<tr class="cur"><th scope="row" style="white-space:nowrap" title="AI plan · USE RUSSELL">AI plan</th>'), '方案的牌读成 53% 绕行 → 显示 AI 方案那次（87 辆、260 m）');
EP.sum.detour_share = .30;
ok(G.engPanel3().includes('nearest SUMO run'), '方案的比例和两次都差得远 → 说明显示的是最接近的一次');
base(); LANG.cur = 'zh';
h = G.engPanel3();
ok(h.includes('09:00 时，被施工拦住的车有 278 辆；Lonsdale St 上排队 246 米') && h.includes('SUMO 暂不覆盖'), '中文：标题和「SUMO 暂不覆盖」');
ok(!leaks(h).length, `反向：中文 03 也没有引擎的数（漏了 ${leaks(h).join(', ')}）`);
LANG.cur = 'en';

// 4 老数据（12 分钟、没有一小时字段）：用有的字段，不出引擎的数
const OLD = JSON.parse(readFileSync(APPS + 'sumo/public/real/index.json', 'utf8'));
SU.index = OLD; SU.src = { source: 'baked', seed: OLD.seed };
const oldHour = OLD.scenarios.some(s => s.metrics && s.metrics.works_queue_end_m != null);
h = G.engPanel3();
ok(oldHour ? h.includes('held up by the works') : h.includes('-minute run the works queue on Lonsdale St reaches'), `仓库里的 SUMO 数据（${oldHour ? '一小时' : '12 分钟'}）也能画：${oldHour ? '一小时标题' : '退回「最长排队」标题'}`);
ok(!leaks(h).length, `反向：老数据 03 也没有引擎的数（漏了 ${leaks(h).join(', ')}）`);
SU.index = IDX; SU.src = { source: 'baked', seed: 42 };

// 5 03 依据 / 附近施工
base(); EP.view3 = 'evidence';
h = G.engPanel3();
ok(h.includes('What SUMO’s numbers rest on') && h.includes('50% green') && h.includes('not covered by SUMO') && h.includes('Model cross-check'), '依据页：SUMO 的数据和假设（2935 绿灯 50%、SUMO 暂不覆盖、运行自带的假设）');
ok(!leaks(h).length && !h.includes('veh/h arrive'), `反向：依据页不出引擎的数（漏了 ${leaks(h).join(', ')}）`);
EP.view3 = 'clash'; h = G.engPanel3();
ok(h.includes('not covered by SUMO') && !/clash cost/i.test(h) && !leaks(h).length, '附近施工页：说 SUMO 不覆盖叠加，没有叠加冲突的数');

// 6 04 顾问
base(); h = G.eng4HTML();
ok(h.includes('USE / RUSSELL') && h.includes('SAVE / 9 MIN'), '04 顾问：建议的屏上文字留着（USE / RUSSELL ▸ SAVE / 9 MIN）');
ok(h.includes('computed by SUMO') && h.includes('14%') && h.includes('53%') && h.includes('id="applyBtn"') && h.includes('data-opt="0"'), '04 顾问：说效果由下面 SUMO 的表算；绕行比例 14% → 53% 标为 AI 读牌 / SUMO 输入；「用到我的方案上」还在');
ok(!leaks(h).length && !h.includes('veh·h') && !h.includes('data-optwhy'), `反向：04 顾问没有 918 → 79 m、509 → 47 s、10,493、18,693 → 1,651、−1,582 veh·h（漏了 ${leaks(h).join(', ')}）；不写顾问引擎算的理由`);
EP.pick = 1; h = G.eng4HTML();
ok(!leaks(h).length && h.includes('does not score a shift'), '04 顾问选了错开日期：不出叠加的车·分钟');

// 7 05 导出文字、01 检查、地图用的 engSumFor
base(); const pb = G.engPlaybook();
ok(pb[0].includes('Traffic impact (SUMO') && pb[0].includes('278 vehicles held up') && pb[0].includes('not covered by SUMO') && pb[1].includes('SUMO 暂不覆盖'), '05 导出：SUMO 的数 + 不覆盖的说明（中英）');
ok(!leaks(pb.join('\n')).length, `反向：05 导出文字没有引擎的数（漏了 ${leaks(pb.join('\n')).join(', ')}）`);
h = G.engMoreHTML();
ok(h.includes('SUMO’s input') && h.includes('not covered by SUMO') && !h.includes('veh/h arrive') && !h.includes('rider·min') && !leaks(h).length, '01 检查：只有 AI 读牌（读懂 70%、绕行 14% = SUMO 输入），没有引擎的流量 / 通行能力 / 分钟数');
ok(G.engSumFor('now') === null && G.engSumFor('before') === null, '地图：SUMO 方案上 engSumFor 给 null（不画引擎排队 / 涟漪 / 绕行 / 标签）');

// 8 别的方案照旧：引擎的数都在
base(); EP.link = 'l_other'; EP.sum.raw.links[0].id = 'l_other'; SU.index = IDX;
ok(!G.sumoPlanOn(), '别的路段不是 SUMO 方案');
h = G.engPanel3();
ok(h.includes('918') && h.includes('509') && h.includes('10,493'), '别的方案：03 照旧是引擎的数（918 m、509 s、10,493）');
h = G.eng4HTML();
ok(h.includes('918 m') && h.includes('79 m') && h.includes('1,582') && h.includes('18,693'), '别的方案：04 顾问照旧（918 → 79 m、−1,582 veh·h、18,693）');
ok(G.engPlaybook()[0].includes('queue 918 m'), '别的方案：05 导出照旧是引擎的数');
ok(G.engMoreHTML().includes('veh/h arrive') && G.engSumFor('now') === EP.sum, '别的方案：01 检查和地图照旧');
EP.link = SUMO_LINK; EP.all = true; EP.lanes = 2;
ok(!G.sumoPlanOn() && G.engPanel3().includes('918'), '反向：Lonsdale 全封不是 SUMO 方案（SUMO 只跑了封 1 条道），照旧出引擎的数');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
