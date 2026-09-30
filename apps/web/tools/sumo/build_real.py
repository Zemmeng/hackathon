#!/usr/bin/env python3
"""真实 CBD 路网上的 SUMO 回放（contract v2 "real network"）。
路网 = apps/roads/public/cbd/network.json（OSM），信号口 = signals.json（SCATS），需求 = flows.json 工作日 08:00。
三个情景：baseline（无施工）/ original（封一条车道 + 原方案绕行比例）/ ai（封一条车道 + AI 方案绕行比例）。
只跑原生 SUMO，不编造轨迹；路网和候选路线缓存在 SUMO_REAL_CACHE（默认系统临时目录），同一 seed 结果可复现。
用 requirements.txt 的 venv 跑；第一次建缓存要 numpy + scipy（SUMO 自带的 routeSampler.py 要）。
"""
import argparse
import hashlib
import json
import math
import os
import platform
import random
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
VERSION = '1.27.1'
HOUR = 8
# 本地平面坐标（等距近似）：net 坐标 = xy(lat, lon)，netconvert 关掉 offset 归一化，所以反算就是精确逆变换
LAT0, LON0 = -37.8115, 144.9660
KX, KY = math.cos(math.radians(LAT0))*111320.0, 110540.0
# 研究区：沿 Lonsdale 从 Elizabeth 到 Spring（再往外 35 / 60 m），横向 Bourke 到 La Trobe（各外扩 35 m）
SPRING_LONSDALE, ELIZABETH_LONSDALE = (-37.809404, 144.97214), (-37.812282, 144.962257)
RUSSELL_BOURKE, RUSSELL_LATROBE = (-37.812808, 144.968103), (-37.808882, 144.966304)
WORKS = 'l595594354_9756035316'  # Lonsdale 西行、Russell 与 2935 人行灯之间 42 m，两车道
WORKS_LANE = WORKS+'_1'          # 靠左行驶的路网里 index 1 = 中央侧（右侧）车道
WORKS_SPEED = 30/3.6             # 剩下那条车道限速 30 km/h，近似引擎的「剩余车道通行能力 ×0.9」
# Lonsdale 西行、施工段上游的路段，由近到远（路口内部段靠 60 m 断档规则跨过去）
CHAIN = ['l595594353_595594354','l595594352_595594353','l6696274751_9756035317','l6381474061_6696274751',
         'l595594348_6381474061','l6207022860_595594347','l6207022858_6207022860','l317537930_6207022858']
JBOX = {'l6696274751_9756035317':25.0,'l6207022860_595594347':25.0}  # Russell / Exhibition 路口的长度
# 绕行：Lonsdale 西行在 Russell 左转（靠路缘，不跟对向车冲突）→ Little Bourke 西行 → Swanston → Lonsdale
DETOUR_TURN, DETOUR_FIRST = 'l6696274751_9756035317', 'l1985557927_13807338304'
# 研究区切口的副作用：有些直行车的终点是施工段后面两段很短的路（QV / 停车场一侧），绕行车绕不回去，改送到 Lonsdale 西行 Swanston→Elizabeth
DEST_FIX = {'l9756035316_4544002877':'l9086096512_2190483592','l4544002877_9756035309':'l9086096512_2190483592'}
SITE_2935 = {'n245537592','n4544002877','n9756035315','n9756035316'}  # LONSDALE NR SWANSTON（POS）两侧车行道的节点
CYCLE = 90
GREEN_2935 = .70  # 2935 给 Lonsdale 车流的绿 + 黄占周期比例（假设）：50% 研究区边上堵死，91%（netconvert 默认）几乎看不出施工
WARM, SHOWN = 180, 720  # 08:00:00 空网开始；前 180 s 预热不展示，展示 08:03–08:15
END = WARM+SHOWN
STEP = .5
CHUNK_SECONDS = 60
CHUNK_BYTES = 1300000   # 单个文件硬上限 1.5 MB，留余量
QUEUE_SPEED = 1.5       # 排队：速度 < 1.5 m/s 且前后车距 ≤ 60 m 连成一串
HALT_SPEED = .1         # SUMO 的 halting 定义
HARSH_DECEL = -4.5      # 急刹：踩到 SUMO 小汽车的最大常规减速度 4.5 m/s²（约 0.46 g）的起点，每辆车每次只算一次
CAR = (4.6,1.8)
SCENARIOS = {'baseline':{'en':'No works','zh':'无施工','closed':False},
             'original':{'en':'Original plan · ROADWORK AHEAD','zh':'原方案 · ROADWORK AHEAD','closed':True},
             'ai':{'en':'AI plan · USE RUSSELL','zh':'AI 方案 · USE RUSSELL','closed':True}}
