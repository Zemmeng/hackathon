// 用途：测 build.mjs —— 各模块 public/ 里 git 已跟踪的文件拷到 <out>/<模块>/public/、被 gitignore / 没 git add 的不拷、
//       符号链接模块跳过、不在 git 仓库里就拒绝构建、首页有 data-smoke、有 web 就跳 /web/public/、不清空不该清的目录
// 用法：node tests/build.test.mjs（test.sh 会自动跑）；假仓库全在临时目录里建，不往真仓库写文件、不碰 apps/site/out；
//       最后一行固定「N passed, M failed」
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
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
// 从 git hook 里跑时会继承 GIT_DIR / GIT_INDEX_FILE，去掉它们，临时仓库才是临时仓库
const REPO_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_PREFIX', 'GIT_NAMESPACE'];
const gitEnv = () => { const e = { ...process.env }; for (const k of REPO_ENV) delete e[k]; return e; };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: gitEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const throwsMsg = (fn) => { try { fn(); return ''; } catch (e) { return String(e && e.message) || '?'; } };
// 产物里某个模块下的全部文件（相对 public/）
const walk = (d, base = d) => existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name), base) : [join(d, e.name).slice(base.length + 1).split(sep).join('/')]) : [];

try {
  // ---- 1. 临时 git 仓库里的假 apps/：web 有首页、roads 只有数据、site 自己的 public 不该拷、没有 public 的模块跳过 ----
  const repo = join(TMP, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, '-c', 'init.defaultBranch=main', 'init', '-q');
  const apps = join(repo, 'apps');
  const tracked = {
    'apps/web/public/index.html': '<!doctype html><title>web</title>',
    'apps/web/public/js/app.js': 'export {}',
    'apps/roads/public/cbd/network.json': '{"version":1}',
    'apps/roads/public/cbd/.gitkeep': '',
    'apps/site/public/secret.html': 'site 自己的 public 不应该被挂出去',
    'apps/engine/src/index.js': 'export {}', // 没有 public/
    'apps/README.md': '# apps',
    '.gitignore': 'keys.json\n*.pem\nraw/\nnode_modules/\n',
  };
  for (const [p, s] of Object.entries(tracked)) put(join(repo, p), s);
  git(repo, 'add', '--', ...Object.keys(tracked));
  // 被 gitignore 的（部署人电脑上才有）和没 git add 的：都不能出现在产物里
  put(join(apps, 'roads/public/keys.json'), '{"key":"PLACEHOLDER-NOT-A-REAL-KEY"}');
  put(join(apps, 'roads/public/raw/scats-full.csv'), 'site,count\n2921,1\n');
  put(join(apps, 'web/public/dev.pem'), '-----PLACEHOLDER-----');
  put(join(apps, 'web/public/node_modules/x/index.js'), 'export {}');
  put(join(apps, 'roads/public/draft.json'), '{"draft":true}');
  ok(git(repo, 'status', '--porcelain', '--', 'apps/roads/public/keys.json', 'apps/roads/public/raw').trim() === '', '前提：keys.json、raw/ 被 gitignore，git status 看不见（deploy.sh 的干净检查拦不住）');

  const out = join(TMP, 'out1');
  const mods = build({ appsDir: apps, outDir: out, commit: 'abc1234', builtAt: 'T', log: quiet });

  ok(JSON.stringify(mods.map((m) => m.name)) === '["roads","web"]', `只拷有 public/ 的模块，site 自己除外（得到 ${mods.map((m) => m.name).join(', ')}）`);
  ok(read(join(out, 'web/public/index.html')) === '<!doctype html><title>web</title>' && existsSync(join(out, 'web/public/js/app.js')), 'web/public/ 原样挂到 <out>/web/public/（含子目录）');
  ok(read(join(out, 'roads/public/cbd/network.json')) === '{"version":1}', 'roads/public/cbd/network.json 原样拷到 <out>/roads/public/cbd/');
  ok(!existsSync(join(out, 'roads/public/cbd/.gitkeep')), '点开头的文件（.gitkeep）不拷');
  ok(!existsSync(join(out, 'site')) && !existsSync(join(out, 'engine')), '反向：site 自己的 public/ 和没有 public/ 的模块都不出现在产物里');
  ok(!existsSync(join(out, 'roads/public/keys.json')) && !existsSync(join(out, 'roads/public/raw')), '反向：被 gitignore 的 keys.json、raw/ 不出现在产物里（不会发到公网）');
  ok(!existsSync(join(out, 'web/public/dev.pem')) && !existsSync(join(out, 'web/public/node_modules')), '反向：被 gitignore 的 *.pem、node_modules/ 不出现在产物里');
  ok(!existsSync(join(out, 'roads/public/draft.json')), '反向：没 git add 的文件不拷（产物 = 某个 commit 的原样）');
  ok(JSON.stringify(walk(join(out, 'roads/public'))) === '["cbd/network.json"]' && JSON.stringify(walk(join(out, 'web/public')).sort()) === '["index.html","js/app.js"]', '产物里的文件正好是 git 已跟踪的那几个');

  const idx = read(join(out, 'index.html'));
  ok(idx.includes('data-smoke'), '首页 index.html 含 data-smoke（check.sh --e2e 要）');
  ok(idx.includes("location.replace('/web/public/'") && idx.includes('url=/web/public/'), '有 apps/web/public/index.html → 首页跳 /web/public/（JS + noscript 兜底）');
  ok(/\[\?&\]list/.test(idx), '首页加 ?list 不跳，留在模块目录');
  ok(!/localhost|127\.0\.0\.1/i.test(idx), '反向：首页没有 localhost / 127.0.0.1（check.sh --e2e 要）');
  ok(idx.includes('href="/roads/public/cbd/network.json"'), '没有 index.html 的模块（roads）在目录里列出文件链接');
  ok(!/keys\.json|scats-full|draft\.json/.test(idx), '反向：首页目录里没有被忽略 / 没跟踪的文件链接');
  ok(idx.includes('abc1234'), '首页带 build 的 commit，线上能看出是哪个版本');

  // ---- 2. 符号链接模块：apps/zz → 仓库外的目录，即使链接本身被提交了也跳过，并打印一行 ----
  put(join(TMP, 'outside/public/leak.txt'), '仓库外的文件');
  symlinkSync(join(TMP, 'outside'), join(apps, 'zz'), 'junction');
  put(join(apps, 'yy/src/x.js'), 'export {}');
  symlinkSync(join(TMP, 'outside/public'), join(apps, 'yy/public'), 'junction');
  git(repo, 'add', '--', 'apps/zz', 'apps/yy/public', 'apps/yy/src/x.js');
  const logs = [];
  const out3 = join(TMP, 'out3');
  let mods3 = [];
  const err3 = throwsMsg(() => { mods3 = build({ appsDir: apps, outDir: out3, commit: '', builtAt: 'T', log: (s) => logs.push(String(s)) }); });
  ok(err3 === '', `符号链接模块不会让整个 build 失败（${err3 || 'ok'}）`);
  ok(!existsSync(join(out3, 'zz')) && !mods3.some((m) => m.name === 'zz') && walk(out3).every((f) => !f.endsWith('leak.txt')), '反向：模块目录是符号链接（apps/zz → 仓库外）→ 不跟随，leak.txt 不在产物里');
  ok(logs.some((l) => l.includes('zz') && l.includes('跳过')), '符号链接模块被跳过时打印一行说明');
  ok(!existsSync(join(out3, 'yy')) && !mods3.some((m) => m.name === 'yy'), '反向：public/ 本身是符号链接（apps/yy/public → 仓库外）→ 跳过');
  rmSync(join(apps, 'zz'));
  rmSync(join(apps, 'yy'), { recursive: true });

  // ---- 3. 不在 git 仓库里 / 找不到 git → 拒绝构建，而且不清空上次的产物 ----
  const plain = join(TMP, 'plain');
  put(join(plain, 'apps/roads/public/keys.json'), '{"key":"PLACEHOLDER"}');
  const out4 = join(TMP, 'out4');
  const ceil = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = TMP; // 防止临时目录碰巧在某个仓库里
  const err4 = throwsMsg(() => build({ appsDir: join(plain, 'apps'), outDir: out4, commit: '', builtAt: 'T', log: quiet }));
  if (ceil === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = ceil;
  ok(err4.includes('git') && !existsSync(join(out4, 'roads')), `反向：apps/ 不在 git 仓库里 → 报错、不构建（${err4.split('：')[0] || '没报错'}）`);
  const path0 = process.env.PATH;
  process.env.PATH = join(TMP, 'no-bin');
  const err5 = throwsMsg(() => build({ appsDir: apps, outDir: out, commit: '', builtAt: 'T', log: quiet }));
  process.env.PATH = path0;
  ok(err5.includes('git') && existsSync(join(out, 'index.html')), `反向：找不到 git 命令 → 报错、不构建，上次的产物不清空（${err5.split('：')[0] || '没报错'}）`);

  // ---- 4. 没有 web：首页就是模块目录，不跳转 ----
  rmSync(join(apps, 'web'), { recursive: true });
  const out2 = join(TMP, 'out2');
  build({ appsDir: apps, outDir: out2, commit: '', builtAt: 'T', log: quiet });
  const idx2 = read(join(out2, 'index.html'));
  ok(idx2.includes('data-smoke') && !idx2.includes('location.replace') && !idx2.includes('http-equiv="refresh"'), '没有 apps/web → 首页是模块目录、含 data-smoke、不跳转');

  // ---- 5. 重建时先清空：上次的残留文件不留在产物里 ----
  put(join(out2, 'roads/public/stale.json'), '{}');
  build({ appsDir: apps, outDir: out2, commit: '', builtAt: 'T', log: quiet });
  ok(!existsSync(join(out2, 'roads/public/stale.json')), '重建先清空输出目录，删掉的文件不会留在线上');

  // ---- 6. 防手滑：不清空不是自己生成的目录，也不往 apps/ 里别的地方写 ----
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

  // ---- 7. 真仓库：每个有 public/ 的模块都挂到 /<模块>/public/，文件 = git 已跟踪的文件，被忽略的一个不带 ----
  const real = join(TMP, 'real');
  const got = build({ outDir: real, log: quiet });
  const isDir = (p) => existsSync(p) && lstatSync(p).isDirectory();
  const want = readdirSync(APPS).filter((m) => m !== 'site' && /^[a-z][a-z0-9-]*$/.test(m) && isDir(join(APPS, m)) && isDir(join(APPS, m, 'public'))).sort();
  ok(JSON.stringify(got.map((m) => m.name)) === JSON.stringify(want), `真仓库：挂出的模块 = apps/ 下有 public/ 的模块（${want.join(', ') || '无'}）`);
  const trackedOf = (m) => git(join(APPS, m, 'public'), 'ls-files', '-z', '--', '.').split('\0')
    .filter((f) => f && !f.split('/').some((s) => s.startsWith('.')) && existsSync(join(APPS, m, 'public', f)) && lstatSync(join(APPS, m, 'public', f)).isFile()).sort();
  ok(got.every((m) => JSON.stringify(walk(join(real, m.name, 'public')).sort()) === JSON.stringify(trackedOf(m.name))), '真仓库：每个模块产物里的文件 = git ls-files 列出的已跟踪文件（点开头的除外）');
  const ignored = git(APPS, 'ls-files', '-z', '-o', '-i', '--exclude-standard', '--', '.').split('\0').filter((f) => /^[a-z][a-z0-9-]*\/public\//.test(f) && !f.startsWith('site/'));
  ok(ignored.every((f) => !existsSync(join(real, f))), `反向：真仓库里被 gitignore 的 ${ignored.length} 个 apps/*/public/ 文件一个都不在产物里`);
  if (existsSync(join(APPS, 'sim/public/index.html'))) ok(existsSync(join(real, 'sim/public/index.html')), '真仓库：/sim/public/index.html 在产物里');
  if (existsSync(join(APPS, 'roads/public/cbd/network.json'))) ok(existsSync(join(real, 'roads/public/cbd/network.json')), '真仓库：/roads/public/cbd/network.json 在产物里（契约 §路网数据文件）');
  ok(read(join(real, 'index.html')).includes('data-smoke'), '真仓库：首页含 data-smoke');

  // ---- 8. 命令行：node build.mjs --out <目录> 打印拷了什么，退出码 0 ----
  const cli = join(TMP, 'cli');
  const stdout = execFileSync(process.execPath, [join(SITE, 'build.mjs'), '--out', cli], { encoding: 'utf8', env: gitEnv() });
  ok(existsSync(join(cli, 'index.html')) && /\/[a-z-]+\/public\//.test(stdout) && stdout.includes('✅'), '命令行 node build.mjs --out <目录>：打印每个模块拷了多少、以 ✅ 结尾');
} catch (e) {
  F++;
  console.log('❌ 测试本身崩了：' + (e && e.stack));
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);
