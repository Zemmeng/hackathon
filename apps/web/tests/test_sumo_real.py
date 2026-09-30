"""真实 CBD 路网 SUMO 回放（contract v2）：烘焙副本 apps/sumo/public/real/ 的形状 + build_real.py 的纯函数。
T48：整整一小时 08:00–09:00（clock0_s = 0），回放只有 original / ai（baseline 只出指标），只含页面视野里的车，每 2 s 一帧；
新指标 works_queue_end_m / works_queue_equiv_end_m / queue_series / works_throughput_vph / works_capacity_assumption_vph。
不需要 SUMO；装了 SUMO 的 venv（环境变量 SUMO_PY，或 README 里的 /tmp/rippletwin-sumo-venv）时再真跑查可复现。
"""
import hashlib
import json
import math
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve()
REPO = HERE.parents[3]
TOOLS = HERE.parents[1]/'tools/sumo'
REAL = REPO/'apps/sumo/public/real'
sys.path.insert(0, str(TOOLS))
import build_real  # noqa: E402

IDS = ['baseline', 'original', 'ai']
PLAYED = ['original', 'ai']
# contract A：至少这 16 个路口（La Trobe / Little Lonsdale / Lonsdale / Little Bourke × Elizabeth / Swanston / Russell / Exhibition）
SITES16 = ['2922', '2921', '2920', '2919', '2914', '2913', '2912', '2911', '2906', '2904', '2903', '2902', '4606', '4605', '4604', '4603']
MB15 = 1.5*1024*1024
SCENARIO_BYTES = 18e6  # 每个情景的回放合计（目标约 15 MB；实测 15–17.5 MB，见 README）
NEW_METRICS = {'works_queue_end_m', 'works_queue_equiv_end_m', 'queue_series', 'works_throughput_vph', 'works_capacity_assumption_vph'}


def load(p):
    return json.loads(pathlib.Path(p).read_text(encoding='utf-8'))


def metres(lon_e6, lat_e6, lon0_e6, lat0_e6):
    return ((lon_e6-lon0_e6)/1e6*build_real.KX, (lat_e6-lat0_e6)/1e6*build_real.KY)


def uv_of(lon_e6, lat_e6):
    return build_real.UV(*build_real.xy(lat_e6/1e6, lon_e6/1e6))


def sumo_python():
    for p in [os.environ.get('SUMO_PY'), '/tmp/rippletwin-sumo-venv/bin/python']:
        if p and pathlib.Path(p).exists():
            r = subprocess.run([p, '-c', 'import sumo, numpy, scipy'], capture_output=True)
            if r.returncode == 0:
                return p
    return None


