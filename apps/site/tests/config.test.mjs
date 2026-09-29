// 用途：核对 wrangler.jsonc / package.json 的关键项 —— 静态目录是 out、/api/* 先进 Worker、/api/public/* 例外、脚本先 build
// 用法：node tests/config.test.mjs（test.sh 会自动跑）；不需要 npm i；最后一行固定「N passed, M failed」
import { readFileSync } from 'node:fs';

let P = 0, F = 0;
const ok = (cond, msg) => { if (cond) { P++; console.log('✅ ' + msg); } else { F++; console.log('❌ ' + msg); } };

// 去掉 JSONC 的 // 和 /* */ 注释、以及尾逗号（跳过字符串里的内容）
function parseJsonc(text) {
  let out = '', i = 0, str = false;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (str) { out += c; if (c === '\\') { out += n; i += 2; continue; } if (c === '"') str = false; i++; continue; }
    if (c === '"') { str = true; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i = text.indexOf('*/', i + 2) + 2; continue; }
    out += c; i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

try {
  const raw = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const w = parseJsonc(raw);
  ok(w.main === 'src/worker.js' && typeof w.name === 'string' && /^[a-z0-9-]+$/.test(w.name), `wrangler.jsonc：main = src/worker.js，name = ${w.name}（只含小写字母、数字、连字符）`);
  ok(w.workers_dev === true && w.preview_urls === false && w.observability?.enabled === true, 'workers_dev 开、preview_urls 关、observability 开');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(w.compatibility_date || ''), `compatibility_date = ${w.compatibility_date}`);
  ok(w.assets?.directory === 'out' && w.assets?.binding === 'ASSETS', 'assets：目录 out（build.mjs 产物）、绑定名 ASSETS（worker.js 用）');
  const rwf = w.assets?.run_worker_first || [];
  ok(rwf.includes('/api/*') && rwf.includes('!/api/public/*'), `run_worker_first = ${JSON.stringify(rwf)}：/api/* 先进 Worker，/api/public/* 留给静态文件`);
  ok(!('services' in w), 'services 绑定还注释着（T5 的 api Worker 上线后再打开，见 README）');
  ok(raw.includes('"binding": "API"'), '注释里留着 API 服务绑定的样板（worker.js 读 env.API）');
  ok(!('vars' in w), '反向：wrangler.jsonc 里没有 vars（site 不需要变量；密钥只在 T5 Worker 的 wrangler secret）');

  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  ok(/^\d+\.\d+\.\d+$/.test(pkg.devDependencies?.wrangler || ''), `wrangler 版本锁死：${pkg.devDependencies?.wrangler}`);
  ok(/^node build\.mjs && wrangler deploy$/.test(pkg.scripts?.deploy || ''), 'npm run deploy 先 build 再 wrangler deploy（deploy.sh 调它）');
  ok(/^node build\.mjs && wrangler dev --port 8790$/.test(pkg.scripts?.dev || ''), 'npm run dev 先 build，端口 8790');
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  ok(lock.packages?.['node_modules/wrangler']?.version === pkg.devDependencies.wrangler, `package-lock.json 里 wrangler 也是 ${pkg.devDependencies.wrangler}（npm ci 装的就是它）`);
} catch (e) {
  F++;
  console.log('❌ 测试本身崩了：' + (e && e.stack));
}

console.log(`${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);
