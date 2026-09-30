// 用途：核对 wrangler.jsonc / Dockerfile / package.json 的关键项 —— 容器 standard-2、只开 1 个实例、构建上下文 apps/（镜像带实网的 roads 数据）、没有 workers.dev 入口、
//       Durable Object 绑定和 migration、限流 3 次 / 60 s、镜像的环境变量和 worker.js 一致、site 绑的名字对得上、sumo 不进 DEPLOY_MODULES
// 用法：node tests/config.test.mjs（test.sh 会自动跑）；不需要 npm i、不需要 Docker；最后一行固定「N passed, M failed」
import { readFileSync, existsSync } from 'node:fs';
import { CONTAINER_ENV } from '../src/proxy.js';

let P = 0, F = 0;
const ok = (cond, msg) => { if (cond) { P++; console.log('✅ ' + msg); } else { F++; console.log('❌ ' + msg); } };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// 去掉 JSONC 的 // 和 /* */ 注释、以及尾逗号（跳过字符串里的内容）—— 和 apps/site/tests/config.test.mjs 同一份
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
  const w = parseJsonc(read('../wrangler.jsonc'));
  const site = parseJsonc(read('../../site/wrangler.jsonc'));

  // ---- 1. Worker 本身 ----
  ok(w.name === 'hackathon-sumo' && w.main === 'src/worker.js', `name = ${w.name}，main = ${w.main}`);
  ok(w.compatibility_date === site.compatibility_date, `compatibility_date 和 site 一样：${w.compatibility_date}`);
  ok(w.workers_dev === false && w.preview_urls === false, 'workers_dev 关、preview_urls 关：没有自己的公网地址，只能经 site 的服务绑定进来');
  ok(!('routes' in w) && !('route' in w) && !('assets' in w), '反向：没有 routes / route / assets（不挂域名，不托管静态文件）');
  ok(w.observability?.enabled === true, 'observability 开（容器启动 / 停止、转发出错在 Workers Logs 里查）');
  ok(!('vars' in w), '反向：wrangler.jsonc 里没有 vars（容器环境变量写在 worker.js 的 envVars，没有密钥）');

  // ---- 2. 容器 ----
  const cs = Array.isArray(w.containers) ? w.containers : [];
  const c = cs[0] || {};
  ok(cs.length === 1 && c.class_name === 'SumoContainer', `containers 只有一个，class_name = ${c.class_name}`);
  ok(c.image === './Dockerfile' && existsSync(new URL('../Dockerfile', import.meta.url)), `image = ${c.image}（文件存在）`);
  ok(c.image_build_context === '..' && existsSync(new URL('../../web/tools/sumo/serve.py', import.meta.url)) && existsSync(new URL('../../roads/public/cbd/network.json', import.meta.url)),
    `image_build_context = ${c.image_build_context}（= apps/，里面有 web/tools/sumo/serve.py 和 roads/public/cbd/）`);
  ok(c.instance_type === 'standard-2', `instance_type = ${c.instance_type}（1 vCPU；SUMO 单核跑满）`);
  ok(c.max_instances === 1, `max_instances = ${c.max_instances}（任务状态只在一个实例里）`);

  // ---- 3. Durable Object 绑定 + migration ----
  const dob = w.durable_objects?.bindings || [];
  ok(dob.length === 1 && dob[0].name === 'SUMO_CONTAINER' && dob[0].class_name === 'SumoContainer', `durable_objects：${JSON.stringify(dob)}`);
  const mig = w.migrations || [];
  ok(mig.length === 1 && mig[0].tag === 'v1' && JSON.stringify(mig[0].new_sqlite_classes) === '["SumoContainer"]' && !mig[0].new_classes,
    `migrations：${JSON.stringify(mig)}（容器要 SQLite 存储的 DO）`);
  ok(!('exports' in w), '反向：没用 exports 声明 DO（和 migrations 互斥）');

  // ---- 4. 限流 ----
  const rl = w.ratelimits || [];
  ok(rl.length === 1 && rl[0].name === 'SUMO_RL' && rl[0].simple?.limit === 3 && rl[0].simple?.period === 60, `ratelimits：${JSON.stringify(rl)}（每 IP 每分钟 3 次）`);
  ok(/^[1-9]\d*$/.test(rl[0]?.namespace_id || ''), `namespace_id 是正整数字符串：${rl[0]?.namespace_id}`);

  // ---- 5. worker.js 和配置对得上 ----
  const src = read('../src/worker.js');
  ok(/export class SumoContainer extends Container\b/.test(src), 'worker.js 导出 class SumoContainer extends Container（= containers[0].class_name）');
  ok(src.includes("getContainer(env.SUMO_CONTAINER, 'main')"), "worker.js 用 getContainer(env.SUMO_CONTAINER, 'main')：固定一个实例");
  ok(/defaultPort = 8080;/.test(src) && /sleepAfter = '12h';/.test(src), "defaultPort = 8080、sleepAfter = '12h'");

  // ---- 6. Dockerfile ----
  const df = read('../Dockerfile');
  ok(/^FROM python:3\.\d+-slim$/m.test(df), 'Dockerfile FROM python:3.x-slim');
  const copies = [...df.matchAll(/^COPY\s+(.+)$/gm)].flatMap((m) => m[1].trim().split(/\s+/).slice(0, -1));
  const missing = copies.filter((p) => !existsSync(new URL('../../' + p, import.meta.url)));
  ok(copies.length >= 4 && missing.length === 0, `COPY 的 ${copies.length} 个源文件都在 apps/ 下（构建上下文）${missing.length ? '，缺：' + missing.join(' ') : ''}`);
  // 实网（contract v2）：build_real.py + roads 的三个输入进镜像，SUMO_ROADS_DIR 指向 COPY 的目标目录；routeSampler 要 numpy + scipy
  const need = ['web/tools/sumo/serve.py', 'web/tools/sumo/build_demo.py', 'web/tools/sumo/build_real.py',
    'roads/public/cbd/network.json', 'roads/public/cbd/signals.json', 'roads/public/cbd/flows.json'];
  ok(need.every((p) => copies.includes(p)), `COPY 了实网要的文件：${need.filter((p) => !copies.includes(p)).join(' ') || '全有'}`);
  const roadsCopy = (df.match(/^COPY[ \t]+roads\/public\/cbd\/\S+(?:[ \t]+\S+)*[ \t]+(\S+)$/m) || [])[1];
  const roadsEnv = (df.match(/^ENV [^\n]*\bSUMO_ROADS_DIR=(\S+)/m) || [])[1];
  ok(roadsCopy && roadsEnv && ('/app/' + roadsCopy).replace(/\/$/, '') === roadsEnv.replace(/\/$/, ''),
    `ENV SUMO_ROADS_DIR = roads 文件 COPY 到的目录（WORKDIR /app + ${roadsCopy}）`);
  ok(/^WORKDIR \/app$/m.test(df) && /pip install [^\n]*numpy==[\d.]+[^\n]*scipy==[\d.]+/.test(df) && /import numpy, scipy\.optimize/.test(df),
    'pip 锁版本装 numpy + scipy，构建时查能 import（routeSampler --optimize 要）');
  ok(/import build_real; build_real\.validate_real/.test(df) && /build_real\.py --prepare-only/.test(df) && /^ENV [^\n]*SUMO_REAL_CACHE=\/app\/\S+/m.test(df),
    '构建时查 build_real 能 import、validate_real 能用，并用 --prepare-only 把实网缓存建进镜像（SUMO_REAL_CACHE 在 /app 下，不在会清空的 /tmp）');
  const envLine = (df.match(/^ENV [\s\S]*?[^\\]\n/m) || [''])[0];
  const envOk = Object.entries(CONTAINER_ENV).every(([k, v]) => new RegExp(`\\b${k}=${v.replace(/\./g, '\\.')}(\\s|$)`).test(envLine));
  ok(envOk, `Dockerfile 的 ENV 和 worker.js 的 envVars（CONTAINER_ENV）一致：${JSON.stringify(CONTAINER_ENV)}`);
  ok(!/ALLOW_ORIGINS=|SUMO_API_KEY=|SUMO_POSTS_PER_MIN=/.test(df), '反向：镜像里不设 ALLOW_ORIGINS / SUMO_API_KEY / SUMO_POSTS_PER_MIN（Worker 删 Origin、按 IP 限流）');
  ok(/^EXPOSE 8080$/m.test(df) && /CMD \["python", "web\/tools\/sumo\/serve\.py"\]/.test(df), 'EXPOSE 8080，CMD 跑 web/tools/sumo/serve.py');
  ok(/ldd .*grep 'not found'/.test(df) && /Eclipse SUMO sumo 1\.27\.1/.test(df), '构建时查共享库（ldd）和 SUMO 版本 1.27.1');
  ok(/requirements\.txt/.test(df) && read('../../web/tools/sumo/requirements.txt').includes('eclipse-sumo==1.27.1'), 'pip 装的是 apps/web/tools/sumo/requirements.txt（eclipse-sumo==1.27.1）');
  // 构建时的最小端到端要用公开范围内的参数：clearance_s 600–2400、demand_scale 0.1–1.2（< 600 / ≥ 1.5 实测必失败）
  const check = (df.match(/RUN python web\/tools\/sumo\/build_demo\.py(?:[^\n]*\\\n)*[^\n]*/) || [''])[0]; // 连同 \ 续行
  const cl = Number((check.match(/--clearance-s (\d+)/) || [])[1]);
  const ds = (check.match(/--demand-scale ([\d.]+)/) || [])[1];
  ok(check && cl >= 600 && cl <= 2400 && (ds === undefined || (Number(ds) >= 0.1 && Number(ds) <= 1.2)) && /test -f \/tmp\/check-out\/index\.json/.test(check),
    `构建时跑一次 build_demo.py（clearance ${cl} s${ds ? '，demand ' + ds : ''}）并检查 index.json`);

  // ---- 7. package.json / lock ----
  const pkg = JSON.parse(read('../package.json'));
  const sitePkg = JSON.parse(read('../../site/package.json'));
  ok(pkg.type === 'module' && pkg.private === true, 'package.json：type module、private');
  ok(pkg.scripts?.dev === 'wrangler dev --port 8791' && pkg.scripts?.test === 'bash test.sh' && pkg.scripts?.deploy === 'wrangler deploy', `scripts：${JSON.stringify(pkg.scripts)}`);
  ok(pkg.devDependencies?.wrangler === sitePkg.devDependencies?.wrangler && /^\d+\.\d+\.\d+$/.test(pkg.devDependencies.wrangler), `wrangler 锁死且和 site 一样：${pkg.devDependencies?.wrangler}`);
  const cc = pkg.dependencies?.['@cloudflare/containers'] || '';
  ok(/^\d+\.\d+\.\d+$/.test(cc), `@cloudflare/containers 锁死：${cc}`);
  const lock = JSON.parse(read('../package-lock.json'));
  ok(lock.packages?.['node_modules/wrangler']?.version === pkg.devDependencies.wrangler && lock.packages?.['node_modules/@cloudflare/containers']?.version === cc,
    'package-lock.json 里 wrangler、@cloudflare/containers 的版本和 package.json 一致（npm ci 装的就是它）');

  // ---- 8. 和仓库其它地方对得上 ----
  const svc = (site.services || []).find((s) => s.binding === 'SUMO');
  ok(svc && svc.service === w.name, `site 的服务绑定 SUMO → ${svc && svc.service}（= 本 Worker 的 name）`);
  const conf = read('../../../hackathon.conf');
  const mods = (conf.match(/^DEPLOY_MODULES=(.*)$/m)?.[1] || '').trim().split(/\s+/);
  ok(!mods.includes('sumo'), `反向：hackathon.conf DEPLOY_MODULES = ${mods.join(' ')}，没有 sumo（没 Docker 的机器跑 deploy.sh all 会失败）`);
  const readme = read('../README.md');
  ok(/^Owner: @Zemmeng/m.test(readme), 'README.md 有 Owner: @Zemmeng');
  const reg = read('../../README.md');
  ok(/^\| sumo \| @Zemmeng \|.*\| 8791 \|/m.test(reg), 'apps/README.md 登记表有 sumo，端口 8791（= npm run dev 的端口）');
  const owners = read('../../../.github/CODEOWNERS');
  ok(/^\/apps\/sumo\/\s+@Zemmeng\s*$/m.test(owners), '.github/CODEOWNERS 有 /apps/sumo/ @Zemmeng');
} catch (e) {
  F++;
  console.log('❌ 测试本身崩了：' + (e && e.stack));
}

console.log(`${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);
