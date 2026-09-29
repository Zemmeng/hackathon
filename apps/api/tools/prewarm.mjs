// prewarm.mjs —— 把演示要用的问答提前问好，写进随网页发布的答案文件（public/answers/answers.json）。
// 🔒 D-09：默认只列清单和花费（dry-run），--run 才花钱；--check 只自检不联网。真跑之前先报次数和花费、经 lead 同意。
// 用法：
//   node apps/api/tools/prewarm.mjs                                  列出要预热的卡、真调用次数、估算花费
//   node apps/api/tools/prewarm.mjs --cards out/cards.json           再加上引擎演示用的卡（node apps/engine/tools/demo.mjs --cards out/cards.json 生成）
//   node apps/api/tools/prewarm.mjs --check                          每张卡过 api 的校验，不联网
//   node apps/api/tools/prewarm.mjs --run --url https://<worker 地址>   逐张卡 × 4 类人问部署好的 Worker（key 只在 Cloudflare），
//                                                                    只收 src = llm / kv 的回答；4 类齐了才写进答案文件
// 退出码：0 正常；1 有卡不合规 / 真跑时出错；2 用法错误
import { readFileSync, writeFileSync } from 'node:fs';
import { CARDS } from './demo-cards.mjs';
import { validateCard } from '../src/app.js';
import { TYPES, validTypeAnswer } from '../public/js/rules.js';
import { cardKey } from '../public/js/cardkey.js';
import { parsePrompts } from '../src/prompts.js';

const RUNS = 3; // 与 src/app.js 一致：每类人问 3 次
const USD_PER_CALL = 0.02; // Opus 5.5 估算 ［待核］（docs/arch/5-llm-api-detail.pdf 第 4 页）；第一次真调用后用 usage 回填
const ANSWERS = new URL('../public/answers/answers.json', import.meta.url);

const args = process.argv.slice(2);
const flag = f => args.includes(f);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
for (const a of args) if (a.startsWith('--') && !['--cards', '--check', '--run', '--url'].includes(a)) { console.error(`❌ 不认识的参数 ${a}`); process.exit(2); }

const list = Object.entries(CARDS).map(([name, card]) => ({ name, card }));
if (val('--cards')) {
  const extra = JSON.parse(readFileSync(val('--cards'), 'utf8'));
  (Array.isArray(extra) ? extra : extra.cards || []).forEach((c, i) => list.push({ name: c.name || `extra-${i + 1}`, card: c.card || c }));
}
// 同一场景只问一次
const seen = new Set(), cards = [];
for (const x of list) { const k = await cardKey(x.card, 'dedupe'); if (!seen.has(k)) { seen.add(k); cards.push(x); } }

let bad = 0;
for (const x of cards) {
  const v = validateCard(x.card);
  if (!v.ok) { bad++; console.log(`❌ ${x.name}：${v.issues.map(i => i.code).join(', ')}`); }
}
const calls = cards.length * TYPES.length * RUNS;
console.log(`要预热 ${cards.length} 张场景卡 × ${TYPES.length} 类人 × 每类 ${RUNS} 次 = ${calls} 次真调用，估算约 ${(calls * USD_PER_CALL).toFixed(2)} 美元 ［待核］`);
for (const x of cards) console.log(`   · ${x.name}：${x.card.signs.map(s => (s.frames ? s.frames.map(f => f.join(' / ')).join(' | ') : s.text)).join(' ; ')}${x.card.queue_m ? `（排队 ${x.card.queue_m} 米）` : ''}`);
const promptV = parsePrompts(readFileSync(new URL('../prompts.md', import.meta.url), 'utf8')).version;
const current = JSON.parse(readFileSync(ANSWERS, 'utf8'));
if (Object.keys(current.entries || {}).length && current.prompt_v !== promptV) {
  bad++; console.log(`❌ 答案文件是 ${current.prompt_v} 的，prompts.md 已经是 ${promptV}：旧答案会被继续用，重跑 --run 覆盖`);
}
if (bad) process.exit(1);
if (flag('--check')) { console.log('✅ 全部场景卡通过 api 校验；答案文件的 prompt_v 和 prompts.md 一致（或还是空的）'); process.exit(0); }
if (!flag('--run')) { console.log('（dry-run：没有联网、没花钱。真跑：--run --url <Worker 地址>，先报次数和花费、经 lead 同意）'); process.exit(0); }

const url = (val('--url') || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(url)) { console.error('❌ --run 要配 --url https://<Worker 地址>'); process.exit(2); }
const file = JSON.parse(readFileSync(ANSWERS, 'utf8'));
let wrote = 0, model = file.model || '', runV = file.prompt_v;
for (const x of cards) {
  const by_type = {};
  for (const type of TYPES) {
    const res = await fetch(`${url}/api/persona`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, card: x.card }) });
    const j = await res.json().catch(() => null);
    if (!j || !j.ok || !['llm', 'kv'].includes(j.src) || !validTypeAnswer(j.answer, x.card)) {
      console.error(`❌ ${x.name} / ${type}：Worker 回的是 ${j?.src || res.status}${j?.fallback ? `（${j.fallback}）` : ''}，不是大模型的答案 —— MOCK 还开着、没选大模型或额度用完？停下`);
      process.exit(1);
    }
    if (model && j.model !== model) { console.error(`❌ 模型对不上：答案文件是 ${model}，Worker 回 ${j.model}；换模型要清空答案文件重来`); process.exit(1); }
    if (j.prompt_v !== file.prompt_v && Object.keys(file.entries).length) { console.log(`提示词已经从 ${file.prompt_v} 换到 ${j.prompt_v}：清掉旧答案`); file.entries = {}; }
    model = j.model; runV = file.prompt_v = j.prompt_v;
    by_type[type] = j.answer;
  }
  file.entries[await cardKey(x.card, runV)] = { name: x.name, by_type };
  wrote++;
}
Object.assign(file, { model, prompt_v: runV, generated: new Date().toISOString() });
writeFileSync(ANSWERS, JSON.stringify(file, null, 1) + '\n');
console.log(`✅ 写进 ${wrote} 张卡的答案（${model} / ${runV}）。记得把实际 usage 和花费记进 docs/3-tasks.md 的额度台账`);
