// 工具脚本能跑：prewarm 默认 dry-run 不联网、--check 通过；不认识的参数退出码 2
import { spawnSync } from 'node:child_process';
import { ok, done } from './_t.mjs';

const run = (...a) => spawnSync(process.execPath, [new URL('../tools/prewarm.mjs', import.meta.url).pathname, ...a], { encoding: 'utf8', timeout: 30000 });
let r = run();
ok(r.status === 0 && /dry-run/.test(r.stdout) && /次真调用/.test(r.stdout), 'prewarm 默认只列清单和花费（dry-run），退出码 0');
r = run('--check');
ok(r.status === 0 && /通过 api 校验/.test(r.stdout), 'prewarm --check：演示卡全过校验，答案文件版本一致');
r = run('--bogus');
ok(r.status === 2, '不认识的参数 → 退出码 2');
r = run('--run');
ok(r.status === 2 && /--url/.test(r.stderr), '--run 不给 --url → 退出码 2，不联网');
done();