DEFAULTS = {'seed':42,'p_original':.14,'p_ai':.53,'scenarios':list(SCENARIOS)}
ASSUMPTIONS = {
 'en':['Model cross-check, not a field measurement: Eclipse SUMO on the real CBD street geometry.',
       'Network: OSM links from network.json, Elizabeth St to Spring St by Bourke St to La Trobe St (+35 m margin); lane counts and speed limits from OSM; living streets, kerbside parking and clearways not modelled.',
       'Demand: SCATS weekday 08:00 counts per link (flows.json, 38 weekdays; links without a detector interpolated), routes fitted with SUMO routeSampler; cars only (no trams, buses or trucks).',
       'Signals: SCATS gives counts but no timings, so every signal runs SUMO\'s fixed 90 s default plan; the pedestrian signal 2935 (Lonsdale near Swanston) at the works gives Lonsdale traffic {green}% of the cycle. The result depends on this: at 50% the area edge gridlocks, at 91% the works barely matter.',
       'Works: the right (median) lane of Lonsdale St westbound is closed on the 42 m link before signal 2935; the open lane runs at 30 km/h.',
       'Diversion: a fixed share of drivers who pass the sign (Lonsdale westbound before Russell St, heading through the works) turn left into Russell St, then Little Bourke St, Swanston St and back to Lonsdale St. Shares come from the engine\'s reading of each sign (ROADWORK AHEAD 14%, USE RUSSELL / SAVE 9 MIN 53%); no dynamic route choice.',
       'Time: the simulation starts empty at 08:00:00; the first 180 s are warm-up and not shown. Delay = time loss including waiting to enter, accumulated by the end of the shown window, same vehicles in every scenario.'],
 'zh':['这是模型之间的交叉检验，不是实测：在真实 CBD 街道几何上跑 Eclipse SUMO。',
       '路网：network.json 的 OSM 路段，Elizabeth St 到 Spring St、Bourke St 到 La Trobe St（外扩 35 m）；车道数和限速取 OSM；不含 living street、路边停车和清道时段。',
       '需求：SCATS 工作日 08:00 各路段流量（flows.json，38 个工作日；没有检测器的路段是插值），路线用 SUMO routeSampler 拟合；只有小汽车（没有电车、公交、货车）。',
       '信号：SCATS 只有流量没有配时，所有信号灯用 SUMO 默认的 90 s 定周期；施工点的人行灯 2935（Lonsdale 近 Swanston）给 Lonsdale 车流 {green}% 的周期。结论取决于它：50% 时研究区边上堵死，91% 时施工几乎没影响。',
       '施工：Lonsdale St 西行、2935 人行灯前那段 42 m 封右侧（中央侧）车道，剩下一条车道限速 30 km/h。',
       '绕行：经过指示牌的司机（Russell St 之前的 Lonsdale 西行、要穿过施工段）按固定比例左转 Russell St → Little Bourke St → Swanston St → 回到 Lonsdale St。比例取引擎对各块牌子的读法（ROADWORK AHEAD 14%，USE RUSSELL / SAVE 9 MIN 53%），不做动态选路。',
       '时间：08:00:00 空网开始，前 180 s 预热不展示。延误 = 损失时间（含等着进路网的时间），算到展示窗口结束，各情景用同一批车比。']}


def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',',':'))+'\n', encoding='utf-8')


def xml(path, root):
    ET.indent(root)
    ET.ElementTree(root).write(path, encoding='utf-8', xml_declaration=True)


