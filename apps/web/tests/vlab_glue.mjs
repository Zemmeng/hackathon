// T45 VMS 试验台：src/js/6d-vmslab.js 的纯函数段（vlab-pure:begin…end）+ 6-engine.js 的 planFrom()，在真路网上跑 backend.js。
// 由 tests/test_vlab.py 调：node tests/vlab_glue.mjs；每条断言打一行 ✅ / ❌，不联网。数字只记录不钉死，断言的是关系
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const WEB = HERE + '../', APPS = WEB + '../';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('✅ ' + msg); } else { fail++; console.log('❌ ' + msg); } };

const block = (f, tag) => { const m = readFileSync(WEB + 'src/js/' + f, 'utf8').match(new RegExp(`/\\* ${tag}:begin[^\\n]*\\n([\\s\\S]*?)/\\* ${tag}:end \\*/`)); ok(!!m, `${f} 有 ${tag}:begin / ${tag}:end 段`); return m ? m[1] : ''; };
const ctx = {};
vm.createContext(ctx);
vm.runInContext(block('6-engine.js', 'pure') + '\n' + block('6d-vmslab.js', 'vlab-pure') + '\n;globalThis.G={planFrom,parseFrame,vlRoad,vlCands,vlBest,vlBestShare,vlText,VL_AT,VL_WARN};', ctx);
const { planFrom, vlRoad, vlCands, vlBest, vlBestShare, vlText, VL_AT, VL_WARN } = ctx.G;

// 1 路名 → 屏上一行（≤ 10 字符），太长给 null，不从词中间截断
ok(vlRoad('Russell Street') === 'RUSSELL' || vlRoad('Russell Street') === 'RUSSELL ST', `Russell Street → ${vlRoad('Russell Street')}`);
ok(vlRoad('Little Lonsdale Street') === null && vlRoad('') === null, '反向断言：去掉 Street 还超 10 字符（LITTLE LONSDALE）→ null，不截成半个词');

// 2 真路网：页面默认方案（Lonsdale 西行 8 点，VMS 在上游 300 米）
const file = p => APPS + p.replace(/^\//, '');
const fakeFetch = async url => (existsSync(file(url)) ? { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file(url), 'utf8')) } : { ok: false, status: 404 });
const importer = async url => { if (!existsSync(file(url))) throw new Error('404 ' + url); return import(pathToFileURL(file(url)).href); };
const { connect } = await import(pathToFileURL(APPS + 'engine/public/js/backend.js').href);
const be = await connect({ fetch: fakeFetch, importer });
const ws0 = be.demo('lonsdale').worksites[0];
const EP = { link: ws0.links[0], street: 'Lonsdale Street', hour: 8, lanes: 1, all: false, foot: 'none', f1: 'ROADWORK\nAHEAD', f2: '', vmsAt: 300, sign: 'RIGHT LANE CLOSED', signAt: 100, arrowAt: 60, time: null };
const plan = (frames, at) => planFrom({ ...EP, f1: frames[0].join('\n'), f2: (frames[1] || []).join('\n'), vmsAt: at == null ? EP.vmsAt : at });
const b = await be.run(plan(VL_WARN));
const cands = vlCands(b), ks = cands.map(c => c.k);
ok(ks[0] === 'base' && ks.includes('vague') && ks.includes('avoid') && ks.includes('use') && ks.includes('save'), `候选文案：${cands.map(c => vlText(c.frames)).join(' | ')}`);

// 3 反向断言：屏上的分钟数不能比引擎算的多
const stay = b.routes.find(r => r.id === 'stay'), alts = b.routes.filter(r => r.id !== 'stay').sort((x, y) => x.now_min - y.now_min);
const save = cands.find(c => c.k === 'save'), delay = cands.find(c => c.k === 'delay');
const minOf = c => +/(\d+) MIN/.exec(c.frames.flat().join(' '))[1];
ok(save && save.road === alts[0].name && minOf(save) === Math.round(stay.now_min - alts[0].now_min), `SAVE 的分钟数 = 引擎的原路 ${stay.now_min} 分 − ${alts[0].name} ${alts[0].now_min} 分（屏上写 ${save && minOf(save)}）`);
ok(!delay || minOf(delay) === Math.round(b.mean_delay_s / 60), `DELAYS 的分钟数 = 引擎的每车多等 ${b.mean_delay_s} 秒取整到分钟`);
ok(cands.every(c => c.frames.length <= 2 && c.frames.every(f => f.length <= 3 && f.every(l => l.length <= 10))), '每条候选 ≤ 2 帧 × ≤ 3 行 × ≤ 10 字符');