class RealReplay(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index = load(REAL/'index.json')
        cls.man = {k: load(REAL/k/'manifest.json') for k in IDS}

    def frames(self, k):
        for c in self.man[k]['chunks']:
            for f in load(REAL/k/c['file'])['frames']:
                yield f

    def test_index_contract(self):
        i = self.index
        self.assertEqual((i['version'], i['network'], i['hour']), (2, 'real', 8))
        self.assertIn('Eclipse SUMO sumo 1.27.1', i['engine'])
        self.assertEqual(i['works'], {'link': 'l595594354_9756035316', 'lanes_closed': 1})
        self.assertRegex(i['generator_sha256'], '^[0-9a-f]{64}$')
        self.assertEqual(type(i['seed']), int)
        p = i['params']
        for k in ['seed', 'p_original', 'p_ai', 'scenarios', 'source', 'signal_2935_green', 'warmup_s', 'shown_s',
                  'hour_window', 'green_2935', 'network_extent', 'sim_s', 'sample_s']:
            self.assertIn(k, p)
        self.assertEqual(p['hour_window'], [8, 9])
        self.assertEqual((p['shown_s'], p['sim_s'], p['sample_s']), (3600, p['warmup_s']+3600, 2))
        self.assertEqual(p['green_2935'], p['signal_2935_green'])
        self.assertTrue(isinstance(p['network_extent'], str) and 'Spring' in p['network_extent'])
        # 烘焙副本用和云端同一个镜像（linux/amd64）跑：routeSampler 在 macOS 和 Linux 上挑的需求不一样，只有同平台才能和云端现场一致
        self.assertEqual(p['source'], 'docker-linux-amd64')
        self.assertEqual((p['p_original'], p['p_ai']), (.14, .53))
        self.assertTrue(i['assumptions']['en'] and len(i['assumptions']['en']) == len(i['assumptions']['zh']))
        en = ' '.join(i['assumptions']['en'])
        self.assertIn('%d%%' % round(p['green_2935']*100), en)
        self.assertIn('810 veh/h', en)
        self.assertNotIn('{', en+' '.join(i['assumptions']['zh']))
        self.assertEqual([s['id'] for s in i['scenarios']], IDS)
        for s in i['scenarios']:
            self.assertEqual(s['manifest'], s['id']+'/manifest.json')
            self.assertTrue(s['label']['en'] and s['label']['zh'])
            self.assertEqual(s['metrics'], self.man[s['id']]['metrics'])
        self.assertEqual([s['diversion_share'] for s in i['scenarios']], [0, .14, .53])

    def test_baked_copy_is_from_this_generator(self):
        # 改了 build_real.py 就要重烘（镜像里约 1 分钟，命令见 README「真实路网」）
        self.assertEqual(self.index['generator_sha256'], hashlib.sha256((TOOLS/'build_real.py').read_bytes()).hexdigest())

    def test_manifest_contract(self):
        keys = {'vehicles', 'completed', 'teleports', 'collisions', 'mean_timeloss_s', 'mean_extra_s', 'works_queue_max_m',
                'works_queue_mean_m', 'detour_vehicles'} | NEW_METRICS
        for k, m in self.man.items():
            with self.subTest(k=k):
                self.assertEqual((m['version'], m['network'], m['scenario']), (2, 'real', k))
                self.assertIn(m['sample_s'], (1, 2))
                self.assertEqual(m['agent_columns'], ['i', 'lon_e6', 'lat_e6', 'angle_deg', 'speed_cms'])
                # 整整一小时：t = 0 ↔ 08:00:00，展示到 09:00
                self.assertEqual((m['clock0_s'], m['duration_s']), (0, 3600))
                self.assertTrue(keys <= set(m['metrics']))
                self.assertEqual(m['metrics']['collisions'], 0)
                self.assertTrue(all(a['type'] in ('car', 'bus') and a['length_m'] > 0 and a['width_m'] > 0 for a in m['agents']))
                self.assertEqual(len({a['id'] for a in m['agents']}), len(m['agents']))
                self.assertEqual((len(m['per_minute']['halting']), len(m['per_minute']['harsh'])), (60, 60))
                if k in PLAYED:
                    self.assertEqual(m['metrics']['vehicles'], len(m['agents']))
                    # 分块首尾相接、覆盖 0 … duration_s − sample_s
                    dt = m['sample_s']
                    self.assertEqual(m['chunks'][0]['start'], 0)
                    self.assertEqual(m['chunks'][-1]['end'], m['duration_s']-dt)
                    for a, b in zip(m['chunks'], m['chunks'][1:]):
                        self.assertEqual(b['start'], a['end']+dt)
                    self.assertEqual(sum(c['frames'] for c in m['chunks']), m['duration_s']//dt)
                else:
                    # baseline 页面不播：只有指标
                    self.assertEqual((m['chunks'], m['agents']), ([], []))
        self.assertIsNone(self.man['baseline']['metrics']['mean_extra_s'])
        self.assertEqual(self.man['baseline']['metrics']['detour_vehicles'], 0)
        for k in PLAYED:
            self.assertEqual(type(self.man[k]['metrics']['mean_extra_s']), float)
        # 同一批车、同一个抽签数：绕行比例高的情景绕行车不会更少
        self.assertGreaterEqual(self.man['ai']['metrics']['detour_vehicles'], self.man['original']['metrics']['detour_vehicles'])
        self.assertGreater(self.man['ai']['metrics']['detour_vehicles'], 0)

    def test_queue_metrics(self):
        for k, m in self.man.items():
            mt = m['metrics']
            with self.subTest(k=k):
                s = mt['queue_series']
                self.assertEqual([x[0] for x in s], list(range(61)))  # 每分钟一项，0 … 60
                self.assertTrue(all(len(x) == 3 and x[1] >= 0 and x[2] >= 0 for x in s))
                self.assertEqual((s[-1][1], s[-1][2]), (mt['works_queue_end_m'], mt['works_queue_equiv_end_m']))
                self.assertEqual(mt['works_queue_equiv_max_m'], max(x[2] for x in s))
                self.assertEqual(mt['works_capacity_assumption_vph'], 810)
                self.assertGreater(mt['works_throughput_vph'], 0)
                # 实际排队只在 Lonsdale / Albert 西行链上，超不过链长
                self.assertLessEqual(mt['works_queue_end_m'], self.index['params']['chain_m'])
                # 引擎算法是 7 m ÷ 2 条车道一辆：米数 = 车数 × 3.5，取周期平均后不必是整数倍，但不会是负的
                self.assertGreaterEqual(mt['works_queue_equiv_end_m'], 0)
                self.assertGreaterEqual(mt['teleports'], mt['teleports_in_hour'])
                self.assertGreaterEqual(mt['teleports_in_hour'], mt['teleports_works_bound'])
        b, o, a = (self.man[k]['metrics'] for k in IDS)
        # 标定：封一条车道后施工段实际放行量要对上引擎的 810 辆/小时（2935 绿信比就是为这个选的）
        self.assertLess(abs(o['works_throughput_vph']-810), 60, o['works_throughput_vph'])
        # 无施工时施工段不是瓶颈：放行量 ≈ 需求，排队短
        self.assertGreater(b['works_throughput_vph'], 1000)
        self.assertLess(b['works_queue_equiv_end_m'], 100)
        # 有施工：一小时里排队（引擎算法）一路涨上去；原方案绕行少，排得比 AI 方案长
        self.assertGreater(o['works_queue_equiv_end_m'], 500)
        self.assertGreater(o['works_queue_equiv_end_m'], a['works_queue_equiv_end_m'])
        s = o['queue_series']
        self.assertGreater(s[60][2], s[30][2]); self.assertGreater(s[30][2], s[10][2])
        # 对照组算法（同一批车无施工时已过、有施工时还没过）和引擎算法差不到 25%
        self.assertLess(abs(o['works_queue_vs_baseline_end_m']-o['works_queue_equiv_end_m']), .25*o['works_queue_equiv_end_m'])
        self.assertIsNone(b['works_queue_vs_baseline_end_m'])
        # 施工排队里的车不会被瞬移（每个周期都往前挪）
        for m in (o, a):
            self.assertEqual(m['teleports_works_bound'], 0)

    def test_files_small_and_chunks_hashed(self):
        files = [p for p in REAL.rglob('*') if p.is_file()]
        big = [(p.relative_to(REAL).as_posix(), p.stat().st_size) for p in files if p.stat().st_size >= MB15]
        self.assertEqual(big, [])
        listed = {'index.json'} | {k+'/manifest.json' for k in IDS}
        for k, m in self.man.items():
            total = (REAL/k/'manifest.json').stat().st_size
            for c in m['chunks']:
                data = (REAL/k/c['file']).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), c['sha256'], k+'/'+c['file'])
                self.assertEqual(len(data), c['bytes'])
                self.assertRegex(c['file'], r'^frames-\d{3}\.json$')
                listed.add(k+'/'+c['file']); total += len(data)
            self.assertLess(total, SCENARIO_BYTES, k)
        self.assertEqual({p.relative_to(REAL).as_posix() for p in files}, listed)  # 没有多余的原始文件混进来

    def test_frames_inside_view(self):
        u0, u1, v0, v1 = build_real.VIEW_BOX
        for k in PLAYED:
            m = self.man[k]
            with self.subTest(k=k):
                tls = {h['tls'] for h in m['signal_heads']}
                n, qs, ts = len(m['agents']), [], []
                for f in self.frames(k):
                    ts.append(f['t']); qs.append(f['q'])
                    self.assertGreaterEqual(f['q'], 0)
                    self.assertEqual(set(f['tls']), tls)
                    self.assertTrue(all(set(s) <= set('GgyYrRuoOs') for s in f['tls'].values()))
                    for a in f['a']:
                        self.assertEqual(len(a), 5)
                        self.assertTrue(0 <= a[0] < n and all(type(x) is int for x in (a[0], a[1], a[2], a[4])))
                        # 只有页面视野（16 个路口外扩一点、往东 140 m）里的车；经纬度取整到 1e-6 度，给 0.5 m 余量
                        u, v = uv_of(a[1], a[2])
                        self.assertTrue(u0-.5 <= u <= u1+.5 and v0-.5 <= v <= v1+.5, a)
                        self.assertTrue(0 <= a[3] < 360 and a[4] >= 0, a)
                    self.assertEqual(len({a[0] for a in f['a']}), len(f['a']))
                self.assertEqual(ts, list(range(0, m['duration_s'], m['sample_s'])))
                self.assertEqual(max(qs), m['metrics']['works_queue_max_m'])
                self.assertAlmostEqual(sum(qs)/len(qs), m['metrics']['works_queue_mean_m'], delta=.06)
                # 回放里出现过的车 = 目录里的车
                seen = set()
                for f in self.frames(k):
                    seen.update(a[0] for a in f['a'])
                self.assertEqual(seen, set(range(n)))

    def test_heading_matches_motion(self):
        # angle_deg 是 SUMO 约定（0 = 北、顺时针）：页面坐标（x 东、y 北）里朝向 = [sin a, cos a]，要跟实际位移同向
        prev, ok, bad = {}, 0, 0
        for f in self.frames('original'):
            cur = {a[0]: a for a in f['a']}
            for i, a in cur.items():
                p = prev.get(i)
                if p and a[4] > 800 and p[4] > 800 and abs(a[3]-p[3]) < 2:
                    dx, dy = metres(a[1], a[2], p[1], p[2])
                    r = math.radians(a[3])
                    cos = (dx*math.sin(r)+dy*math.cos(r))/max(1e-9, math.hypot(dx, dy))
                    ok += cos > .98; bad += cos <= .98
            prev = cur
        self.assertGreater(ok, 1000)
        self.assertLess(bad, ok*.01)

    def test_centre_not_front_bumper(self):
        # 朝东（90°）的车：中心在车头西边半个车长；朝北（0°）：在车头南边
        x, y = build_real.centre(100, 50, 90, 4.6)
        self.assertAlmostEqual(x, 97.7); self.assertAlmostEqual(y, 50)
        x, y = build_real.centre(0, 0, 0, 5)
        self.assertAlmostEqual(x, 0); self.assertAlmostEqual(y, -2.5)
        lon, lat = build_real.lonlat_e6(*build_real.xy(-37.8108, 144.9672))
        self.assertEqual((lon, lat), (144967200, -37810800))
        # 反过来：回放里停着的车（speed 0）中心不会压在停止线上的信号头正中（车头在线后 ≥ 0，中心再后 2.3 m）
        heads = [(h['lon_e6'], h['lat_e6']) for h in self.man['original']['signal_heads']]
        stopped = [a for f in self.frames('original') if f['t'] == 600 for a in f['a'] if a[4] == 0]
        near = [min(math.hypot(*metres(a[1], a[2], hx, hy)) for hx, hy in heads) for a in stopped]
        self.assertTrue(stopped and min(near) > 1.0, min(near) if near else None)

    def test_signal_heads_cover_16_junctions(self):
        sites = {s['site']: s for s in load(REPO/'apps/roads/public/cbd/signals.json')['sites']}
        for k in PLAYED:
            m = self.man[k]
            heads = m['signal_heads']
            self.assertTrue(all(h['idx'] and all(type(x) is int for x in h['idx']) for h in heads))
            self.assertTrue(all(build_real.in_box(build_real.VIEW_BOX, *uv_of(h['lon_e6'], h['lat_e6'])) for h in heads))
            f = next(self.frames(k))
            for h in heads:
                self.assertLess(max(h['idx']), len(f['tls'][h['tls']]))
            for sid in SITES16 + ['2935']:
                s = sites[sid]
                d = min(math.hypot(*metres(h['lon_e6'], h['lat_e6'], s['lon']*1e6, s['lat']*1e6)) for h in heads)
                self.assertLess(d, 60, (k, sid, s['name'], round(d)))

    def test_validate_real(self):
        v = build_real.validate_real({})
        self.assertEqual(v, {'seed': 42, 'p_original': .14, 'p_ai': .53, 'scenarios': IDS})
        self.assertEqual(build_real.validate_real({'network': 'real', 'scenarios': ['ai', 'baseline']})['scenarios'], ['baseline', 'ai'])
        for ok in [{'seed': 0}, {'seed': 2147483647}, {'p_original': 0}, {'p_ai': 1}, {'p_ai': .5}, {'scenarios': ['original']}]:
            with self.subTest(ok=ok):
                build_real.validate_real(ok)
        for bad in [None, [], 'x', {'network': 'synthetic'}, {'seed': -1}, {'seed': 2147483648}, {'seed': 1.0}, {'seed': True},
                    {'seed': '1'}, {'p_original': -.01}, {'p_ai': 1.01}, {'p_ai': float('nan')}, {'p_ai': float('inf')}, {'p_ai': '0.5'},
                    {'p_ai': True}, {'scenarios': []}, {'scenarios': ['closure']}, {'scenarios': 'ai'}, {'scenarios': ['ai', 'ai']},
                    {'green_2935': .5}, {'demand_scale': 2}]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                build_real.validate_real(bad)

    def test_pure_helpers(self):
        p = {'offset': 0.0, 'phases': [(60.0, 'GG'), (3.0, 'yy'), (27.0, 'rr')], 'cycle': 90.0}
        self.assertEqual([build_real.tls_state(p, t) for t in [0, 59.5, 60, 62.9, 63, 89.9, 90, 150]], ['GG', 'GG', 'yy', 'yy', 'rr', 'rr', 'GG', 'yy'])
        self.assertEqual(build_real.queue_now([0, 30, 85, 200]), 85)
        self.assertEqual(build_real.queue_now([70, 90]), 0)
        # 数车用同一个 60 m 断档规则
        self.assertEqual(build_real.queue_count([0, 7, 14, 60, 130]), 4)
        self.assertEqual(build_real.queue_count([61, 62]), 0)
        # 每分钟：最后一个 90 s 周期里实际排队取最长、引擎算法取车数平均 × 3.5 m
        ts = list(range(0, 3601, 2)); qs = [float(t % 90) for t in ts]; es = [10]*len(ts)
        s = build_real.minute_series(ts, qs, es)
        self.assertEqual(len(s), 61)
        self.assertEqual(s[0], [0, 0.0, 35.0])
        self.assertEqual(s[60][1], 88.0)
        self.assertTrue(all(x[2] == 35.0 for x in s))
        # 对照组算法：无施工时 09:00 前过了、有施工时没过 → +1；反过来 −1
        E = build_real.END
        self.assertEqual(build_real.delayed_vs_baseline({'a': E+5, 'b': 100, 'c': 50}, {'a': 200, 'b': 90, 'c': E+9}, ['a', 'b', 'c', 'd']), 0)
        self.assertEqual(build_real.delayed_vs_baseline({'b': 100}, {'a': 200, 'b': 90}, ['a', 'b']), 1)
        # 视野框：16 个路口都在里面，Spring St 不在
        for lat, lon in [(-37.810317, 144.961359), (-37.808158, 144.968743), (-37.813269, 144.962708), (-37.811104, 144.970108)]:
            self.assertTrue(build_real.in_box(build_real.VIEW_BOX, *build_real.UV(*build_real.xy(lat, lon))))
        self.assertFalse(build_real.in_box(build_real.VIEW_BOX, *build_real.UV(*build_real.xy(*build_real.SPRING_LONSDALE))))

    def test_rebuild_is_deterministic(self):
        py = sumo_python()
        if not py:
            self.skipTest('没有装了 SUMO 的 venv（设 SUMO_PY）')
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d)
            env = {**os.environ, 'SUMO_REAL_CACHE': str(d/'cache')}
            def run(name, seed, sc):
                r = subprocess.run([py, str(TOOLS/'build_real.py'), '--seed', str(seed), '--scenarios', *sc, '--output', str(d/name),
                                    '--work-dir', str(d/(name+'-raw'))], capture_output=True, text=True, env=env, timeout=900)
                self.assertEqual(r.returncode, 0, r.stdout[-2000:]+r.stderr[-2000:])
                return load(d/name/'index.json')
            a = run('a', 42, IDS)
            self.assertLess(a['timing']['total_s'], 180)
            import platform
            if platform.system() == 'Linux' and platform.machine() in ('x86_64', 'AMD64'):
                for k in IDS:
                    # 同平台、同一 seed、同一生成器：跟烘焙副本逐字节一致（source 只在 index 里）
                    self.assertEqual(load(d/'a'/k/'manifest.json'), self.man[k], k)
            else:
                # 别的平台 routeSampler 挑的需求不同（T40 实测），不和 linux/amd64 的烘焙副本比；只查本机可复现
                run('a2', 42, ['original'])
                self.assertEqual(load(d/'a2/original/manifest.json')['metrics'] | {'mean_extra_s': None, 'works_traffic_extra_s': None, 'works_queue_vs_baseline_end_m': None},
                                 load(d/'a/original/manifest.json')['metrics'] | {'mean_extra_s': None, 'works_traffic_extra_s': None, 'works_queue_vs_baseline_end_m': None})
                self.assertEqual([c['sha256'] for c in load(d/'a2/original/manifest.json')['chunks']],
                                 [c['sha256'] for c in load(d/'a/original/manifest.json')['chunks']])
            b = run('b', 43, ['baseline'])
            self.assertNotEqual(b['scenarios'][0]['metrics']['queue_series'], a['scenarios'][0]['metrics']['queue_series'])


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(RealReplay))
    failed = len(result.errors)+len(result.failures)
    skipped = len(result.skipped)
    if skipped:
        print(f'（跳过 {skipped} 项：{"; ".join(r for _, r in result.skipped)}）')
    print(f'{result.testsRun-failed-skipped} passed, {failed} failed')
    sys.exit(1 if failed else 0)