def command(args, cwd, timeout=300):
    p = subprocess.run([str(x) for x in args], cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    if p.returncode:
        raise RuntimeError(' '.join(map(str, args[:2]))+' failed:\n'+p.stdout[-6000:])
    return p.stdout


def roads_dir():
    return Path(os.environ.get('SUMO_ROADS_DIR') or REPO/'apps/roads/public/cbd')


def binaries():
    exe = Path(sys.executable).parent
    bins = {n: str(exe/n) if (exe/n).exists() else shutil.which(n) for n in ['sumo','netconvert']}
    if not all(bins.values()):
        raise RuntimeError('Install tools/sumo/requirements.txt in a virtual environment first.')
    out = command([bins['sumo'],'--version'], tempfile.gettempdir())
    version = next((l.strip() for l in out.splitlines() if l.startswith('Eclipse SUMO')), out.strip()[:200])
    if VERSION not in version:
        raise RuntimeError('Expected SUMO '+VERSION+', got '+version)
    home = os.environ.get('SUMO_HOME')
    if not home or not (Path(home)/'tools/routeSampler.py').exists():
        import sumo
        home = sumo.SUMO_HOME
    return bins, version, Path(home)/'tools'


def xy(lat, lon):
    return ((lon-LON0)*KX, (lat-LAT0)*KY)


def lonlat_e6(x, y):
    return round((LON0+x/KX)*1e6), round((LAT0+y/KY)*1e6)


def centre(x, y, angle, length):
    """FCD 给的是车头；沿车头朝向（0 = 北、顺时针）往回退半个车长就是车身中心。"""
    r = math.radians(angle)
    return x-math.sin(r)*length/2, y-math.cos(r)*length/2


def plain_network(folder, closed):
    """network.json → 研究区的 nod / edg 明文 XML（原型 build_net.py 的做法）。"""
    net = json.loads((roads_dir()/'network.json').read_text())
    sx, sy = xy(*SPRING_LONSDALE); ex, ey = xy(*ELIZABETH_LONSDALE)
    L = math.hypot(ex-sx, ey-sy); ux, uy = (ex-sx)/L, (ey-sy)/L; vx, vy = -uy, ux
    def uv(lat, lon):
        x, y = xy(lat, lon); return ((x-sx)*ux+(y-sy)*uy, (x-sx)*vx+(y-sy)*vy)
    vlo, vhi = sorted([uv(*RUSSELL_BOURKE)[1], uv(*RUSSELL_LATROBE)[1]])
    keep = {n['id'] for n in net['nodes'] if -35 <= uv(n['lat'], n['lon'])[0] <= L+60 and vlo-35 <= uv(n['lat'], n['lon'])[1] <= vhi+35}
    links = [l for l in net['links'] if l['from'] in keep and l['to'] in keep and l['highway'] != 'living_street']
    used = {l['from'] for l in links} | {l['to'] for l in links}
    N = {n['id']: n for n in net['nodes']}
    nodes = ET.Element('nodes')
    for nid in sorted(used):
        n = N[nid]; x, y = xy(n['lat'], n['lon'])
        a = {'id':nid,'x':'%.2f' % x,'y':'%.2f' % y,'type':'priority'}
        if n.get('signal'):
            a.update(type='traffic_light', tl='tls'+n['signal'])  # 同一 SCATS 口的 OSM 节点共用一个控制器
        ET.SubElement(nodes, 'node', a)
    edges = ET.Element('edges')
    for l in links:
        e = ET.SubElement(edges, 'edge', {'id':l['id'],'from':l['from'],'to':l['to'],'numLanes':str(max(1, int(l['lanes'] or 1))),
            'speed':'%.2f' % ((l['speed_kmh'] or 40)/3.6),'shape':' '.join('%.2f,%.2f' % xy(p[0], p[1]) for p in l['geometry']),
            'name':l['name'] or 'unnamed','type':l['highway'],
            'priority':{'primary':'4','secondary':'3','tertiary':'2'}.get(l['highway'],'1')})
        if closed and l['id'] == WORKS:
            ET.SubElement(e, 'lane', index='0', speed='%.2f' % WORKS_SPEED)
            ET.SubElement(e, 'lane', index='1', disallow='all')
    xml(folder/'cbd.nod.xml', nodes); xml(folder/'cbd.edg.xml', edges)
    return len(used), len(links)


def netconvert(folder, bins, name, green):
    command([bins['netconvert'],'--node-files','cbd.nod.xml','--edge-files','cbd.edg.xml','--lefthand','true','--no-turnarounds','true',
             '--tls.guess-signals','false','--tls.guess','false','--junctions.join','true','--junctions.join-dist','12','--tls.join','true',
             '--tls.default-type','static','--tls.cycle.time',str(CYCLE),'--keep-edges.components','1','--junctions.corner-detail','5',
             '--rectangular-lane-cut','true','--edges.join','false','--geometry.remove','false','--offset.disable-normalization','true',
             '--no-warnings','true','--output-file',name], folder)
    # 2935 人行灯：netconvert 默认 82 s 绿 / 3 s 黄 / 5 s 红，改成假设的绿信比
    tree = ET.parse(folder/name); root = tree.getroot(); patched = 0
    for tl in root.findall('tlLogic'):
        if not any(n in tl.get('id') for n in SITE_2935):
            continue
        ph = tl.findall('phase')
        if len(ph) != 3 or 'G' not in ph[0].get('state') or set(ph[1].get('state')) != {'y'}:
            raise RuntimeError('Unexpected 2935 signal plan '+tl.get('id'))
        g = round(CYCLE*green)-3
        for p, d in zip(ph, [g, 3, CYCLE-g-3]):
            p.set('duration', str(d))
        patched += 1
    if patched != 2:
        raise RuntimeError('Expected two 2935 controllers, patched %d' % patched)
    tree.write(folder/name, encoding='utf-8', xml_declaration=True)


def cache_key(version, green):
    h = hashlib.sha256(Path(__file__).read_bytes()+version.encode()+repr(green).encode())
    for f in ['network.json','signals.json','flows.json']:
        h.update((roads_dir()/f).read_bytes())
    return h.hexdigest()[:16]


def prepare(bins, version, tools, green=GREEN_2935):
    """建（或复用）缓存：base.net.xml、works.net.xml、demand.json（routeSampler 选出的路线 + 每小时车数 + 绕行路线）。"""
    root = Path(os.environ.get('SUMO_REAL_CACHE') or Path(tempfile.gettempdir())/'rippletwin-sumo-real-cache')
    cache = root/cache_key(version, green)
    if (cache/'demand.json').exists():
        return cache
    root.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix='build-', dir=root))
    try:
        for name, closed in [('base', False), ('works', True)]:
            d = tmp/name; d.mkdir()
            nodes, links = plain_network(d, closed)
            netconvert(d, bins, name+'.net.xml', green)
            shutil.move(str(d/(name+'.net.xml')), str(tmp/(name+'.net.xml')))
        sys.path.insert(0, str(tools))
        import sumolib
        net = sumolib.net.readNet(str(tmp/'base.net.xml'))
        for e in CHAIN+[WORKS, DETOUR_FIRST]:
            net.getEdge(e)  # 路段名对不上就在这里报错
        flows = json.loads((roads_dir()/'flows.json').read_text())
        wd, method = flows['days']['wd'], flows['method']
        counted = [e.getID() for e in net.getEdges() if e.getID() in wd]
        c = ET.Element('data'); iv = ET.SubElement(c, 'interval', id='wd08', begin='0', end='3600')
        for eid in counted:
            ET.SubElement(iv, 'edge', id=eid, entered='%.1f' % wd[eid][HOUR])
        xml(tmp/'counts.xml', c)
        py = sys.executable
        command([py, tools/'randomTrips.py','-n','base.net.xml','-o','cand.trips.xml','-r','cand.rou.xml','-b',0,'-e',4000,'-p',.2,
                 '--fringe-factor',20,'--min-distance',150,'--seed',7,'--validate'], tmp, 600)
        command([py, tools/'routeSampler.py','-r','cand.rou.xml','--edgedata-files','counts.xml','-o','sampled.rou.xml','--optimize','full',
                 '--seed',7,'--prefix','r','--write-flows','poisson','-b',0,'-e',3600,'--mismatch-output','mismatch.xml'], tmp, 600)
        routes = []
        for f in ET.parse(tmp/'sampled.rou.xml').getroot().iter('flow'):
            per = f.get('period', '')
            if not per.startswith('exp('):
                raise RuntimeError('Unexpected routeSampler flow '+ET.tostring(f, encoding='unicode')[:200])
            routes.append({'edges':f.find('route').get('edges').split(),'rate_s':float(per[4:-1])})
        paths = {}
        def detour(edges):
            if DETOUR_TURN not in edges: return None
            i = edges.index(DETOUR_TURN)
            if WORKS not in edges[i:]: return None
            dest = DEST_FIX.get(edges[-1], edges[-1])
            if dest not in paths:
                p, _ = net.getShortestPath(net.getEdge(DETOUR_FIRST), net.getEdge(dest))
                paths[dest] = [e.getID() for e in p] if p else None
            tail = paths[dest]
            return edges[:i+1]+tail if tail and WORKS not in tail else None
        for r in routes:
            r['through_works'] = WORKS in r['edges']
            r['detour'] = detour(r['edges'])
        dump(tmp/'demand.json', {'routes':routes,'counted_edges':len(counted),'edges':len(net.getEdges()),
             'measured_edges':sum(method.get(e) in ('detector_map','site_split') for e in counted),
             'nodes':nodes,'links':links,'veh_per_h':round(sum(r['rate_s'] for r in routes)*3600)})
        cache.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.rename(tmp, cache)
        except OSError:
            if not (cache/'demand.json').exists(): raise
            shutil.rmtree(tmp, ignore_errors=True)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return cache