// 4 每条都过 T5 检查、逐条跑引擎；推荐 = 排队最短且比基准短
const rows = [];
for (const c of cands) {
  const p = plan(c.frames), chk = be.check(p);
  ok(chk.every(x => x.ok) && !chk.some(x => (x.warnings || []).some(w => w.code === 'long_line' || w.code === 'many_lines')), `「${vlText(c.frames)}」过 T5 检查，没有超长 / 超行警告`);
  const s = c.k === 'base' ? b : await be.run(p);
  rows.push({ ...c, q: s.queue_m, share: s.detour_share });
}
const bi = vlBest(rows), base = rows[0];
console.log('   ' + rows.map(r => `${vlText(r.frames)} → ${r.q} m`).join(' · '));
ok(bi >= 0 && rows[bi].q === Math.min(...rows.map(r => r.q)) && rows[bi].q < base.q, `推荐「${bi >= 0 && vlText(rows[bi].frames)}」排队 ${bi >= 0 && rows[bi].q} m，最短且比基准 ${base.q} m 短`);
ok(rows.find(r => r.k === 'vague').q >= rows.find(r => r.k === 'use').q, '空话（EXPECT DELAYS）不比点名绕行路好');
ok(vlBest([{ k: 'base', frames: VL_WARN, q: 100 }, { k: 'vague', frames: [['EXPECT', 'DELAYS']], q: 100 }]) === -1, '反向断言：没有写法比基准短 → 不推荐（-1）');
ok(vlBest([{ k: 'base', frames: VL_WARN, q: 500 }, { k: 'save', frames: [['USE', 'RUSSELL'], ['SAVE', '9 MIN']], q: 90 }, { k: 'use', frames: [['USE', 'RUSSELL']], q: 90 }]) === 2, '一样短时推荐字少的');

// 5 摆放：推荐的字放在 VL_AT 各处；拐口之后（at ≤ turn_m）来不及拐，不比 300 米好
const w = rows[bi], spots = [];
for (const at of VL_AT) { const s = await be.run(plan(w.frames, at)); spots.push({ at, q: s.queue_m, share: s.detour_share }); }
console.log('   ' + spots.map(p => `${p.at} m → ${p.q} m`).join(' · ') + ` · 拐口 ${w.turn_m} m`);
const late = spots.filter(p => Number.isFinite(w.turn_m) && p.at <= w.turn_m), far = spots.find(p => p.at === 300);
ok(Number.isFinite(w.turn_m) && late.length >= 1 && late.every(p => p.q > far.q), `摆在拐口（${w.turn_m} m）之后的 ${late.map(p => p.at + ' m').join('、')} 排队比 300 m 长：司机看到时已经过了路口`);

