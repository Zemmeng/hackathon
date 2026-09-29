// 用途：不开浏览器，用 node 把整小时仿真跑完，核对进场量、确定性、施工前后的差别和信号配时
// 用法：node tests/sim.test.mjs（test.sh 会自动跑）；最后一行固定「N passed, M failed」
import { readFileSync } from 'node:fs';
import { Sim, HOUR, sigState, walkOn, hashStr } from '../public/js/sim.js';

const data = JSON.parse(readFileSync(new URL('../public/demand/demand_2921.json', import.meta.url), 'utf8'));
let P = 0, F = 0;
const ok = (cond, msg) => { if (cond) { P++; console.log('✅ ' + msg); } else { F++; console.log('❌ ' + msg); } };
const run = (hour, day, wz) => { const s = new Sim({ data, hour, day, wz, seed: hashStr(day + ':' + hour) }); while (s.t < HOUR) s.step(); return s; };
const near = (got, want, tol) => want === 0 ? got === 0 : Math.abs(got - want) / want <= tol;

const base17 = run(17, 'wd', false), wz17 = run(17, 'wd', true);
const b = base17.summary(), w = wz17.summary();

// 1. 进场量对得上数据（Poisson 到达有波动：车 / 自行车 / 行人 ±12%，电车 ±20%）
for (const [k, tol] of [['car', 0.12], ['bike', 0.12], ['ped', 0.12], ['tram', 0.2]]) {
  ok(near(b.spawned[k], b.expected[k], tol), `工作日 17 点 ${k} 进场 ${b.spawned[k]}，数据 ${Math.round(b.expected[k])}（±${tol * 100}%）`);
}
// 2. 没有 NaN / 负速度
ok(base17.agents.every(a => Number.isFinite(a.s) && Number.isFinite(a.v) && a.v >= 0), '跑完一小时所有 agent 的位置和速度都是有限值且速度不为负');
// 3. 同一个 seed 结果完全一样
ok(JSON.stringify(run(17, 'wd', false).summary()) === JSON.stringify(b), '同一个 seed 跑两遍，summary 完全一样');
// 4. 正常情况下车和自行车不在同一车道，没有「同车道逼近」事件；左转车在 B 段能被放行，路口不死锁
ok(!b.byLabel['汽车逼近同车道自行车'], '正常情况：没有汽车逼近同车道自行车的事件');
ok(b.outside === 0, `正常情况：一小时结束时没有车排到画面外（实际 ${b.outside}）`);
// 5. 施工：到达完全相同，但西行排队、画面外的车、冲突都不会更少，且出现同车道逼近事件
ok(w.spawned.ped === b.spawned.ped, '施工和正常两次的行人到达完全相同（只有施工不同）');
ok(w.outside > b.outside, `施工后排到画面外的车更多（${b.outside} → ${w.outside}）`);
ok(w.conflicts >= b.conflicts && (w.byLabel['汽车逼近同车道自行车'] || 0) > 0, `施工后冲突不少于正常（${b.conflicts} → ${w.conflicts}），且出现同车道逼近事件`);
// 6. 凌晨 3 点几乎没人：没有排到画面外的车
const n3 = run(3, 'wd', false).summary();
ok(n3.outside === 0 && n3.conflicts <= 3, `凌晨 3 点：画面外 ${n3.outside} 辆，冲突 ${n3.conflicts} 次`);
// 7. 信号配时：A 段 Swanston 绿、La Trobe 红；东侧人行横道只在 A 段前 21 秒放行
ok(sigState('A', 10) === 'G' && sigState('C', 10) === 'R' && sigState('AB', 40) === 'G' && sigState('A', 40) === 'R', '信号：10 秒时 A 绿 C 红，40 秒时 A 已红而左转（AB）仍绿');
ok(walkOn('E', 5) && !walkOn('E', 25) && walkOn('W', 25) && walkOn('N', 60), '行人灯：东侧 5 秒放行、25 秒不放行；西侧 25 秒仍放行；北侧 60 秒放行');

console.log(`${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);