def vehicles(routes, seed):
    """每条路线按泊松到达生成 [0, END) 的车；同一 seed 各情景同一批车，绕行抽签也是同一个数（共用随机数）。"""
    rng = random.Random(seed)
    rows = []
    for k, r in enumerate(routes):
        t = rng.expovariate(r['rate_s'])
        while t < END:
            rows.append((round(t, 2), k)); t += rng.expovariate(r['rate_s'])
    rows.sort()
    draw = random.Random(seed*2654435761 % 2**32+1)
    return [{'id':'v%05d' % i,'depart':t,'route':k,'u':draw.random()} for i, (t, k) in enumerate(rows)]


def write_routes(folder, rows, routes, share):
    root = ET.Element('routes')
    ET.SubElement(root, 'vType', id='car', vClass='passenger', length=str(CAR[0]), width=str(CAR[1]), minGap='2.5')
    diverted, eligible = set(), set()
    for v in rows:
        r = routes[v['route']]; edges = r['edges']
        if r['detour']:
            eligible.add(v['id'])
            if v['u'] < share:
                edges = r['detour']; diverted.add(v['id'])
        e = ET.SubElement(root, 'vehicle', id=v['id'], type='car', depart='%.2f' % v['depart'], departLane='best', departSpeed='max')
        ET.SubElement(e, 'route', edges=' '.join(edges))
    xml(folder/'routes.rou.xml', root)
    return diverted, eligible


