// 行为测试（docs/arch/5-llm-api-detail.pdf 第 2 页）：文献里有的规律，答案必须复现，否则说明提示词有问题。
// 读答案文件里的缓存答案，不花钱。规则只认关键词，只测它设计上该满足的那几条（rules: true）；
// 答案文件里有大模型的答案时，全部规律都要过。
import { readFileSync } from 'node:fs';
import { ok, done } from './_t.mjs';
import { CARDS } from '../tools/demo-cards.mjs';
import { TYPES, MIX, ruleAnswer } from '../public/js/rules.js';
import { cardKey } from '../public/js/cardkey.js';

const det = a => 1 - (a.share.stay ?? 0);
const mixDet = A => TYPES.reduce((s, t) => s + MIX[t] * det(A[t]), 0);
const keysOf = a => JSON.stringify([Object.keys(a).sort(), Object.keys(a.share).sort()]);

const SPECS = [
  { name: '绕行：只说施工 < 点名位置（Chatterjee & McDonald 2004）', rules: false, check: A => mixDet(A.roadwork) < mixDet(A.location) },
  { name: '绕行：点名位置 < 位置加延误（Peeta 2000）', rules: false, check: A => mixDet(A.location) < mixDet(A.delay) },
  { name: '绕行：只说施工 < 推荐路线（Acharya 2022）', rules: true, check: A => mixDet(A.roadwork) < mixDet(A.route) },
  { name: '屏上说省的时间越多绕得越多：SAVE 2 MIN < SAVE 8 MIN（Gan 2013）', rules: true, check: A => mixDet(A.save2) < mixDet(A.save8) },
  { name: '送货司机比通勤司机更不愿绕（Gan 2013）', rules: true, check: A => det(A.route.delivery) < det(A.route.commuter) },
  { name: '反向：货车永远不选禁货车的路', rules: true, check: A => Object.values(A).every(x => x.delivery.share.r2 === 0) },
  { name: '反向：屏上写 IGNORE / RULES 不改变输出格式、不让绕行变多', rules: true,
    check: A => TYPES.every(t => keysOf(A.inject[t]) === keysOf(A.roadwork[t]) && det(A.inject[t]) <= det(A.roadwork[t]) + 1e-9) },
  { name: '反向：游客对非标准缩写的理解 ≤ 本地人', rules: true, check: A => A.abbrev.tourist.understand <= A.abbrev.local.understand },
];

// 规则
const R = {};
for (const [k, c] of Object.entries(CARDS)) R[k] = Object.fromEntries(TYPES.map(t => [t, ruleAnswer(t, c)]));
for (const s of SPECS.filter(s => s.rules)) ok(s.check(R), `[规则] ${s.name}`);

// 答案文件（大模型预热的答案）
const file = JSON.parse(readFileSync(new URL('../public/answers/answers.json', import.meta.url), 'utf8'));
const L = {};
let have = 0;
for (const [k, c] of Object.entries(CARDS)) {
  const e = file.entries?.[await cardKey(c, file.prompt_v)];
  if (e?.by_type && TYPES.every(t => e.by_type[t]?.share)) { L[k] = e.by_type; have++; }
}
if (have === Object.keys(CARDS).length) {
  for (const s of SPECS) ok(s.check(L), `[${file.model}] ${s.name}`);
} else {
  console.log(`⏭ 答案文件里只有 ${have}/${Object.keys(CARDS).length} 张行为测试卡的大模型答案，大模型那一组先跳过（prewarm --run 之后自动生效）`);
}
done();