// 6 T49（lead D-0930「SUMO 为主，引擎退幕后」）：SUMO 覆盖的方案（Lonsdale 这段、封 1 条道）上，试验台每行不写引擎的排队米数，
//   改成「AI 读牌 → 会绕行的司机」（SUMO 的输入）；标题 / 说明写效果由第 2 步的 SUMO 算；推荐改叫「绕行信号最强」，不说排队。
//   页面真的 6d-vmslab.js 整个文件（vlHTML / vlSuHTML）+ 6-engine.js 的格式化几行 + 8-compare.js 的 suPlan()，DOM 换成桩
{
  ok(vlBestShare([{ k: 'base', frames: VL_WARN, share: 0.14 }, { k: 'save', frames: [['USE', 'RUSSELL'], ['SAVE', '9 MIN']], share: 0.6 }, { k: 'use', frames: [['USE', 'RUSSELL']], share: 0.6 }]) === 2
    && vlBestShare([{ k: 'base', frames: VL_WARN, share: 0.14 }, { k: 'vague', frames: [['EXPECT', 'DELAYS']], share: 0.14 }]) === -1
    && vlBestShare([{ k: 'base', frames: VL_WARN }, { k: 'use', frames: [['USE', 'RUSSELL']], share: 0.5 }]) === -1,
    'T49 绕行信号最强 = 会绕行的比例最高，一样高推荐字少的；没有比基准高、或基准没读数 → 不推荐（-1）');
  const cs = vlCands(b, true);
  ok(!cs.some(x => x.k === 'delay') && cs.length === cands.length - (cands.some(x => x.k === 'delay') ? 1 : 0) && cs.some(x => x.k === 'save'),
    `T49 SUMO 方案不试「DELAYS N MIN」（N 是引擎的每车延误）；其余写法照旧：${cs.map(x => vlText(x.frames)).join(' | ')}`);
  const bs = vlBestShare(rows);
  ok(bs >= 0 && rows[bs].share === Math.max(...rows.map(r => r.share)) && rows[bs].share > base.share, `T49 真路网：绕行信号最强的是「${bs >= 0 && vlText(rows[bs].frames)}」，${bs >= 0 && Math.round(rows[bs].share * 100)}% 会绕行（基准 ${Math.round(base.share * 100)}%）`);
  const read = f => readFileSync(WEB + 'src/js/' + f, 'utf8');
  const ENG = read('6-engine.js'), fmt = ENG.slice(ENG.indexOf('const esc='), ENG.indexOf('const TYPES4='));
  const suSrc = (/function suPlan\(\)\{[^\n]*\}/.exec(read('8-compare.js')) || [''])[0], SUMO_LINK = (/const SUMO_LINK='([^']+)'/.exec(read('4c-sumo.js')) || [])[1];
  ok(suSrc && SUMO_LINK === EP.link, 'T49 8-compare.js 有 suPlan()，4c-sumo.js 的 SUMO_LINK 就是演示方案这段');
  const H = n => Math.round(Number(n) || 0).toLocaleString('en-AU');
  const mk = ep => {
    const c = { console, EP: { ...ep }, BE: { api: be }, S: { step: 1 }, LANG: { cur: 'en' }, SUMO_LINK, document: { getElementById: () => null }, renderPanel() {}, engChanged() {}, engOn: () => true };
    c.L = (en, zh) => (c.LANG.cur === 'zh' ? zh : en);
    vm.createContext(c);
    vm.runInContext(block('6-engine.js', 'pure') + '\n' + fmt + '\n' + suSrc + '\n' + read('6d-vmslab.js') + '\n;globalThis.X={VL,vlKey};', c);
    const rs = c.suPlan() ? rows.filter(r => vlCands(b, true).some(x => x.k === r.k && vlText(x.frames) === vlText(r.frames))) : rows; // what vlRun() scores in each mode
    Object.assign(c.X.VL, { key: c.X.vlKey(), at: ep.vmsAt, busy: false, rows: rs, spots: spots.map(p => ({ ...p })), base: b, err: null, src: (b.flags && b.flags.reading_src) || '' });
    c.X.VL.best = (c.suPlan() ? vlBestShare : vlBest)(rs);
    return c;
  };
  const c = mk(EP), html = c.vlHTML();
  // 屏上不许出现的引擎排队：每条写法、每个摆放位置算出来的排队（和摆放距离 / 拐口距离重合的除外），加线上看到的那几个数
  const geo = new Set([...VL_AT, EP.vmsAt, w.turn_m].map(H));
  const qs = new Set([...rows, ...spots].map(r => r.q).filter(q => Number.isFinite(q) && q >= 10).map(H).filter(q => !geo.has(q)));
  const leak = [...qs].filter(q => html.includes(`${q} m`)).concat(['918', '509', '10,493', '18,693', '33,015', '79'].filter(n => new RegExp(`(?<![\\d,.])${n}(?![\\d]|,\\d)`).test(html)));
  ok(c.suPlan() && !leak.length && !/class="n">[\d,]+ m</.test(html), `T49 反向断言：SUMO 方案的试验台没有引擎排队（查了 ${[...qs].join(' / ')} m 和 918 / 509 / 10,493 / 18,693 / 33,015 / 79）${leak.length ? ' —— 漏了 ' + leak : ''}`);
  const cells = [...html.matchAll(/class="n">([^<]+)</g)].map(m => m[1]);
  ok(cells.length === c.X.VL.rows.length && cells.every(x => /^\d+%$/.test(x)) && cells.includes(`${Math.round(base.share * 100)}%`) && !/DELAYS \d+ MIN/.test(html), `T49 每行写会绕行的比例：${cells.join(' / ')}（没有 DELAYS N MIN）`);
  ok(html.includes('VMS lab · which words get drivers to detour') && html.includes('drivers who detour (AI sign reading)') && html.includes('the traffic effect is computed by SUMO in step 2')
    && html.includes(`Strongest detour signal: <b>${vlText(rows[bs].frames)}</b>`) && html.includes('computed by SUMO in step 2') && !/queue/i.test(html),
    'T49 标题 / 说明写「效果由第 2 步的 SUMO 算」；推荐叫「Strongest detour signal」，全文不提 queue');
  const chips = [...html.matchAll(/data-vlat="(\d+)"[^>]*>([^<]+)</g)].map(m => m[2]);
  ok(chips.length === VL_AT.length && chips.every(t => /^\d+ m · \d+%/.test(t)), `T49 摆放位置写距离和会绕行的比例：${chips.join(' | ')}`);
  c.LANG.cur = 'zh'; const zh = c.vlHTML();
  ok(zh.includes('绕行信号最强') && zh.includes('AI 读牌 → 会绕行的司机') && zh.includes('第 2 步的 SUMO') && !/排队/.test(zh), 'T49 中文：「绕行信号最强」「AI 读牌 → 会绕行的司机」「由第 2 步的 SUMO 计算」，不提排队');
  const e = mk({ ...EP, lanes: 2 }), he = e.vlHTML();
  ok(!e.suPlan() && he.includes(`${H(rows[0].q)} m`) && he.includes('engine estimate') && he.includes('Recommended') && !he.includes('SUMO'), 'T49 SUMO 范围以外的方案：照旧写引擎的排队米数和「Recommended」，标「engine estimate」');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