def sumo_args(bins, net, seed):
    return [bins['sumo'],'-n',str(net),'-r','routes.rou.xml','--seed',str(seed),'--begin','0','--end',str(END),'--step-length',str(STEP),
            '--time-to-teleport','300','--collision.action','warn','--collision.check-junctions','true','--collision-output','collisions.xml',
            '--fcd-output','fcd.xml','--device.fcd.begin',str(WARM),'--device.fcd.period','1','--fcd-output.acceleration','true',
            '--fcd-output.attributes','x,y,angle,speed,pos,lane,acceleration','--tripinfo-output','trips.xml',
            '--tripinfo-output.write-unfinished','true','--tripinfo-output.write-undeparted','true','--statistic-output','statistics.xml',
            '--no-step-log','true','--duration-log.disable','true','--log','run.log']


def net_info(path):
    """信号灯程序、信号头（每个进口道一个）、上游路段长度、施工车道形状。"""
    root = ET.parse(path).getroot()
    programs = {}
    for tl in root.findall('tlLogic'):
        ph = [(float(p.get('duration')), p.get('state')) for p in tl.findall('phase')]
        programs[tl.get('id')] = {'offset':float(tl.get('offset', '0')),'phases':ph,'cycle':sum(d for d, _ in ph)}
    lanes, length = {}, {}
    for e in root.findall('edge'):
        if e.get('function'): continue
        for l in e.findall('lane'):
            lanes[l.get('id')] = [[float(v) for v in p.split(',')[:2]] for p in l.get('shape').split()]
            length.setdefault(e.get('id'), float(l.get('length')))
    groups = {}
    for c in root.findall('connection'):
        if c.get('tl') and not c.get('from').startswith(':'):
            g = groups.setdefault((c.get('tl'), c.get('from')), {'idx':set(),'lanes':set()})
            g['idx'].add(int(c.get('linkIndex'))); g['lanes'].add(c.get('from')+'_'+c.get('fromLane'))
    heads = []
    for (tl, edge), g in sorted(groups.items()):
        pts = [lanes[l][-1] for l in sorted(g['lanes'])]
        lon, lat = lonlat_e6(sum(p[0] for p in pts)/len(pts), sum(p[1] for p in pts)/len(pts))
        heads.append({'id':tl+'|'+edge,'tls':tl,'idx':sorted(g['idx']),'lon_e6':lon,'lat_e6':lat})
    return programs, heads, length, lanes


def tls_state(p, t):
    x = (t-p['offset']) % p['cycle']
    for d, s in p['phases']:
        if x < d: return s
        x -= d
    return p['phases'][-1][1]


def queue_now(stopped, length):
    """施工段起点往上游、断档 ≤ 60 m 的连续排队长度（原型 run_scen.py 的规则）。"""
    ds = sorted(stopped)
    ext = prev = 0.0
    for d in ds:
        if d-prev > 60: break
        ext = prev = d
    return ext


