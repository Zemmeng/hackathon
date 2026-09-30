#!/usr/bin/env python3
"""用途：把 SUMO 结果预先跑好、存成静态文件（兜底 C，D-0930-1700）。云端连不上 / 限流 / 忙 / 超时 / 运行失败时，
      网页改读这里，并且必须标「预先跑好」。只调现成的 HTTP 接口（本机 serve.py 或线上 /api/sumo/v1），不自己算。

      预设：seed 42 默认参数（绕行 0.45、流量 1.0），4 种情景，存 index + 每个 manifest + 每个 frames 块
      格点：绕行 {0, 0.15, 0.3, 0.45, 0.6} × 流量 {0.8, 1.0, 1.2}，seed 42，4 种情景，只存 index（指标）
      一次只提交一个任务（服务端串行）；429 / 503 等一会儿重试；每秒查一次状态，单次最多等 180 s
      每个 frames 块按 manifest 里的 sha256 和字节数核对；所有运行的 generator_sha256 / 引擎必须一致
      先写进同级临时目录，全部成功再整体换掉 --out；预设失败什么都不写。格点失败照记 failed + 原因，不丢、不编

用法（仓库根目录，Python ≥ 3.9，只用标准库）：
  python3 apps/sumo/tools/bake.py --base http://127.0.0.1:8051/sumo/v1 --source local-macos-arm64
  python3 apps/sumo/tools/bake.py --base https://hackathon-site.zemmmeng.workers.dev/api/sumo/v1 --source cloudflare-container
  其他参数：--out <目录>（默认 apps/sumo/public/baked）；--header K:V（可重复）；
           --only preset|grid 只重跑一半，另一半从现有 --out 原样保留（生成器或引擎不一致就拒绝合并）；
           --dry-run 只查 /health、打印计划，不提交、不写文件
退出码：0 已写入且没有服务类失败；1 什么都没写（连不上 / 预设失败 / 生成器不一致 / 参数错）；
        2 已写入，但有格点因服务出错（超时、连不上、一直 429）记成 failed，建议 --only grid 重跑
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_OUT = HERE.parent / 'public' / 'baked'
SCENARIOS = ['baseline', 'closure', 'guided', 'footpath']
# 和 build_demo.py 的 DEFAULT_CONFIG 一致；全部显式传，baked.json 里记下的就是实际提交的
PRESET = {'seed': 42, 'scenarios': SCENARIOS, 'demand_duration_s': 600, 'clearance_s': 1200,
          'demand_scale': 1.0, 'diversion_share': 0.45}
GRID_DIVERSION = [0, 0.15, 0.3, 0.45, 0.6]
GRID_DEMAND = [0.8, 1.0, 1.2]
POLL_S = 1
RUN_TIMEOUT_S = 180
RETRY_WAIT_MAX_S = 300   # 单个点在 429 / 503 / 502 上最多累计等这么久
MB = 1024 * 1024         # 和 scripts/check.sh [6] 一样按 MiB 算
FILE_CAP, TOTAL_CAP = 2 * MB, 25 * MB


class Fatal(Exception):
    """整次烘焙作废：什么都不写"""


class RunFailed(Exception):
    """单个点失败；kind = 'sumo'（SUMO 自己判失败，是结果）或 'service'（服务出错，不是结果）"""

    def __init__(self, kind, error):
        super().__init__(error)
        self.kind, self.error = kind, error


def grid_key(seed, diversion, demand):
    return 's%d-d%.2f-x%.1f' % (seed, diversion, demand)


def grid_points():
    return [dict(PRESET, diversion_share=d, demand_scale=x) for d in GRID_DIVERSION for x in GRID_DEMAND]


class Api:
    def __init__(self, base, headers):
        self.base = base.rstrip('/')
        self.headers = {'Accept': 'application/json', 'User-Agent': 'rippletwin-bake/1', **headers}

    def call(self, method, path, body=None, timeout=30):
        """→ (状态码, 原始字节, 响应头)；HTTP 错误照样返回，连不上抛 OSError"""
        data = None if body is None else json.dumps(body, separators=(',', ':')).encode()
        headers = dict(self.headers, **({'Content-Type': 'application/json'} if data is not None else {}))
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read(), r.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers

    def json(self, path, timeout=30):
        status, raw, _ = self.call('GET', path, timeout=timeout)
        if status != 200:
            raise RunFailed('service', 'GET %s → %d %s' % (path, status, describe(raw)))
        try:
            return json.loads(raw), raw
        except ValueError:
            raise RunFailed('service', 'GET %s 不是 JSON' % path)


def describe(raw):
    """容器回 {error: 句子}，Worker 回 {ok:false, error: 短码, msg}；两种都认"""
    try:
        v = json.loads(raw)
        if isinstance(v, dict):
            code, msg = v.get('error'), v.get('msg')
            return ' '.join(str(s) for s in (code, msg) if s) or raw[:200].decode('utf-8', 'replace')
    except ValueError:
        pass
    return raw[:200].decode('utf-8', 'replace')


def code_of(raw):
    try:
        v = json.loads(raw)
        return v.get('error') if isinstance(v, dict) else None
    except ValueError:
        return None


def health(api, log, wait_max=90):
    """容器冷启动时 Worker 回 503 sumo_starting / 502：最多等 wait_max 秒；其他错误直接作废"""
    waited = 0
    while True:
        try:
            status, raw, _ = api.call('GET', '/health', timeout=30)
        except OSError as e:
            raise Fatal('连不上 %s/health：%s' % (api.base, e))
        if status in (502, 503) and code_of(raw) != 'sumo_off' and waited < wait_max:
            log('   … /health → %d %s，等 10 s（容器可能在冷启动）' % (status, code_of(raw) or ''))
            time.sleep(10)
            waited += 10
            continue
        break
    if status != 200:
        raise Fatal('%s/health → %d %s' % (api.base, status, describe(raw)))
    try:
        h = json.loads(raw)
    except ValueError:
        raise Fatal('%s/health 返回的不是 JSON（地址填错了？）' % api.base)
    if not isinstance(h, dict) or not h.get('engine'):
        raise Fatal('%s/health 没有 engine 字段：%s' % (api.base, raw[:200]))
    return h


def submit(api, params, log):
    """POST /runs，遇到 429 / 503 / 502 / 连不上就等一会儿再试 → 任务 id"""
    waited = 0
    while True:
        try:
            status, raw, headers = api.call('POST', '/runs', params, timeout=30)
        except OSError as e:
            status, raw, headers = 0, str(e).encode(), {}
        if status == 202:
            job = json.loads(raw)
            return job['id']
        code = code_of(raw)
        if status == 503 and code == 'sumo_off':
            raise Fatal('服务没开（503 sumo_off）：site 没绑 SUMO')
        if status in (0, 429, 502, 503, 504):
            try:
                wait = int((headers or {}).get('Retry-After') or 0)
            except ValueError:
                wait = 0
            wait = max(wait, 15 if status == 429 else 10)
            if waited + wait > RETRY_WAIT_MAX_S:
                raise RunFailed('service', 'POST /runs 一直不成功（最后 %s %s），已等 %d s' % (status or '连不上', describe(raw), waited))
            log('   … POST /runs → %s %s，等 %d s 再试' % (status or '连不上', code or describe(raw)[:80], wait))
            time.sleep(wait)
            waited += wait
            continue
        # 400 / 413 等：参数问题，重试也没用
        raise RunFailed('service', 'POST /runs → %d %s' % (status, describe(raw)))


def wait_done(api, run_id, log):
    start, previous, errors = time.monotonic(), None, 0
    while True:
        if time.monotonic() - start > RUN_TIMEOUT_S:
            raise RunFailed('service', 'timeout：%d s 内没跑完（run %s）' % (RUN_TIMEOUT_S, run_id))
        try:
            status, raw, _ = api.call('GET', '/runs/' + run_id, timeout=15)
        except OSError as e:
            status, raw = 0, str(e).encode()
        if status == 404:
            raise RunFailed('service', 'run %s 不见了（容器重启过？）：%s' % (run_id, describe(raw)))
        if status != 200:
            errors += 1
            if errors >= 5:
                raise RunFailed('service', '连续 5 次查不到状态（最后 %s %s）' % (status or '连不上', describe(raw)))
            time.sleep(POLL_S)
            continue
        errors = 0
        job = json.loads(raw)
        if job.get('status') != previous:
            previous = job.get('status')
            log('   … %s %s（%.1f s）' % (run_id[:8], previous, time.monotonic() - start))
        if previous == 'complete':
            return time.monotonic() - start
        if previous == 'failed':
            # 服务端的原话原样记下（SUMO 的完整性检查、没清空、碰撞……）；重启打断的算服务问题
            error = str(job.get('error') or 'failed（没有原因）')
            raise RunFailed('service' if 'restarted' in error else 'sumo', error)
        time.sleep(POLL_S)


def check_config(index, params):
    got = index.get('config') or {}
    for k in ('seed', 'demand_duration_s', 'clearance_s', 'demand_scale', 'diversion_share'):
        if got.get(k) != params[k]:
            raise Fatal('服务端记的 %s=%r，和提交的 %r 不一样' % (k, got.get(k), params[k]))
    ids = [s.get('id') for s in index.get('scenarios') or []]
    if sorted(ids) != sorted(params['scenarios']):
        raise Fatal('index.json 的情景 %s ≠ 提交的 %s' % (ids, params['scenarios']))


def fetch_run(api, run_id, params, dest, frames):
    """下载一次完成的运行。frames=True：index + 4 个 manifest + 所有块写进 dest/；False：只把 index 写到 dest（文件路径）。
    → (index 原始字节, generator_sha256, 引擎)"""
    prefix = '/runs/' + run_id
    index, index_raw = api.json(prefix + '/index.json')
    check_config(index, params)
    generator = None
    files = {}
    for s in index['scenarios']:
        sid = s['id']
        if not frames and sid != 'baseline':
            continue   # 格点只要 index；读一个 manifest 拿生成器指纹就够
        m, m_raw = api.json('%s/%s/manifest.json' % (prefix, sid))
        if m.get('scenario') != sid or m.get('demand_hash') != index.get('demand_hash'):
            raise Fatal('%s manifest 的 scenario / demand_hash 对不上 index' % sid)
        g = (m.get('provenance') or {}).get('generator_sha256')
        if not g or (generator and g != generator):
            raise Fatal('同一次运行里 generator_sha256 不一致或缺失：%s' % g)
        generator = g
        if not frames:
            continue
        files['%s/manifest.json' % sid] = m_raw
        for c in m['chunks']:
            status, raw, _ = api.call('GET', '%s/%s/%s' % (prefix, sid, c['file']), timeout=60)
            if status != 200:
                raise Fatal('GET %s/%s → %d %s' % (sid, c['file'], status, describe(raw)))
            if hashlib.sha256(raw).hexdigest() != c['sha256']:
                raise Fatal('%s/%s sha256 对不上 manifest' % (sid, c['file']))
            if 'bytes' in c and len(raw) != c['bytes']:
                raise Fatal('%s/%s 字节数 %d ≠ manifest 的 %d' % (sid, c['file'], len(raw), c['bytes']))
            if len(json.loads(raw)['frames']) != c['frames']:
                raise Fatal('%s/%s 帧数对不上 manifest' % (sid, c['file']))
            files['%s/%s' % (sid, c['file'])] = raw
    if frames:
        files['index.json'] = index_raw
        for rel, raw in files.items():
            (dest / rel).parent.mkdir(parents=True, exist_ok=True)
            (dest / rel).write_bytes(raw)
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(index_raw)
    return index_raw, generator, index.get('engine')


def bake_one(api, params, dest, frames, log):
    run_id = submit(api, params, log)
    elapsed = wait_done(api, run_id, log)
    index_raw, generator, engine = fetch_run(api, run_id, params, dest, frames)
    return {'run_id': run_id, 'elapsed_s': round(elapsed, 1), 'generator': generator, 'engine': engine, 'index_raw': index_raw}


def size_table(root, log):
    rows, total, count, largest = [], 0, 0, (0, '')
    groups = {}
    for f in sorted(p for p in root.rglob('*') if p.is_file()):
        rel = f.relative_to(root).as_posix()
        sz = f.stat().st_size
        total += sz
        count += 1
        largest = max(largest, (sz, rel))
        parts = rel.split('/')
        group = rel if len(parts) == 1 or rel == 'preset/index.json' else '/'.join(parts[:-1]) + '/'
        n, s, big = groups.get(group, (0, 0, 0))
        groups[group] = (n + 1, s + sz, max(big, sz))
    log('\n%-22s %6s %11s %11s' % ('路径', '文件数', '合计', '最大单个'))
    for g, (n, s, big) in groups.items():
        log('%-24s %6d %9.2f MB %9.2f MB' % (g, n, s / MB, big / MB))
    log('%-24s %6d %9.2f MB   最大：%s %.2f MB' % ('总计', count, total / MB, largest[1], largest[0] / MB))
    warned = False
    for f in root.rglob('*'):
        if f.is_file() and f.stat().st_size > FILE_CAP:
            warned = True
            log('⚠️  %s %.2f MB > 2 MB（仓库 .json 上限，D-0929-1430；pre-commit 会拦）' % (f.relative_to(root), f.stat().st_size / MB))
    if total > TOTAL_CAP:
        warned = True
        log('⚠️  总计 %.1f MB > 25 MB：考虑只留 baseline / closure 的 frames' % (total / MB))
    return {'files': count, 'bytes': total, 'largest': largest[1], 'largest_bytes': largest[0], 'warned': warned}


def swap_in(tmp, out):
    """tmp 已完整 → 换掉 out：两次 rename，中间没有半成品目录"""
    old = None
    if out.exists():
        old = out.parent / ('.%s.old-%d' % (out.name, os.getpid()))
        out.rename(old)
    tmp.rename(out)
    if old:
        shutil.rmtree(old, ignore_errors=True)


def main(argv=None):
    ap = argparse.ArgumentParser(description='预先跑好 SUMO 结果（兜底 C）', formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--base', required=True, help='…/sumo/v1 或 …/api/sumo/v1（不带结尾斜杠）')
    ap.add_argument('--out', type=Path, default=DEFAULT_OUT)
    ap.add_argument('--source', required=True, help='在哪跑的，写进 baked.json：cloudflare-container / local-macos-arm64 …')
    ap.add_argument('--header', action='append', default=[], metavar='K:V')
    ap.add_argument('--only', choices=['preset', 'grid'])
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args(argv)
    log = lambda s='': print(s, flush=True)

    headers = {}
    for h in args.header:
        k, sep, v = h.partition(':')
        if not sep or not k.strip():
            log('❌ --header 要写成 K:V：%s' % h)
            return 1
        headers[k.strip()] = v.strip()
    api = Api(args.base, headers)
    out = args.out.resolve()
    do_preset, do_grid = args.only in (None, 'preset'), args.only in (None, 'grid')
    points = grid_points() if do_grid else []

    try:
        h = health(api, log)
        log('✅ %s/health：%s · active_jobs=%s' % (api.base, h['engine'], h.get('active_jobs')))
        if args.dry_run:
            log('计划（--dry-run，不提交、不写文件）→ %s' % out)
            if do_preset:
                log('  preset  %s  + 4 个 manifest + 全部 frames' % json.dumps(PRESET))
            for p in points:
                log('  grid    %s  %s' % (grid_key(p['seed'], p['diversion_share'], p['demand_scale']), json.dumps(p)))
            log('共 %d 次运行（和预设参数相同的格点直接复用预设那次）' % (int(do_preset) + len(points) - (1 if do_preset and do_grid else 0)))
            return 0

        old = None
        if args.only and (out / 'baked.json').exists():
            old = json.loads((out / 'baked.json').read_text(encoding='utf-8'))
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = Path(tempfile.mkdtemp(prefix='.%s.tmp-' % out.name, dir=out.parent))
        try:
            return bake(api, args, out, tmp, old, do_preset, points, log)
        finally:
            if tmp.exists():
                shutil.rmtree(tmp, ignore_errors=True)
    except Fatal as e:
        log('❌ %s\n什么都没写（%s 保持原样）' % (e, out))
        return 1
    except KeyboardInterrupt:
        log('\n❌ 中断：什么都没写（%s 保持原样）' % out)
        return 1


def bake(api, args, out, tmp, old, do_preset, points, log):
    t0 = time.monotonic()
    generators, engines = set(), set()
    done = {}   # 规范参数串 → 那次运行（和预设相同的格点直接复用）
    catalog = {'version': 1, 'generated_at': None, 'source': args.source, 'engine': None, 'generator_sha256': None,
               'preset': None, 'grid': []}
    service_failures = 0

    if do_preset:
        log('▶ preset %s' % json.dumps(PRESET))
        try:
            r = bake_one(api, PRESET, tmp / 'preset', True, log)
        except RunFailed as e:
            raise Fatal('预设运行失败（%s）：%s' % (e.kind, e.error))
        generators.add(r['generator']); engines.add(r['engine'])
        done[json.dumps(PRESET, sort_keys=True)] = r
        catalog['preset'] = {'params': PRESET, 'path': 'preset/index.json', 'run_id': r['run_id'], 'elapsed_s': r['elapsed_s']}
        log('✅ preset %.1f s（run %s）' % (r['elapsed_s'], r['run_id']))
    elif old is not None:
        if old.get('preset'):
            shutil.copytree(out / 'preset', tmp / 'preset')
            catalog['preset'] = old['preset']
            generators.add(old.get('generator_sha256')); engines.add(old.get('engine'))

    for i, p in enumerate(points, 1):
        key = grid_key(p['seed'], p['diversion_share'], p['demand_scale'])
        entry = {'key': key, 'params': p}
        dest = tmp / 'grid' / (key + '.json')
        same = done.get(json.dumps(p, sort_keys=True))
        log('▶ grid %d/%d %s' % (i, len(points), key))
        if same:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(same['index_raw'])
            entry.update(status='complete', path='grid/%s.json' % key, run_id=same['run_id'], elapsed_s=same['elapsed_s'])
            log('✅ %s 和预设参数相同，复用 run %s' % (key, same['run_id']))
        else:
            try:
                r = bake_one(api, p, dest, False, log)
                generators.add(r['generator']); engines.add(r['engine'])
                done[json.dumps(p, sort_keys=True)] = r
                entry.update(status='complete', path='grid/%s.json' % key, run_id=r['run_id'], elapsed_s=r['elapsed_s'])
                log('✅ %s %.1f s' % (key, r['elapsed_s']))
            except RunFailed as e:
                service_failures += e.kind == 'service'
                entry.update(status='failed', error_kind=e.kind, error=e.error[-3000:])
                log('❌ %s failed（%s）：%s' % (key, e.kind, e.error.strip().splitlines()[0][:200] if e.error.strip() else ''))
        catalog['grid'].append(entry)
    if not points and old is not None:
        if old.get('grid'):
            if (out / 'grid').exists():
                shutil.copytree(out / 'grid', tmp / 'grid')
            catalog['grid'] = old['grid']
            generators.add(old.get('generator_sha256')); engines.add(old.get('engine'))
            service_failures += sum(1 for g in old['grid'] if g.get('error_kind') == 'service')

    generators.discard(None); engines.discard(None)
    if len(generators) > 1 or len(engines) > 1:
        # generator_sha256 是运行那一刻磁盘上 build_demo.py 的哈希：烘焙途中改了文件 / 换了容器版本都会到这里
        raise Fatal('generator_sha256 / 引擎不一致，不能混在一份里：%s %s（烘焙途中 build_demo.py 或容器版本变了？'
                    '等它稳定后全量重跑，不要 --only）' % (sorted(generators), sorted(engines)))
    if not generators:
        raise Fatal('一次都没跑成功，没有东西可写')
    catalog.update(generated_at=datetime.now(timezone.utc).isoformat(timespec='seconds'),
                   engine=engines.pop(), generator_sha256=generators.pop())
    (tmp / 'baked.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    sizes = size_table(tmp, log)
    tmp.chmod(0o755)   # mkdtemp 建的是 0700
    swap_in(tmp, out)
    failed = [g['key'] for g in catalog['grid'] if g['status'] != 'complete']
    log('\n✅ 写入 %s：%d 个文件 %.2f MB，用时 %.0f s；格点 %d/%d complete%s'
        % (out, sizes['files'], sizes['bytes'] / MB, time.monotonic() - t0,
           len(catalog['grid']) - len(failed), len(catalog['grid']), ('，failed：' + ', '.join(failed)) if failed else ''))
    if service_failures:
        log('⚠️  %d 个格点是服务出错（不是 SUMO 的结果）：跑 --only grid 补' % service_failures)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
