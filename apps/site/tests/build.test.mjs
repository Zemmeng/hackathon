// 用途：测 build.mjs —— 各模块 public/ 拷到 <out>/<模块>/public/、首页有 data-smoke、有 web 就跳 /web/public/、不清空不该清的目录
// 用法：node tests/build.test.mjs（test.sh 会自动跑）；全在临时目录里做，不碰 apps/site/out；最后一行固定「N passed, M failed」
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../build.mjs';

let P = 0, F = 0;
const ok = (cond, msg) => { if (cond) { P++; console.log('✅ ' + msg); } else { F++; console.log('❌ ' + msg); } };
const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, '..');
const APPS = join(SITE, '..');
const TMP = mkdtempSync(join(tmpdir(), 'site-build-'));
const quiet = () => {};
const put = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const read = (p) => readFileSync(p, 'utf8');

try {
  // ---- 1. 假的 apps/：web 有首页、roads 只有数据、site 自己的 public 不该拷、没有 public 的模块跳过 ----
  const apps = join(TMP, 'apps');
  put(join(apps, 'web/public/index.html'), '<!doctype html><title>web</title>');
  put(join(apps, 'web/public/js/app.js'), 'export {}');
  put(join(apps, 'roads/public/cbd/network.json'), '{"version":1}');
  put(join(apps, 'roads/public/cbd/.gitkeep'), '');
  put(join(apps, 'site/public/secret.html'), 'site 自己的 public 不应该被挂出去');
  put(join(apps, 'engine/src/index.js'), 'export {}'); // 没有 public/
  put(join(apps, 'README.md'), '# apps');
  const out = join(TMP, 'out1');
  const mods = build({ appsDir: apps, outDir: out, commit: 'abc1234', builtAt: 'T', log: quiet });

  ok(JSON.stringify(mods.map((m) => m.name)) === '["roads","web"]', `只拷有 public/ 的模块，site 自己除外（得到 ${mods.map((m) => m.name).join(', ')}）`);
  ok(read(join(out, 'web/public/index.html')) === '<!doctype html><title>web</title>' && existsSync(join(out, 'web/public/js/app.js')), 'web/public/ 原样挂到 <out>/web/public/（含子目录）');
  ok(read(join(out, 'roads/public/cbd/network.json')) === '{"version":1}', 'roads/public/cbd/network.json 原样拷到 <out>/roads/public/cbd/');
  ok(!existsSync(join(out, 'roads/public/cbd/.gitkeep')), '点开头的文件（.gitkeep）不拷');
  ok(!existsSync(join(out, 'site')) && !existsSync(join(out, 'engine')), '反向：site 自己的 public/ 和没有 public/ 的模块都不出现在产物里');

  const idx = read(join(out, 'index.html'));
  ok(idx.includes('data-smoke'), '首页 index.html 含 data-smoke（check.sh --e2e 要）');
  ok(idx.includes("location.replace('/web/public/'") && idx.includes('url=/web/public/'), '有 apps/web/public/index.html → 首页跳 /web/public/（JS + noscript 兜底）');
  ok(/\[\?&\]list/.test(idx), '首页加 ?list 不跳，留在模块目录');
  ok(!/localhost|127\.0\.0\.1/i.test(idx), '反向：首页没有 localhost / 127.0.0.1（check.sh --e2e 要）');
  ok(idx.includes('href="/roads/public/cbd/network.json"'), '没有 index.html 的模块（roads）在目录里列出文件链接');
  ok(idx.includes('abc1234'), '首页带 build 的 commit，线上能看出是哪个版本');

  // ---- 2. 没有 web：首页就是模块目录，不跳转 ----
  rmSync(join(apps, 'web'), { recursive: true });
  const out2 = join(TMP, 'out2');
  build({ appsDir: apps, outDir: out2, commit: '', builtAt: 'T', log: quiet });
  const idx2 = read(join(out2, 'index.html'));
  ok(idx2.includes('data-smoke') && !idx2.includes('location.replace') && !idx2.includes('http-equiv="refresh"'), '没有 apps/web → 首页是模块目录、含 data-smoke、不跳转');

  // ---- 3. 重建时先清空：上次的残留文件不留在产物里 ----
  put(join(out2, 'roads/public/stale.json'), '{}');
  build({ appsDir: apps, outDir: out2, commit: '', builtAt: 'T', log: quiet });
  ok(!existsSync(join(out2, 'roads/public/stale.json')), '重建先清空输出目录，删掉的文件不会留在线上');

  // ---- 4. 防手滑：不清空不是自己生成的目录，也不往 apps/ 里别的地方写 ----
  const foreign = join(TMP, 'foreign');
  put(join(foreign, 'keep.txt'), '别删我');
  let threw = false;
  try { build({ appsDir: apps, outDir: foreign, log: quiet }); } catch { threw = true; }
  ok(threw && existsSync(join(foreign, 'keep.txt')), '反向：输出目录非空且不是 build.mjs 生成的 → 报错，不清空');
  threw = false;
  try { build({ appsDir: apps, outDir: join(apps, 'roads'), log: quiet }); } catch { threw = true; }
  ok(threw && existsSync(join(apps, 'roads/public/cbd/network.json')), '反向：输出目录指到 apps/<别的模块> → 报错，别人的文件还在');
  threw = false;
  try { build({ appsDir: apps, outDir: TMP, log: quiet }); } catch { threw = true; }
  ok(threw && existsSync(join(apps, 'roads')), '反向：输出目录包住 apps/ → 报错');

  // ---- 5. 真仓库：每个有 public/ 的模块都挂到 /<模块>/public/，文件一个不少 ----
  const real = join(TMP, 'real');
  const got = build({ outDir: real, log: quiet });
  const want = readdirSync(APPS).filter((m) => m !== 'site' && /^[a-z][a-z0-9-]*$/.test(m) && existsSync(join(APPS, m, 'public')) && statSync(join(APPS, m, 'public')).isDirectory()).sort();
  ok(JSON.stringify(got.map((m) => m.name)) === JSON.stringify(want), `真仓库：挂出的模块 = apps/ 下有 public/ 的模块（${want.join(', ') || '无'}）`);
  const countFiles = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => e.name.startsWith('.') ? n : n + (e.isDirectory() ? countFiles(join(d, e.name)) : 1), 0);
  ok(got.every((m) => countFiles(join(APPS, m.name, 'public')) === countFiles(join(real, m.name, 'public'))), '真仓库：每个模块 public/ 的文件数和产物一致（点开头的除外）');
  if (existsSync(join(APPS, 'sim/public/index.html'))) ok(existsSync(join(real, 'sim/public/index.html')), '真仓库：/sim/public/index.html 在产物里');
  if (existsSync(join(APPS, 'roads/public/cbd/network.json'))) ok(existsSync(join(real, 'roads/public/cbd/network.json')), '真仓库：/roads/public/cbd/network.json 在产物里（契约 §路网数据文件）');
  ok(read(join(real, 'index.html')).includes('data-smoke'), '真仓库：首页含 data-smoke');

  // ---- 6. 命令行：node build.mjs --out <目录> 打印拷了什么，退出码 0 ----
  const cli = join(TMP, 'cli');
  const stdout = execFileSync(process.execPath, [join(SITE, 'build.mjs'), '--out', cli], { encoding: 'utf8' });
  ok(existsSync(join(cli, 'index.html')) && /\/[a-z-]+\/public\//.test(stdout) && stdout.includes('✅'), '命令行 node build.mjs --out <目录>：打印每个模块拷了多少、以 ✅ 结尾');
} catch (e) {
  F++;
  console.log('❌ 测试本身崩了：' + (e && e.stack));
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);