def export(folder, out, scenario, net_path, rows, diverted):
    programs, heads, length, lanes = net_info(net_path)
    off, acc = {}, 0.0
    for e in CHAIN:
        acc += JBOX.get(e, 0.0); off[e] = acc; acc += length[e]
    catalog, index = [], {}
    frames, chunks, qs, halting, harsh = [], [], [], [0.0]*(SHOWN//60), [0]*(SHOWN//60)
    braking, size = set(), 0
    def flush():
        nonlocal size
        if not frames: return
        name = 'frames-%03d.json' % len(chunks)
        dump(out/name, {'frames':frames})
        data = (out/name).read_bytes()
        chunks.append({'file':name,'start':frames[0]['t'],'end':frames[-1]['t'],'frames':len(frames),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
        frames.clear(); size = 0
    for _, ts in ET.iterparse(folder/'fcd.xml', events=['end']):
        if ts.tag != 'timestep': continue
        t = int(round(float(ts.get('time'))))-WARM
        if t < 0 or t >= SHOWN:
            ts.clear(); continue
        agents, stopped, halt, now_braking = [], [], 0, set()
        for a in ts:
            if a.tag != 'vehicle': continue
            vid = a.get('id')
            if vid not in index:
                index[vid] = len(catalog); catalog.append({'id':vid,'type':'car','length_m':CAR[0],'width_m':CAR[1]})
            x, y, ang, v = float(a.get('x')), float(a.get('y')), float(a.get('angle')), float(a.get('speed'))
            lon, lat = lonlat_e6(*centre(x, y, ang, CAR[0]))
            agents.append([index[vid], lon, lat, round(ang, 1) % 360, round(v*100)])
            if v < HALT_SPEED: halt += 1
            if float(a.get('acceleration', '0')) <= HARSH_DECEL:
                now_braking.add(vid)
                if vid not in braking: harsh[t//60] += 1
            edge = a.get('lane', '').rsplit('_', 1)[0]
            if v < QUEUE_SPEED:
                if edge == WORKS: stopped.append(0.0)
                elif edge in off: stopped.append(off[edge]+length[edge]-float(a.get('pos')))
        braking = now_braking
        q = round(queue_now(stopped, length), 1)
        qs.append(q); halting[t//60] += halt/60
        sim_t = t+WARM
        # 定周期灯直接按程序算；SUMO 在时刻 t 报的是刚跑完那一步（t − STEP）的灯色（对过 TraCI，400 s × 23 个灯 0 处不一致）
        frames.append({'t':t,'a':agents,'tls':{k:tls_state(p, sim_t-STEP) for k, p in programs.items()},'q':q})
        size += 40*len(agents)+30*len(programs)+40
        if len(frames) >= CHUNK_SECONDS or size > CHUNK_BYTES: flush()
        ts.clear()
    flush()
    if len(qs) != SHOWN:
        raise RuntimeError('FCD covers %d of %d s' % (len(qs), SHOWN))
    stats = ET.parse(folder/'statistics.xml').getroot()
    safety, tele = stats.find('safety'), stats.find('teleports')
    # 车道上的碰撞 = 失败；路口内部的「碰撞」单独报：OSM 合并出来的路口内部车道几何会重叠（SUMO 默认根本不查路口），
    # 用 warn 只记录不改变动力学，所以两种都诚实写进 metrics
    kinds = [c.get('type') for c in ET.parse(folder/'collisions.xml').getroot().findall('collision')]
    junction = sum(1 for k in kinds if k == 'junction')
    collisions = max(len(kinds)-junction, int(safety.get('collisions'))-junction)
    loss, completed = {}, 0
    for r in ET.parse(folder/'trips.xml').getroot().iter('tripinfo'):
        loss[r.get('id')] = float(r.get('timeLoss', '0'))+float(r.get('departDelay', '0'))
        if float(r.get('arrival', '-1')) >= WARM: completed += 1
    cohort = [v['id'] for v in rows if WARM <= v['depart'] < END]
    works_shape = [list(lonlat_e6(x, y)) for x, y in lanes.get(WORKS_LANE, [])]
    return {'version':2,'network':'real','scenario':scenario,'duration_s':SHOWN,'sample_s':1,'clock0_s':WARM,
        'agent_columns':['i','lon_e6','lat_e6','angle_deg','speed_cms'],'agents':catalog,'signal_heads':heads,'chunks':chunks,
        'works':{'link':WORKS,'closed_lane':WORKS_LANE if SCENARIOS[scenario]['closed'] else None,'lane_shape_e6':works_shape},
        'metrics':{'vehicles':len(catalog),'completed':completed,'teleports':int(tele.get('total')),'collisions':collisions,'junction_collisions':junction,
                   'emergency_braking':int(safety.get('emergencyBraking')),
                   'mean_timeloss_s':round(sum(loss.get(v, 0.0) for v in cohort)/len(cohort), 1) if cohort else None,'mean_extra_s':None,
                   'works_queue_max_m':max(qs),'works_queue_mean_m':round(sum(qs)/len(qs), 1),
                   'detour_vehicles':sum(1 for v in cohort if v in diverted),'cohort_vehicles':len(cohort)},
        'per_minute':{'halting':[round(h, 1) for h in halting],'harsh':harsh}}, {v: loss.get(v, 0.0) for v in cohort}


DEFAULT_KEYS = set(DEFAULTS)


def validate_real(payload):
    if not isinstance(payload, dict):
        raise ValueError('Payload must be an object')
    payload = dict(payload)
    if payload.pop('network', 'real') != 'real':
        raise ValueError('network must be "real"')
    extra = set(payload)-DEFAULT_KEYS
    if extra:
        raise ValueError('Unknown field: '+', '.join(sorted(extra)))
    config = {**DEFAULTS, **payload}
    s = config['seed']
    if type(s) is not int or not 0 <= s <= 2147483647:
        raise ValueError('seed must be an integer in [0, 2147483647]')
    for k in ['p_original','p_ai']:
        p = config[k]
        if type(p) not in (int, float) or not math.isfinite(p) or not 0 <= p <= 1:
            raise ValueError(k+' must be a number in [0, 1]')
        config[k] = float(p)
    sc = config['scenarios']
    if not isinstance(sc, list) or not sc or any(not isinstance(x, str) or x not in SCENARIOS for x in sc) or len(set(sc)) != len(sc):
        raise ValueError('scenarios must be a nonempty list of unique ids from baseline, original, ai')
    config['scenarios'] = [x for x in SCENARIOS if x in sc]
    return config


def build(args):
    t_start = time.time()
    config = validate_real({k: getattr(args, k) for k in DEFAULTS})
    bins, version, tools = binaries()
    work = Path(args.work_dir or tempfile.mkdtemp(prefix='rippletwin-sumo-real-')).resolve(); work.mkdir(parents=True, exist_ok=True)
    out = Path(args.output).resolve(); out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        raise ValueError('Output directory must be empty')
    green = getattr(args, 'green_2935', None) or GREEN_2935
    if not .3 <= green <= .95:
        raise ValueError('green_2935 must be in [0.3, 0.95]')
    cache = prepare(bins, version, tools, green)
    t_prep = time.time()
    demand = json.loads((cache/'demand.json').read_text())
    rows = vehicles(demand['routes'], config['seed'])
    shares = {'baseline':0.0,'original':config['p_original'],'ai':config['p_ai']}
    procs = {}
    jobs = max(1, int(os.environ.get('SUMO_REAL_JOBS') or min(3, os.cpu_count() or 1)))
    pending = list(config['scenarios']); walls = {}
    meta = {}
    while pending or procs:
        while pending and len(procs) < jobs:
            k = pending.pop(0); folder = work/k
            if folder.exists(): shutil.rmtree(folder)
            folder.mkdir(parents=True)
            diverted, eligible = write_routes(folder, rows, demand['routes'], shares[k])
            net = cache/('works.net.xml' if SCENARIOS[k]['closed'] else 'base.net.xml')
            args_k = sumo_args(bins, net, config['seed'])
            (folder/'command.json').write_text(json.dumps([str(a) for a in args_k[1:]], indent=1)+'\n')
            log = open(folder/'stdout.log', 'w')
            procs[k] = (subprocess.Popen(args_k, cwd=folder, stdout=log, stderr=subprocess.STDOUT), time.time(), log)
            meta[k] = (net, diverted, eligible)
        for k, (p, t0, log) in list(procs.items()):
            try:
                rc = p.wait(timeout=.05)
            except subprocess.TimeoutExpired:
                if time.time()-t0 > 180:  # 正常 1 s 左右；卡住就全部停掉，不留孤儿进程
                    for q, _, lg in procs.values(): q.kill(); lg.close()
                    raise RuntimeError('SUMO timed out: '+k)
                continue
            log.close(); del procs[k]; walls[k] = round(time.time()-t0, 2)
            if rc:
                for q, _, lg in procs.values(): q.kill(); lg.close()
                raise RuntimeError('SUMO failed ('+k+'):\n'+(work/k/'stdout.log').read_text()[-4000:]+(work/k/'run.log').read_text()[-4000:])
    manifests, cohorts = {}, {}
    for k in config['scenarios']:
        net, diverted, eligible = meta[k]
        m, loss = export(work/k, out/k, k, net, rows, diverted)
        m['metrics']['eligible_vehicles'] = sum(1 for v in rows if WARM <= v['depart'] < END and v['id'] in eligible)
        if m['metrics']['collisions']:
            raise RuntimeError('SUMO reported %d collision(s) in %s' % (m['metrics']['collisions'], k))
        manifests[k], cohorts[k] = m, loss
    base = cohorts.get('baseline')
    through = {v['id'] for v in rows if demand['routes'][v['route']]['through_works']}
    for k, m in manifests.items():
        m['metrics']['works_traffic_extra_s'] = None
        if base is not None and k != 'baseline':
            ids = [v for v in base if v in cohorts[k]]
            m['metrics']['mean_extra_s'] = round(sum(cohorts[k][v]-base[v] for v in ids)/len(ids), 1) if ids else None
            # 原路线要穿过施工段的那批车（含绕行的）：指示牌管的就是它们
            w = [v for v in ids if v in through]
            m['metrics']['works_traffic_extra_s'] = round(sum(cohorts[k][v]-base[v] for v in w)/len(w), 1) if w else None
        m.update(engine=version, seed=config['seed'], diversion_share=shares[k])
        dump(out/k/'manifest.json', m)
    source = os.environ.get('SUMO_REAL_SOURCE') or ('local-macos-arm64' if sys.platform == 'darwin' and platform.machine() == 'arm64' else sys.platform+'-'+platform.machine())
    index = {'version':2,'network':'real','engine':version,'generator_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'seed':config['seed'],'hour':HOUR,'works':{'link':WORKS,'lanes_closed':1},
        'params':{**config,'source':source,'warmup_s':WARM,'shown_s':SHOWN,'step_s':STEP,'cycle_s':CYCLE,'signal_2935_green':green,
                  'works_lane_speed_kmh':round(WORKS_SPEED*3.6),'demand':'flows.json wd hour %d' % HOUR,'demand_veh_per_h':demand['veh_per_h'],
                  'routes':len(demand['routes']),'network_nodes':demand['nodes'],'network_links':demand['links'],
                  'counted_edges':demand['counted_edges'],'measured_edges':demand['measured_edges'],'net_edges':demand['edges'],
                  'study_area':'Elizabeth St–Spring St × Bourke St–La Trobe St'},
        'assumptions':{k:[x.replace('{green}', str(round(green*100))) for x in v] for k, v in ASSUMPTIONS.items()},
        'scenarios':[{'id':k,'label':{'en':SCENARIOS[k]['en'],'zh':SCENARIOS[k]['zh']},'diversion_share':shares[k],
                      'manifest':k+'/manifest.json','metrics':manifests[k]['metrics']} for k in config['scenarios']],
        'timing':{'prepare_s':round(t_prep-t_start, 2),'sumo_s':walls,'total_s':round(time.time()-t_start, 2),'jobs':jobs}}
    dump(out/'index.json', index)
    print('Raw audit:', work, '\nReplay:', out, '\nTotal %.1f s' % index['timing']['total_s'], flush=True)
    return index


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--seed', type=int, default=DEFAULTS['seed'])
    parser.add_argument('--p-original', type=float, default=DEFAULTS['p_original'])
    parser.add_argument('--p-ai', type=float, default=DEFAULTS['p_ai'])
    parser.add_argument('--scenarios', nargs='+', choices=list(SCENARIOS), default=list(SCENARIOS))
    parser.add_argument('--output')
    parser.add_argument('--work-dir')
    parser.add_argument('--green-2935', type=float, default=GREEN_2935, help='2935 人行灯给 Lonsdale 车流的绿 + 黄占比（只给烘焙 / 敏感性用，不进 API）')
    parser.add_argument('--prepare-only', action='store_true', help='只建缓存（路网 + 需求），镜像构建时预热用')
    args = parser.parse_args()
    if args.prepare_only:
        print(prepare(*binaries(), args.green_2935))
        sys.exit(0)
    if not args.output:
        parser.error('--output is required')
    for k, v in validate_real({k: getattr(args, k) for k in DEFAULTS}).items(): setattr(args, k, v)
    build(args)
