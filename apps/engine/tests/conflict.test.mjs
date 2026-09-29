// conflict.test.mjs —— T21 回归：单个施工不能让全网总延误变成负数（「封了路反而省时间」）。
// 根因：小街（Little Bourke St 等，20 km/h）平时比平行大街绕过去还慢；flows.json 是计数不是均衡，
// 引擎把封路后被挤去绕行的车算成「省了时间」。修法见 pipeline.js evaluate() 的 credit：多花的时间从「原路 / 绕行平时」快的那个算起。
// 真路网（apps/roads/public/cbd/）+ MOCK 读数，不联网、不花钱。
import { readFileSync, existsSync } from 'node:fs';
import { ok, t, done } from './_t.mjs';
import { createEngine, mockReadSigns, windowWhens, applyParams } from '../public/js/index.js';
import { demoPlan } from '../public/js/backend.js';

const dir = new URL('../../roads/public/cbd/', import.meta.url);
const pfile = new URL('../../params/public/params.json', import.meta.url);
const LB = 'l26034673_245532558'; // Little Bourke St，1 条车道（@jinmingq 报的那段）
const ws = (id, links, lanes) => ({ id, name: id, links, closes: { lanes }, time: { from: '2026-10-05', to: '2026-10-09', hours: [7, 19] },
  equipment: [{ id: 'V', type: 'vms', at_m: 200, frames: [['ROADWORK', 'AHEAD']] }] });

await t('T21 单个全封不出负延误', async () => {
  if (!existsSync(new URL('network.json', dir))) { ok(false, '找不到 apps/roads/public/cbd/network.json'); return; }
  const rn = JSON.parse(readFileSync(new URL('network.json', dir), 'utf8'));
  const rf = JSON.parse(readFileSync(new URL('flows.json', dir), 'utf8'));
  const params = existsSync(pfile) ? applyParams(JSON.parse(readFileSync(pfile, 'utf8'))) : applyParams(null);
  const eng = createEngine({ network: rn, flows: rf, readSigns: mockReadSigns, params });

  const b = ws('LB', [LB], 1);
  for (const hour of [8, 17]) {
    const plan = { when: { date: '2026-10-06', hour }, worksites: [b] };
    await eng.prepare(plan);
    const r = eng.evaluate(plan);
    const ap = r.approaches[0];
    ok(ap && ap.blocked && ap.routes.length > 0, `${hour} 点 Little Bourke St 全封：有绕行路线（${ap?.routes.map(x => x.name).join(' / ')}）`);
    ok(r.delay_min >= 0, `${hour} 点 Little Bourke St 单独全封，总延误 ${r.delay_min} ≥ 0（修前 8 点 −65、17 点 −100）`);
    ok(ap.routes.every(x => x.extra_min >= 0), `${hour} 点 每条绕行多花的时间都 ≥ 0（${ap.routes.map(x => x.extra_min).join(' / ')}）`);
    ok(Object.values(r.by_type).every(x => x.delay_min >= 0), `${hour} 点 每类人的延误都 ≥ 0`);
  }

  // 冲突成本：演示的 Lonsdale 施工 + Little Bourke 全封，同一周
  const a = demoPlan('lonsdale').worksites[0];
  const W = windowWhens([a, b]);
  await eng.prepare({ when: W[0], worksites: [a, b] }, { whens: W });
  const c = eng.conflict(a, b, { whens: W });
  ok(c.b >= 0, `conflict(lonsdale, Little Bourke).b = ${c.b} ≥ 0（修前 −825）`);
  ok(c.a > 0 && c.ab > 0, `A、A+B 都是正数（${c.a} / ${c.ab}）`);
  ok(c.cost === c.ab - c.a - c.b, `冲突成本 = D(A+B) − D(A) − D(B)（${c.cost}）`);

  // 同类小街（Little … St / Flinders Lane）8 点有车的路段逐个单独全封：一个负数都不许有
  const lanes = rn.links.filter(l => /^(Little |Flinders Lane)/.test(l.name || '') && (rf.days.wd[l.id]?.[8] ?? 0) > 50);
  const bad = [];
  for (const l of lanes) {
    const plan = { when: { date: '2026-10-06', hour: 8 }, worksites: [ws('X', [l.id], l.lanes)] };
    await eng.prepare(plan);
    const r = eng.evaluate(plan);
    if (r.delay_min < 0) bad.push(`${l.name} ${l.id} ${r.delay_min}`);
  }
  ok(lanes.length >= 10, `抽到 ${lanes.length} 段小街`);
  ok(!bad.length, `小街单独全封没有负延误${bad.length ? '：' + bad.slice(0, 5).join('；') : ''}`);
});

done();
