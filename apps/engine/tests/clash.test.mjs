// clash.test.mjs —— T21：backend.js 的 clash() / stagger()（叠加冲突上页面，D-0929-2011 ②）。
// 真路网（apps/roads/public/cbd/）+ 引擎规则读数，按 URL 取文件的地方注入假的 fetch，不联网、不花钱。
// 施工对：Lonsdale 演示（B-12）+ 登记表预置的 Little Bourke St 全封（W-LTLBOURKE，封在 Lonsdale 的绕行路线上，重叠 3 天）。
import { readFileSync, existsSync } from 'node:fs';
import { ok, t, done } from './_t.mjs';
import { connect, demoPlan, PATHS } from '../public/js/backend.js';
import { SEED_WORKSITES } from '../../api/public/js/worksites-seed.js';

const APPS = new URL('../../', import.meta.url);
const file = p => new URL('.' + p, APPS);
if (!existsSync(file(PATHS.network))) { ok(false, '找不到 apps/roads/public/cbd/network.json'); done(); }
const fakeFetch = async url => (existsSync(file(url)) ? { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file(url), 'utf8')) } : { ok: false, status: 404 });
const noImporter = async url => { throw new Error('404 ' + url); };
const clone = x => JSON.parse(JSON.stringify(x));
// 登记表的「施工」→ 引擎的 §施工方案（和 apps/api/public/js/worksites.js 的 toEngineWorksite 同样的字段）
const seed = id => { const s = SEED_WORKSITES.find(w => w.id === id); return { id: s.id, name: s.title, links: [...s.links], closes: { lanes: s.closes.lanes }, time: clone(s.time), equipment: clone(s.equipment) }; };
const nonNeg = r => ['a', 'b', 'ab', 'cost'].every(k => Number.isFinite(r[k]) && r[k] >= 0);

