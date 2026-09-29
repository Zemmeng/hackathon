// build.mjs —— 把每个模块 public/ 里 git 已跟踪的文件拷到 out/<模块>/public/，再生成根目录 index.html（含 data-smoke）
// 用法：node build.mjs [--out <目录>]（默认 apps/site/out，已 gitignore；每次先清空再拷）
// 规则（docs/contract.md「lead 部署时把每个模块的 public/ 原样挂到 /<模块>/public/」）：
//   apps/ 下每个有 public/ 的模块都拷，site 自己除外
//   🔒 只拷 `git ls-files` 列出的已跟踪文件：被 gitignore 的（keys.json、*.pem、raw/、node_modules/…）和没 git add 的一律不拷，
//      否则会从部署人的电脑直接发到公网（deploy.sh 的干净检查看不见被忽略的文件）；git 不可用或不在仓库里 → 拒绝构建
//   点开头的文件（.gitkeep）、符号链接跳过；模块目录或 public/ 是符号链接、实际路径不在 apps/ 里 → 整个模块跳过并打印一行
//   有 apps/web/public/index.html → 首页跳到 /web/public/（加 ?list 不跳，看模块目录）；没有 → 首页就是模块目录
// 不依赖任何 npm 包；deploy / dev 前自动跑（package.json）。
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SELF = 'site';
export const MAX_FILE = 25 * 1024 * 1024; // Cloudflare 静态资源单个文件上限 25 MiB
export const MAX_FILES = 20000; // 免费计划每个 Worker 的静态文件个数上限
const MODULE_RE = /^[a-z][a-z0-9-]*$/; // 目录名 = 模块名（apps/README.md）
const inside = (child, parent) => { const r = relative(parent, child); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

// git 只按 cwd 找仓库：去掉从 git hook 继承来的 GIT_DIR / GIT_INDEX_FILE 等，免得读到别的仓库的索引
const REPO_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_PREFIX', 'GIT_NAMESPACE'];
function git(cwd, args) {
  const env = { ...process.env };
  for (const k of REPO_ENV) delete env[k];
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
}
const WHY = 'build 只拷 git 已跟踪的文件，免得把被 gitignore 的 key、原始数据发到公网';

// apps/ 所在 git 仓库的根目录；git 不可用或不在仓库里 → 抛错（调用方不构建）
export function repoRoot(appsDir) {
  let top = '';
  try { top = git(appsDir, ['rev-parse', '--show-toplevel']).trim(); } catch (e) {
    if (e && e.code === 'ENOENT') throw new Error(`找不到 git 命令：${WHY}，没有 git 就不构建`);
    throw new Error(`${appsDir} 不在 git 仓库里：${WHY}，不在仓库里就不构建`);
  }
  if (!top) throw new Error(`${appsDir} 不在 git 工作区里：${WHY}，不构建`);
  return top;
}

// 按 git 索引拷一个模块的 public/；返回 { files: [相对路径], bytes, skipped: [相对路径], untracked: 没 git add 的文件数 }
function copyTracked(pub, dst) {
  const acc = { files: [], bytes: 0, skipped: [], untracked: 0 };
  mkdirSync(dst, { recursive: true });
  const realPub = realpathSync(pub);
  const list = (args) => git(pub, ['ls-files', '-z', ...args, '--', '.']).split('\0').filter(Boolean);
  for (const rel of list([]).sort()) {
    const s = join(pub, rel);
    if (isAbsolute(rel) || rel.split('/').some((seg) => seg.startsWith('.'))) { acc.skipped.push(rel); continue; } // 点开头（含 ..）
    let st;
    try { st = lstatSync(s); } catch { acc.skipped.push(rel); continue; } // 已跟踪但工作区里删了
    if (!st.isFile()) { acc.skipped.push(rel); continue; } // 符号链接、子模块
    if (!inside(realpathSync(s), realPub)) { acc.skipped.push(rel); continue; } // 中间某层目录被换成了符号链接
    if (st.size > MAX_FILE) throw new Error(`${rel} 有 ${(st.size / 1048576).toFixed(1)} MB，超过 Cloudflare 单文件 25 MiB 上限`);
    const d = join(dst, rel);
    mkdirSync(dirname(d), { recursive: true });
    copyFileSync(s, d);
    acc.files.push(rel);
    acc.bytes += st.size;
  }
  acc.untracked = list(['-o', '--exclude-standard']).length; // 只用来提示：新文件要先 git add 才会上线
  return acc;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function indexHtml(mods, { commit = '', builtAt = '' } = {}) {
  const hasWeb = mods.some((m) => m.name === 'web' && m.hasIndex);
  const items = mods.map((m) => {
    const root = `/${m.name}/public/`;
    const head = m.hasIndex
      ? `<a href="${esc(root)}">${esc(m.name)}</a>`
      : `<span>${esc(m.name)}</span>`;
    const files = m.hasIndex ? '' : '<ul>' + m.files.slice(0, 12).map((f) => `<li><a href="${esc(root + f)}">${esc(root + f)}</a></li>`).join('') +
      (m.files.length > 12 ? `<li>…另有 ${m.files.length - 12} 个文件</li>` : '') + '</ul>';
    return `<li>${head} <small>${m.files.length} 个文件 · ${(m.bytes / 1024).toFixed(0)} KB</small>${files}</li>`;
  }).join('\n      ');
  // 跳转用 JS 做，这样 /?list 能留在目录页；check.sh --e2e 只要求 GET / 返回 200 且含 data-smoke（不跟跳转）
  const redirect = hasWeb
    ? `<script>if (!/[?&]list(=|&|$)/.test(location.search)) location.replace('/web/public/' + location.hash);</script>
<noscript><meta http-equiv="refresh" content="0; url=/web/public/"></noscript>`
    : '';
  return `<!doctype html>
<html lang="zh-CN" data-smoke="site">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="build" content="${esc(commit)} ${esc(builtAt)}">
<title>模块目录</title>
${redirect}
<style>
  :root { --bg: #fafaf8; --fg: #1d1d1b; --muted: #6b6b66; --link: #0b5cad; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161615; --fg: #ecebe6; --muted: #9a9a93; --link: #7cb4f0; } }
  body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, sans-serif; }
  main { max-width: 720px; margin: 0 auto; }
  a { color: var(--link); } small, footer { color: var(--muted); }
  ul { padding-left: 1.2em; } li ul { font-size: 14px; word-break: break-all; }
</style>
</head>
<body>
<main>
  <h1>模块目录</h1>
  <p>${hasWeb ? '正在打开网页面板 <a href="/web/public/">/web/public/</a>…' : '还没有网页面板（apps/web/public/），先列出已发布的模块。'}</p>
  <ul>
      ${items || '<li>没有任何模块有 public/</li>'}
  </ul>
  <p><small>接口：<a href="/api/health">/api/health</a></small></p>
  <footer><small>build ${esc(commit || '?')} · ${esc(builtAt)}</small></footer>
</main>
</body>
</html>
`;
}

// appsDir：apps/ 目录；outDir：输出目录（先清空）；返回 [{ name, files, bytes, skipped, hasIndex }]
export function build({ appsDir = resolve(HERE, '..'), outDir = join(HERE, 'out'), commit, builtAt, log = console.log } = {}) {
  appsDir = resolve(appsDir); outDir = resolve(outDir);
  repoRoot(appsDir); // 先确认 git 可用、apps/ 在仓库里；不行就抛错，上次的产物也不动
  // 每次先清空输出目录，所以要防手滑：不能包住 apps/，在 apps/ 里只能是 apps/site/out；
  // 已存在又非空的目录，必须是上次 build 生成的（index.html 里有 data-smoke="site"）才清
  const okOut = join(appsDir, SELF, 'out');
  if (inside(appsDir, outDir) || (inside(outDir, appsDir) && !inside(outDir, okOut))) {
    throw new Error(`输出目录 ${outDir} 不安全（在 apps/ 里只能是 apps/${SELF}/out）`);
  }
  if (existsSync(outDir) && readdirSync(outDir).length > 0) {
    const idx = join(outDir, 'index.html');
    if (!existsSync(idx) || !readFileSync(idx, 'utf8').includes('data-smoke="site"')) {
      throw new Error(`输出目录 ${outDir} 不是空的，也不是 build.mjs 生成的，不敢清空`);
    }
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const mods = [];
  const realApps = realpathSync(appsDir);
  for (const name of readdirSync(appsDir).sort()) {
    if (name === SELF || !MODULE_RE.test(name)) continue;
    const dir = join(appsDir, name);
    const pub = join(dir, 'public');
    const dirSt = lstatSync(dir);
    if (dirSt.isSymbolicLink()) { log(`  ⚠️ 跳过 apps/${name}：模块目录是符号链接，不跟随`); continue; }
    if (!dirSt.isDirectory() || !existsSync(pub)) continue;
    if (!lstatSync(pub).isDirectory()) { log(`  ⚠️ 跳过 apps/${name}/public：是符号链接或不是目录，不跟随`); continue; }
    if (!inside(realpathSync(pub), realApps)) { log(`  ⚠️ 跳过 apps/${name}/public：实际路径不在 apps/ 里`); continue; }
    const r = copyTracked(pub, join(outDir, name, 'public'));
    mods.push({ name, ...r, hasIndex: r.files.includes('index.html') });
    const notes = [r.skipped.length ? `跳过 ${r.skipped.join(', ')}` : '', r.untracked ? `${r.untracked} 个没 git add 的文件没拷` : ''].filter(Boolean).join('；');
    log(`  /${name}/public/  ${String(r.files.length).padStart(4)} 个文件  ${(r.bytes / 1024).toFixed(0).padStart(6)} KB${notes ? `  （${notes}）` : ''}`);
  }
  const total = mods.reduce((n, m) => n + m.files.length, 0) + 1;
  if (total > MAX_FILES) throw new Error(`一共 ${total} 个文件，超过 Cloudflare 免费计划 ${MAX_FILES} 个的上限`);
  if (commit === undefined) {
    try { commit = git(appsDir, ['rev-parse', '--short', 'HEAD']).trim(); } catch { commit = ''; }
  }
  if (builtAt === undefined) builtAt = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  writeFileSync(join(outDir, 'index.html'), indexHtml(mods, { commit, builtAt }));
  const web = mods.some((m) => m.name === 'web' && m.hasIndex);
  log(`  /index.html  ${web ? '跳到 /web/public/（/?list 看模块目录）' : '模块目录（还没有 apps/web/public/index.html）'}`);
  log(`✅ ${mods.length} 个模块、${total} 个文件 → ${relative(process.cwd(), outDir) || '.'}`);
  return mods;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const outDir = i > 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : undefined;
  try {
    console.log('build.mjs：各模块 public/ 里 git 已跟踪的文件 → out/<模块>/public/');
    build({ outDir });
  } catch (e) {
    console.error('❌ ' + e.message);
    process.exit(1);
  }
}