await t('T21 clash / stagger', async () => {
  const be = await connect({ fetch: fakeFetch, importer: noImporter });
  ok(typeof be.clash === 'function' && typeof be.stagger === 'function', 'connect() 带 clash / stagger');
  const A = demoPlan('lonsdale').worksites[0], B = seed('W-LTLBOURKE');

  // 1 Lonsdale + Little Bourke：有限、≥ 0、可信，且等于引擎 conflict() 的定义
  const c = await be.clash(A, B);
  ok(c.overlap.from === '2026-10-07' && c.overlap.to === '2026-10-09' && c.overlap.days === 3, `重叠 ${c.overlap.from} → ${c.overlap.to}，${c.overlap.days} 天`);
  ok(c.whens === 6 && c.hours.join(',') === '8,17', `时间窗 = 重叠 3 天 × 早晚高峰 8、17 点（${c.whens} 个时刻，${c.hours}）`);
  ok(nonNeg(c) && c.cost > 0 && c.flags.reliable && !c.flags.negative_delay && !c.flags.substitutes, `冲突成本 ${c.cost} 车·分钟 > 0、可信（A ${c.a} / B ${c.b} / A+B ${c.ab}）`);
  ok(c.cost === c.ab - c.a - c.b, '冲突成本 = D(A+B) − D(A) − D(B)');
  const eng = be.engine.conflict(A, B, { whens: [{ date: '2026-10-07', hour: 8 }, { date: '2026-10-07', hour: 17 }, { date: '2026-10-08', hour: 8 }, { date: '2026-10-08', hour: 17 }, { date: '2026-10-09', hour: 8 }, { date: '2026-10-09', hour: 17 }] });
  ok(eng.cost === c.cost && eng.ab === c.ab, `和引擎 engine.conflict() 同一个数（没另写一套算法）：${eng.cost}`);
  ok(c.flags.reading_src === 'rule' && c.flags.failed === 0, `读数来源 ${c.flags.reading_src}、失败 ${c.flags.failed}`);

  // 2 整份方案也能传；plan 进出不被改
  const plan = demoPlan('lonsdale'), snap = JSON.stringify(plan);
  const c2 = await be.clash(plan, { when: plan.when, worksites: [B] });
  ok(c2.cost === c.cost && JSON.stringify(plan) === snap, '传整份方案 = 传施工，方案不被改');

  // 3 不重叠 → 0，不跑引擎
  const far = { ...B, time: { from: '2026-11-01', to: '2026-11-03', hours: [7, 19] } };
  const c3 = await be.clash(A, far);
  ok(c3.cost === 0 && c3.whens === 0 && c3.overlap.days === 0 && c3.flags.reliable, '时段不重叠：冲突成本 0、没有采样时刻');

  // 4 一键错开：往后挪到不重叠就停，冲突成本 → 0；同一段时间比，省下的就是冲突成本
  const st = await be.stagger(A, B);
  ok(st.best && st.best.cost === 0 && st.best.days === 3 && st.best.reliable, `错开 +${st.best?.days} 天 → 冲突成本 ${st.best?.cost}`);
  ok(st.tries.map(x => x.days).join(',') === '1,2,3' && st.tries[0].cost > st.tries[1].cost && st.tries[1].cost > 0, `逐天试，碰到 0 就停：${st.tries.map(x => `+${x.days}:${x.cost}`).join(' ')}`);
  ok(st.period.ab_before - st.period.ab_after === c.cost && st.best.ab === st.period.ab_after, `整段时间全网延误 ${st.period.ab_before} → ${st.period.ab_after}，少的正好是冲突成本`);
  ok(st.worksite.time.from === '2026-10-10' && B.time.from === '2026-10-07', '返回挪好的施工，原施工不被改');
  const st2 = await be.stagger(A, B, { maxDays: 7, back: true });
  ok(st2.tries.map(x => x.days).join(',').startsWith('1,-1,2') && st2.best.cost === 0, `back: true 顺序 +1, −1, +2 …（${st2.tries.map(x => x.days).join(',')}）`);

  // 5 同样输入同样结果
  const again = await be.clash(A, B), stAgain = await be.stagger(A, B);
  ok(JSON.stringify(again) === JSON.stringify(c) && JSON.stringify(stAgain) === JSON.stringify(st), '确定性：再算一遍逐字一样');

  // 6 反向断言：Flinders St 基线车流超过通行能力（#58），单独封就算出负延误 → 页面字段不许出现负数、标不可信
  const F = (id, link) => ({ id, name: id, links: [link], closes: { lanes: 1 }, time: { from: '2026-10-05', to: '2026-10-09', hours: [7, 19] }, equipment: [] });
  const fa = F('FA', 'l591392087_5880339363'), fb = F('FB', 'l1833110268_1833110277');
  const cf = await be.clash(fa, fb);
  ok(cf.raw.a < 0 || cf.raw.b < 0 || cf.raw.ab < 0 || cf.raw.cost < 0, `Flinders St 原始数有负的（A ${cf.raw.a} / B ${cf.raw.b} / A+B ${cf.raw.ab} / 冲突 ${cf.raw.cost}）`);
  ok(!cf.flags.reliable && cf.flags.negative_delay && !cf.flags.substitutes && cf.cost === 0 && nonNeg(cf), `→ reliable = false、negative_delay、显示字段全 ≥ 0、冲突成本显示 0（${cf.a} / ${cf.b} / ${cf.ab} / ${cf.cost}）`);
  const sf = await be.stagger(fa, fb, { maxDays: 5 });
  ok(sf.tries.every(x => x.cost >= 0) && sf.period.ab_before >= 0 && sf.period.ab_after >= 0, '错开的每一步和整段时间的数也都 ≥ 0');
  ok(sf.tries.slice(0, -1).every(x => !x.reliable && x.cost === 0) && sf.best.days === sf.tries.at(-1).days && sf.best.overlap_days === 0 && sf.best.reliable,
    `还重叠的每一步都不可信、不当 best，挪到不重叠（+${sf.best.days}）才停（${sf.tries.map(x => `+${x.days}:${x.cost}${x.reliable ? '' : '?'}`).join(' ')}）`);
  ok(!sf.period.reliable, '挪之前本来就不可信 → period.reliable = false（整段时间的前后对比不拿来说事）');

  // 6b 三个 D 都 ≥ 0、只有 D(A+B) < D(A) + D(B)（同一走廊互相替代）→ 冲突成本显示 0，标 substitutes，仍可信，不说「基线超通行能力」
  const S = { id: 'SUB', name: 'SUB', links: [A.links[0]], closes: { lanes: 1 }, time: clone(A.time), equipment: [] };
  const cs = await be.clash(A, S);
  ok(cs.raw.cost < 0 && [cs.raw.a, cs.raw.b, cs.raw.ab].every(x => x >= 0), `原始冲突成本 < 0、三个 D 都 ≥ 0（A ${cs.raw.a} / B ${cs.raw.b} / A+B ${cs.raw.ab} / 冲突 ${cs.raw.cost}）`);
  ok(cs.cost === 0 && nonNeg(cs) && cs.flags.substitutes && !cs.flags.negative_delay && cs.flags.reliable, '→ cost 显示 0、substitutes = true、negative_delay = false、reliable = true');

  // 6c 错开时不可信的尝试（被清成 0）不能冒充「清零了」：B 再并一条 Flinders St 路段，+1 天那一步不可信，best 要取后面可信的
  const BF = { ...B, id: 'W-LTLBOURKE-F', links: [...B.links, 'l591392087_5880339363'] };
  const sb = await be.stagger(A, BF, { maxDays: 3 });
  ok(sb.tries.some(x => !x.reliable) && sb.best.reliable && sb.tries.filter(x => x.reliable).every(x => x.cost >= sb.best.cost),
    `best 取可信的尝试：+${sb.best.days} 天 cost ${sb.best.cost}（${sb.tries.map(x => `+${x.days}:${x.cost}${x.reliable ? '' : '?'}`).join(' ')}）`);
  ok(sb.period.reliable === (sb.base.flags.reliable && sb.best.reliable && sb.period.ab_before >= 0 && sb.period.ab_after >= 0 && !sb.period.failed), `period.reliable 跟着 base / best 走（${sb.period.reliable}）`);

  // 6d 读屏失败（带 .code 的错，引擎按「没人被说动」算）→ flags.failed > 0、reliable = false，页面不显示那个数
  const failing = async () => { const e = new Error('读屏失败（测试）'); e.code = 'test_fail'; throw e; };
  const beF = await connect({ fetch: fakeFetch, importer: noImporter, readSigns: failing });
  const cx = await beF.clash(A, B);
  ok(cx.flags.failed > 0 && !cx.flags.reliable && !cx.flags.negative_delay, `读屏失败 ${cx.flags.failed} 条 → reliable = false`);

  // 7 输入不对就抛，不悄悄算成 0
  let threw = 0;
  try { await be.clash(A, null); } catch { threw++; }
  try { await be.clash(A, { ...B, time: undefined }); } catch { threw++; }
  try { await be.clash(A, { ...B, closes: { lanes: 1, footpath: 'up' } }); } catch (e) { if (e.code === 'bad_plan') threw++; }
  ok(threw === 3, '缺施工 / 缺 time（又没给 when）/ 施工不合格（validate）→ 抛错');
});

done();
