#!/usr/bin/env python3
"""真实 CBD 路网上的 SUMO 回放（contract v2 "real network"）。
路网 = apps/roads/public/cbd/network.json（OSM），信号口 = signals.json（SCATS），需求 = flows.json 工作日 08:00–09:00。
三个情景：baseline（无施工）/ original（封一条车道 + 原方案绕行比例）/ ai（封一条车道 + AI 方案绕行比例）。
T48：跑满 08:00–09:00 一整小时（07:57 空网起步预热 180 s、不展示；施工 08:00 整才封），SUMO 自己算 09:00 的排队；
路网往东（Spring 以东的 Albert St）、往南（到 Collins）、往北（过 La Trobe）扩出来，排队和回溢有地方放；
回放只给 original / ai 两个情景、只给页面视野里的车（baseline 只出指标）。
只跑原生 SUMO，不编造轨迹；路网和候选路线缓存在 SUMO_REAL_CACHE（默认系统临时目录），同一 seed 结果可复现。
用 requirements.txt 的 venv 跑；第一次建缓存要 numpy + scipy（SUMO 自带的 routeSampler.py 要）。
"""
import argparse
import bisect
import hashlib
import json
import math
import os
import platform
import random
import re
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
# 沿 Lonsdale 的坐标系：u = 从 Spring/Lonsdale 往 Elizabeth/Lonsdale 的米数（西为正），v = 横向米数（南为正）
# 实测：Exhibition u≈233、Russell 462、2935 582、Elizabeth 925；La Trobe v≈−231、Little Lonsdale −116、Little Bourke 115、Bourke 230、Collins 461
SPRING_LONSDALE, ELIZABETH_LONSDALE = (-37.809404, 144.97214), (-37.812282, 144.962257)
# 研究区 = 两个 u/v 矩形的并集（T48 为排队和回溢留地方）：
#   原来的 Elizabeth–Spring × Bourke–La Trobe（外扩 35 m）；
#   Russell St 以东到 network.json 的东边界（Albert St 过 Gisborne St，Lonsdale 西行排队往东接着排），南到 Collins（+35 m）、北过 La Trobe 约 170 m。
# 试过只切 Albert St 一条走廊、不要 Victoria Pde / Nicholson 那几个 OSM 合并大路口（它们在 netconvert 默认配时下无施工也进不去车）：
# routeSampler 换了一套路线，Russell 南行从 La Trobe 以北进来的车在 Russell × Lonsdale 右转时锁死，无施工情景 09:00 就有
# 近 200 辆要过施工段的车排着等进路网 —— 比留着东北角更糟，所以留着；东北角的插入积压跟施工无关（报在 insertion_backlog_end）
AREA_BOXES = [(-35, 985, -266, 266), (-345, 500, -400, 496)]
# 页面视野（回放只写这里面的车）：La Trobe–Little Bourke × Elizabeth–Exhibition 的 16 个路口（外扩 12 m，刚好盖住外圈街道的车行道），
# 往东（朝 Spring）140 m。一小时每 2 s 一帧，每个情景约 15 MB；再宽就超了
VIEW_BOX = (93, 937, -243, 127)
WORKS = 'l595594354_9756035316'  # Lonsdale 西行、Russell 与 2935 人行灯之间 42 m，两车道
WORKS_LANE = WORKS+'_1'          # 靠左行驶的路网里 index 1 = 中央侧（右侧）车道
WORKS_SPEED = 30/3.6             # 剩下那条车道限速 30 km/h
# Lonsdale 西行、施工段上游的路段，由近到远到 Spring（路口内部段靠 60 m 断档规则跨过去）；再往东的 Albert St 西行在 prepare() 里顺着路网接上
CHAIN = ['l595594353_595594354','l595594352_595594353','l6696274751_9756035317','l6381474061_6696274751',
         'l595594348_6381474061','l6207022860_595594347','l6207022858_6207022860','l317537930_6207022858']
CHAIN_NAMES = ('Lonsdale Street', 'Albert Street')
# 绕行：Lonsdale 西行在 Russell 左转（靠路缘，不跟对向车冲突）→ Little Bourke 西行 → Swanston → Lonsdale
DETOUR_TURN, DETOUR_FIRST = 'l6696274751_9756035317', 'l1985557927_13807338304'
# 研究区切口的副作用：有些直行车的终点是施工段后面两段很短的路（QV / 停车场一侧），绕行车绕不回去，改送到 Lonsdale 西行 Swanston→Elizabeth
DEST_FIX = {'l9756035316_4544002877':'l9086096512_2190483592','l4544002877_9756035309':'l9086096512_2190483592'}
SITE_2935 = {'n245537592','n4544002877','n9756035315','n9756035316'}  # LONSDALE NR SWANSTON（POS）两侧车行道的节点
CYCLE = 90
# 2935 给 Lonsdale 车流的绿 + 黄占周期比例（假设）。T48 定 50%：两车道放行约 1 800 辆/小时、封一条后约 800 辆/小时，
# 对上引擎的通行能力假设（1 800 × ½ × 0.9 = 810 辆/小时）；实测放行量写在 metrics.works_throughput_vph
GREEN_2935 = .50
ENGINE_CAPACITY_VPH = 810        # 引擎：施工段 1 800 辆/小时 × 剩一半车道 × 0.9
PRE = 180                        # 07:57:00 空网开始，前 180 s 预热（还没施工）不展示；施工 08:00:00 整封（rerouter + 限速牌）
SHOWN = 3600                     # 展示 08:00–09:00
END = PRE+SHOWN
STEP = .5
SAMPLE = 2                       # 回放每 2 s 一帧（FCD 同周期）
CHUNK_FRAMES = 60                # 每块 60 帧 = 2 分钟
CHUNK_BYTES = 1300000            # 单个文件硬上限 1.5 MB，留余量
QUEUE_SPEED = 1.5                # 排队：速度 < 1.5 m/s 且前后车距 ≤ 60 m 连成一串
QUEUE_GAP = 60
HALT_SPEED = .1                  # SUMO 的 halting 定义
HARSH_DECEL = -4.5               # 急刹：踩到 SUMO 小汽车的最大常规减速度 4.5 m/s²（约 0.46 g）的起点，每辆车每次只算一次
VEH_M, LANES_M = 7.0, 2          # 引擎的换算：每辆车 7 m、按两条车道摊
# 防死锁：堵在路口里 ≥ 60 s 的车，冲突车流不再让它（SUMO --ignore-junction-blocker）；原地一动不动 ≥ 300 s 的车才瞬移到前方（SUMO 默认值）。
# 试跑过完全关掉瞬移：无施工情景 07:03 起 Little Bourke × Swanston 一辆右转车等不到下游空位，Swanston / La Trobe / Elizabeth 一圈锁死，
# 09:00 有 500 多辆车原地不动 —— 那是 SUMO 路口模型的死锁，不是施工造成的。施工排队里的车每个信号周期（90 s）都会往前挪，
# 等不到 300 s，所以不会被瞬移；每一次瞬移都记在 metrics（总数、施工路线上的、在哪几段路）
JUNCTION_BLOCKER_S = 60
TELEPORT_S = 300
CAR = (4.6,1.8)
SCENARIOS = {'baseline':{'en':'No works','zh':'无施工','closed':False,'frames':False},
             'original':{'en':'Original plan · ROADWORK AHEAD','zh':'原方案 · ROADWORK AHEAD','closed':True,'frames':True},
             'ai':{'en':'AI plan · USE RUSSELL','zh':'AI 方案 · USE RUSSELL','closed':True,'frames':True}}
DEFAULTS = {'seed':42,'p_original':.14,'p_ai':.53,'scenarios':list(SCENARIOS)}
NETWORK_EXTENT = {'en':'Elizabeth St to Spring St by Bourke St to La Trobe St, plus room for the queue from Russell St east to the edge of the data (Albert St to Gisborne St, Nicholson St, Victoria Pde), south to Collins St and about 170 m north of La Trobe St',
                  'zh':'Elizabeth St–Spring St × Bourke St–La Trobe St，再给排队留地方：Russell St 以东到数据边界（Albert St 到 Gisborne St、Nicholson St、Victoria Pde），南到 Collins St，北过 La Trobe St 约 170 m'}
ASSUMPTIONS = {
 'en':['Model cross-check, not a field measurement: Eclipse SUMO on the real CBD street geometry.',
       'Network: OSM links from network.json — {extent} (+35 m margin); lane counts and speed limits from OSM; living streets, kerbside parking and clearways not modelled.',
       'Demand: SCATS weekday 08:00–09:00 counts per link (flows.json, 38 weekdays; links without a detector interpolated), routes fitted with SUMO routeSampler, the full hour simulated; cars only (no trams, buses or trucks).',
       'Signals: SCATS gives counts but no timings, so every signal runs SUMO\'s fixed 90 s default plan; the pedestrian signal 2935 (Lonsdale near Swanston) at the works gives Lonsdale traffic {green}% of the cycle. Chosen so the works link matches the engine\'s capacity assumption (1,800 veh/h × ½ lane × 0.9 = 810 veh/h); the discharge SUMO actually achieved is reported as works_throughput_vph.',
       'Works: from 08:00:00 the right (median) lane of Lonsdale St westbound is closed on the 42 m link before signal 2935; the open lane runs at 30 km/h.',
       'Diversion: a fixed share of drivers who pass the sign (Lonsdale westbound before Russell St, heading through the works) turn left into Russell St, then Little Bourke St, Swanston St and back to Lonsdale St. Shares come from the engine\'s reading of each sign (ROADWORK AHEAD 14%, USE RUSSELL / SAVE 9 MIN 53%); no dynamic route choice.',
       'Time: the simulation starts empty at 07:57:00 with 08:00 demand and no works; 07:57–08:00 is warm-up and not shown. Shown and measured: 08:00–09:00. Delay = time loss including waiting to enter, accumulated by 09:00, same vehicles in every scenario.',
       'Jams are kept: vehicles are never removed. A vehicle blocking a junction for 60 s is ignored by crossing traffic (SUMO ignore-junction-blocker), and only a vehicle that has not moved at all for 300 s is moved ahead along its route (SUMO teleport, its default time) — so a model deadlock cannot lock the grid. Queued traffic behind the works moves up every 90 s cycle and is never moved; every teleport is counted and located in the metrics (teleports_in_hour, teleports_works_bound, teleport_edges).',
       'Queue at 09:00: physical = back of the stopped queue on the Lonsdale / Albert St westbound chain, longest over the last 90 s signal cycle; engine method = vehicles bound through the works that are queued behind it (connected queue, including spill-back onto Russell / Exhibition / Spring St) or still waiting to enter the network, averaged over the last cycle, × 7 m ÷ 2 lanes.'],
 'zh':['这是模型之间的交叉检验，不是实测：在真实 CBD 街道几何上跑 Eclipse SUMO。',
       '路网：network.json 的 OSM 路段——{extent}（外扩 35 m）；车道数和限速取 OSM；不含 living street、路边停车和清道时段。',
       '需求：SCATS 工作日 08:00–09:00 各路段流量（flows.json，38 个工作日；没有检测器的路段是插值），路线用 SUMO routeSampler 拟合，整小时都跑；只有小汽车（没有电车、公交、货车）。',
       '信号：SCATS 只有流量没有配时，所有信号灯用 SUMO 默认的 90 s 定周期；施工点的人行灯 2935（Lonsdale 近 Swanston）给 Lonsdale 车流 {green}% 的周期。这样取是为了让施工段对上引擎的通行能力假设（1 800 辆/小时 × 剩一半车道 × 0.9 = 810 辆/小时）；SUMO 实际放行多少写在 works_throughput_vph。',
       '施工：08:00:00 起 Lonsdale St 西行、2935 人行灯前那段 42 m 封右侧（中央侧）车道，剩下一条车道限速 30 km/h。',
       '绕行：经过指示牌的司机（Russell St 之前的 Lonsdale 西行、要穿过施工段）按固定比例左转 Russell St → Little Bourke St → Swanston St → 回到 Lonsdale St。比例取引擎对各块牌子的读法（ROADWORK AHEAD 14%，USE RUSSELL / SAVE 9 MIN 53%），不做动态选路。',
       '时间：07:57:00 空网开始，用 08:00 的车流、还没施工；07:57–08:00 预热不展示。展示和统计：08:00–09:00。延误 = 损失时间（含等着进路网的时间），算到 09:00，各情景用同一批车比。',
       '堵车照实留着：车不会被删掉。堵在路口里 60 s 的车，横向车流不再让它（SUMO ignore-junction-blocker）；只有整整 300 s 一动不动的车才会沿路线挪到前面（SUMO 的瞬移，默认时间），免得模型死锁把整片路网锁死。施工后面排队的车每 90 s 周期都会往前挪，不会被挪走；每一次瞬移都记数、记位置（teleports_in_hour、teleports_works_bound、teleport_edges）。',
       '09:00 的排队：实际排队 = Lonsdale / Albert St 西行这一串上停着的车队尾，取最后一个 90 s 信号周期里最长的；引擎算法 = 要穿过施工段、排在它后面的车（连成一串的排队，含回溢到 Russell / Exhibition / Spring St 上的）加上还没能进路网的，取最后一个周期的平均 × 7 m ÷ 2 条车道。']}


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


def _uv_frame():
    sx, sy = xy(*SPRING_LONSDALE); ex, ey = xy(*ELIZABETH_LONSDALE)
    L = math.hypot(ex-sx, ey-sy); ux, uy = (ex-sx)/L, (ey-sy)/L
    return lambda x, y: ((x-sx)*ux+(y-sy)*uy, (x-sx)*(-uy)+(y-sy)*ux)


UV = _uv_frame()  # net 坐标 (x, y) → (u, v)


def in_box(box, u, v):
    return box[0] <= u <= box[1] and box[2] <= v <= box[3]


def centre(x, y, angle, length):
    """FCD 给的是车头；沿车头朝向（0 = 北、顺时针）往回退半个车长就是车身中心。"""
    r = math.radians(angle)
    return x-math.sin(r)*length/2, y-math.cos(r)*length/2


def plain_network(folder):
    """network.json → 研究区的 nod / edg 明文 XML（原型 build_net.py 的做法）。施工不改路网，靠 works.add.xml 在 08:00 封道。"""
    net = json.loads((roads_dir()/'network.json').read_text())
    keep = {n['id'] for n in net['nodes'] if any(in_box(b, *UV(*xy(n['lat'], n['lon']))) for b in AREA_BOXES)}
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
        ET.SubElement(edges, 'edge', {'id':l['id'],'from':l['from'],'to':l['to'],'numLanes':str(max(1, int(l['lanes'] or 1))),
            'speed':'%.2f' % ((l['speed_kmh'] or 40)/3.6),'shape':' '.join('%.2f,%.2f' % xy(p[0], p[1]) for p in l['geometry']),
            'name':l['name'] or 'unnamed','type':l['highway'],
            'priority':{'primary':'4','secondary':'3','tertiary':'2'}.get(l['highway'],'1')})
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


def gap(a, b):
    """路口内部那一段：上一路段终点到下一路段起点的直线距离（近似）。"""
    p, q = a.getShape()[-1], b.getShape()[0]
    return math.hypot(p[0]-q[0], p[1]-q[1])


def works_chain(net):
    """施工段上游的西行链：CHAIN（到 Spring）再顺着 Lonsdale / Albert St 往东接到研究区边上。返回 [(edge, off)]，
    off = 这段的下游端到施工段起点的距离（中间路口按直线补上）。"""
    chain, e, acc = [], net.getEdge(WORKS), 0.0
    while True:
        ins = [c for c in e.getIncoming() if c.getName() in CHAIN_NAMES and c.getID() not in {x for x, _ in chain} and c.getID() != WORKS]
        if not ins:
            break
        nxt = min(ins, key=lambda c: gap(c, e))
        acc += gap(nxt, e)
        chain.append((nxt.getID(), round(acc, 1)))
        acc += nxt.getLength(); e = nxt
    ids = [x for x, _ in chain]
    if ids[:len(CHAIN)] != CHAIN:
        raise RuntimeError('Works chain changed: '+' '.join(ids[:len(CHAIN)]))
    return chain


def to_works(net, edges):
    """路线上施工段之前每一段的「段末 → 施工段起点」距离；不经过施工段就是 None。"""
    if WORKS not in edges: return None
    w = edges.index(WORKS); out = {}; acc = 0.0
    for i in range(w-1, -1, -1):
        a, b = net.getEdge(edges[i]), net.getEdge(edges[i+1])
        acc += gap(a, b)
        out[edges[i]] = round(acc, 1)
        acc += a.getLength()
    return out


def prepare(bins, version, tools, green=GREEN_2935):
    """建（或复用）缓存：base.net.xml、demand.json（routeSampler 选出的路线 + 每小时车数 + 绕行路线 + 到施工段的距离）。"""
    root = Path(os.environ.get('SUMO_REAL_CACHE') or Path(tempfile.gettempdir())/'rippletwin-sumo-real-cache')
    cache = root/cache_key(version, green)
    if (cache/'demand.json').exists():
        return cache
    root.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix='build-', dir=root))
    try:
        d = tmp/'base'; d.mkdir()
        nodes, links = plain_network(d)
        netconvert(d, bins, 'base.net.xml', green)
        shutil.move(str(d/'base.net.xml'), str(tmp/'base.net.xml'))
        sys.path.insert(0, str(tools))
        import sumolib
        net = sumolib.net.readNet(str(tmp/'base.net.xml'))
        for e in CHAIN+[WORKS, DETOUR_FIRST]:
            net.getEdge(e)  # 路段名对不上就在这里报错
        if len(net.getEdge(WORKS).getLanes()) != 2:
            raise RuntimeError('Works link must have two lanes')
        chain = works_chain(net)
        flows = json.loads((roads_dir()/'flows.json').read_text())
        wd, method = flows['days']['wd'], flows['method']
        counted = [e.getID() for e in net.getEdges() if e.getID() in wd]
        c = ET.Element('data'); iv = ET.SubElement(c, 'interval', id='wd08', begin='0', end='3600')
        for eid in counted:
            ET.SubElement(iv, 'edge', id=eid, entered='%.1f' % wd[eid][HOUR])
        xml(tmp/'counts.xml', c)
        py = sys.executable
        command([py, tools/'randomTrips.py','-n','base.net.xml','-o','cand.trips.xml','-r','cand.rou.xml','-b',0,'-e',4000,'-p',.2,
                 '--fringe-factor',20,'--min-distance',150,'--seed',7,'--validate'], tmp, 900)
        command([py, tools/'routeSampler.py','-r','cand.rou.xml','--edgedata-files','counts.xml','-o','sampled.rou.xml','--optimize','full',
                 '--seed',7,'--prefix','r','--write-flows','poisson','-b',0,'-e',3600,'--mismatch-output','mismatch.xml'], tmp, 900)
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
            r['to_works'] = to_works(net, r['edges'])
        length = {e.getID(): round(e.getLength(), 2) for e in net.getEdges()}
        dump(tmp/'demand.json', {'routes':routes,'counted_edges':len(counted),'edges':len(net.getEdges()),
             'measured_edges':sum(method.get(e) in ('detector_map','site_split') for e in counted),
             'nodes':nodes,'links':links,'veh_per_h':round(sum(r['rate_s'] for r in routes)*3600),
             'works_veh_per_h':round(sum(r['rate_s'] for r in routes if r['through_works'])*3600),
             'works_count_veh_per_h':wd.get(WORKS, [None]*24)[HOUR],
             'chain':chain,'length':length})
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
    """每条路线按泊松到达生成 [0, END) 的车（仿真时间，0 = 07:57）；同一 seed 各情景同一批车，绕行抽签也是同一个数（共用随机数）。"""
    rng = random.Random(seed)
    rows = []
    for k, r in enumerate(routes):
        t = rng.expovariate(r['rate_s'])
        while t < END:
            rows.append((round(t, 2), k)); t += rng.expovariate(r['rate_s'])
    rows.sort()
    draw = random.Random(seed*2654435761 % 2**32+1)
    return [{'id':'v%05d' % i,'depart':t,'route':k,'u':draw.random()} for i, (t, k) in enumerate(rows)]


def assign(rows, routes, share):
    """每辆车实际走的路线：有资格绕行的（路线在 Russell 之前的 Lonsdale 西行、要穿过施工段），抽签数 < 比例就走绕行。"""
    out = []
    for v in rows:
        r = routes[v['route']]
        diverted = bool(r['detour']) and v['u'] < share
        out.append((v, r['detour'] if diverted else r['edges'], diverted, bool(r['detour'])))
    return out


def write_routes(folder, plan):
    root = ET.Element('routes')
    ET.SubElement(root, 'vType', id='car', vClass='passenger', length=str(CAR[0]), width=str(CAR[1]), minGap='2.5')
    for v, edges, _, _ in plan:
        e = ET.SubElement(root, 'vehicle', id=v['id'], type='car', depart='%.2f' % v['depart'], departLane='best', departSpeed='max')
        ET.SubElement(e, 'route', edges=' '.join(edges))
    xml(folder/'routes.rou.xml', root)


def write_additional(folder, closed):
    """施工段末端两条车道各一个瞬时线圈（逐车记通过时刻）；施工情景再加 08:00 封中央侧车道（rerouter）和剩下车道限速 30 km/h（限速牌）。"""
    root = ET.Element('additional')
    for i in (0, 1):
        ET.SubElement(root, 'instantInductionLoop', id='works_out_%d' % i, lane='%s_%d' % (WORKS, i), pos='-1', file='works_out.xml')
    if closed:
        r = ET.SubElement(root, 'rerouter', id='works_closure', edges=WORKS)
        iv = ET.SubElement(r, 'interval', begin=str(PRE), end=str(END+3600))
        ET.SubElement(iv, 'closingLaneReroute', id=WORKS_LANE, disallow='all')
        s = ET.SubElement(root, 'variableSpeedSign', id='works_speed', lanes=WORKS+'_0')
        ET.SubElement(s, 'step', time=str(PRE), speed='%.2f' % WORKS_SPEED)
    xml(folder/'works.add.xml', root)


def sumo_args(bins, net, seed):
    return [bins['sumo'],'-n',str(net),'-r','routes.rou.xml','-a','works.add.xml','--seed',str(seed),'--begin','0','--end',str(END+1),
            '--step-length',str(STEP),'--time-to-teleport',str(TELEPORT_S),'--ignore-junction-blocker',str(JUNCTION_BLOCKER_S),
            '--collision.action','warn','--collision.check-junctions','true','--collision-output','collisions.xml',
            '--fcd-output','fcd.xml','--device.fcd.begin',str(PRE),'--device.fcd.period',str(SAMPLE),'--fcd-output.acceleration','true',
            '--fcd-output.attributes','x,y,angle,speed,pos,lane,acceleration','--tripinfo-output','trips.xml',
            '--tripinfo-output.write-unfinished','true','--tripinfo-output.write-undeparted','true','--statistic-output','statistics.xml',
            '--no-step-log','true','--duration-log.disable','true','--log','run.log']


def net_info(path):
    """信号灯程序、信号头（每个进口道一个）、施工车道形状、路段长度。"""
    root = ET.parse(path).getroot()
    programs = {}
    for tl in root.findall('tlLogic'):
        ph = [(float(p.get('duration')), p.get('state')) for p in tl.findall('phase')]
        programs[tl.get('id')] = {'offset':float(tl.get('offset', '0')),'phases':ph,'cycle':sum(d for d, _ in ph)}
    lanes = {}
    for e in root.findall('edge'):
        if e.get('function'): continue
        for l in e.findall('lane'):
            lanes[l.get('id')] = [[float(v) for v in p.split(',')[:2]] for p in l.get('shape').split()]
    groups = {}
    for c in root.findall('connection'):
        if c.get('tl') and not c.get('from').startswith(':'):
            g = groups.setdefault((c.get('tl'), c.get('from')), {'idx':set(),'lanes':set()})
            g['idx'].add(int(c.get('linkIndex'))); g['lanes'].add(c.get('from')+'_'+c.get('fromLane'))
    heads = []
    for (tl, edge), g in sorted(groups.items()):
        pts = [lanes[l][-1] for l in sorted(g['lanes'])]
        x, y = sum(p[0] for p in pts)/len(pts), sum(p[1] for p in pts)/len(pts)
        lon, lat = lonlat_e6(x, y)
        heads.append({'id':tl+'|'+edge,'tls':tl,'idx':sorted(g['idx']),'lon_e6':lon,'lat_e6':lat,'_uv':UV(x, y)})
    return programs, heads, lanes


def tls_state(p, t):
    x = (t-p['offset']) % p['cycle']
    for d, s in p['phases']:
        if x < d: return s
        x -= d
    return p['phases'][-1][1]


def queue_now(stopped, length=None):
    """施工段起点往上游、断档 ≤ 60 m 的连续排队长度（原型 run_scen.py 的规则）。"""
    ext = prev = 0.0
    for d in sorted(stopped):
        if d-prev > QUEUE_GAP: break
        ext = prev = d
    return ext


def queue_count(dists):
    """同一规则数车：从施工段起点往上游，断档 ≤ 60 m 连着的有几辆。"""
    return queue_parts([(d, 0) for d in dists])[0]


def queue_parts(items):
    """items = [(沿路线到施工段的距离, 在 Lonsdale / Albert 链上 1 / 横街 0)]：连着的有几辆、其中几辆在链上。"""
    n = c = 0; prev = 0.0
    for d, on_chain in sorted(items):
        if d-prev > QUEUE_GAP: break
        n += 1; c += on_chain; prev = d
    return n, c


def minute_series(ts, qs, es):
    """每分钟一项 [分钟, 实际排队 m, 引擎算法 m]：取到这一分钟为止的最后一个 90 s 信号周期——实际排队取最长（队尾），引擎算法取平均。"""
    out = []
    for m in range(SHOWN//60+1):
        hi = m*60; lo = bisect.bisect_right(ts, hi-CYCLE); j = bisect.bisect_right(ts, hi)
        lo = min(lo, j-1)
        out.append([m, round(max(qs[lo:j]), 1), round(sum(es[lo:j])/(j-lo)*VEH_M/LANES_M, 1)])
    return out


def run_job(spec):
    """一个情景：写路线 → 跑 SUMO → 读 FCD 出回放块和指标。单独进程跑（build() 用子进程并行几个情景）。"""
    t0 = time.time()
    k, folder, out = spec['scenario'], Path(spec['folder']), Path(spec['out'])
    cache = Path(spec['cache'])
    demand = json.loads((cache/'demand.json').read_text())
    routes = demand['routes']
    rows = vehicles(routes, spec['seed'])
    plan = assign(rows, routes, spec['share'])
    write_routes(folder, plan); write_additional(folder, SCENARIOS[k]['closed'])
    args = sumo_args(spec['bins'], cache/'base.net.xml', spec['seed'])
    (folder/'command.json').write_text(json.dumps([str(a) for a in args[1:]], indent=1)+'\n')
    command(args, folder, 3600)
    t_sumo = time.time()
    result = export(folder, out, k, cache/'base.net.xml', demand, plan)
    result['wall'] = {'sumo_s':round(t_sumo-t0, 2),'export_s':round(time.time()-t_sumo, 2)}
    dump(folder/'result.json', result)


def export(folder, out, scenario, net_path, demand, plan):
    programs, heads, lanes = net_info(net_path)
    length = demand['length']
    chain = dict(demand['chain'])
    write_frames = SCENARIOS[scenario]['frames']
    heads = [h for h in heads if in_box(VIEW_BOX, *h['_uv'])]
    shown_tls = sorted({h['tls'] for h in heads})
    for h in heads: del h['_uv']
    routes = demand['routes']
    info = {}  # 车 → (到施工段距离表 or None)
    for v, edges, diverted, _ in plan:
        info[v['id']] = None if diverted else routes[v['route']]['to_works']
    catalog, index, seen = [], {}, set()
    frames, chunks, size = [], [], 0
    ts, qs, es, ec = [], [], [], []
    n_min = SHOWN//60
    halting, harsh = [0.0]*n_min, [0]*n_min
    braking, last_edge = set(), {}
    def flush():
        nonlocal size
        if not frames: return
        name = 'frames-%03d.json' % len(chunks)
        dump(out/name, {'frames':frames})
        data = (out/name).read_bytes()
        chunks.append({'file':name,'start':frames[0]['t'],'end':frames[-1]['t'],'frames':len(frames),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
        frames.clear(); size = 0
    for _, ts_el in ET.iterparse(folder/'fcd.xml', events=['end']):
        if ts_el.tag != 'timestep': continue
        sim_t = float(ts_el.get('time')); t = int(round(sim_t))-PRE
        if t < 0 or t > SHOWN:
            ts_el.clear(); continue
        agents, stopped, queued, halt, now_braking = [], [], [], 0, set()
        shown = t < SHOWN
        for a in ts_el:
            if a.tag != 'vehicle': continue
            vid = a.get('id')
            x, y, ang, v = float(a.get('x')), float(a.get('y')), float(a.get('angle')), float(a.get('speed'))
            lane = a.get('lane', ''); edge = lane.rsplit('_', 1)[0]; internal = edge.startswith(':')
            if not internal: last_edge[vid] = edge
            cx, cy = centre(x, y, ang, CAR[0])
            if shown and in_box(VIEW_BOX, *UV(cx, cy)):
                seen.add(vid)
                if v < HALT_SPEED: halt += 1
                if float(a.get('acceleration', '0')) <= HARSH_DECEL:
                    now_braking.add(vid)
                    if vid not in braking: harsh[t//60] += 1
                if write_frames:
                    if vid not in index:
                        index[vid] = len(catalog); catalog.append({'id':vid,'type':'car','length_m':CAR[0],'width_m':CAR[1]})
                    lon, lat = lonlat_e6(cx, cy)
                    agents.append([index[vid], lon, lat, round(ang) % 360, round(v*100)])
            if v >= QUEUE_SPEED: continue
            pos = float(a.get('pos'))
            # 实际排队：Lonsdale / Albert St 西行这一串上停着的车
            if edge == WORKS: stopped.append(0.0)
            elif edge in chain: stopped.append(chain[edge]+length[edge]-pos)
            # 引擎算法：还要穿过施工段的车（路线上施工段在前面），按沿路线到施工段的距离
            tw = info.get(vid)
            if tw is None: continue
            if edge == WORKS: queued.append((0.0, 1))
            elif not internal and edge in tw: queued.append((tw[edge]+length[edge]-pos, int(edge in chain)))
            elif internal and last_edge.get(vid) in tw: queued.append((tw[last_edge[vid]], int(last_edge[vid] in chain)))
        braking = now_braking
        q = round(queue_now(stopped), 1)
        n_all, n_chain = queue_parts(queued)
        ts.append(t); qs.append(q); es.append(n_all); ec.append(n_chain)
        if shown:
            halting[t//60] += halt*SAMPLE/60
            if write_frames:
                frames.append({'t':t,'a':agents,'tls':{k:tls_state(programs[k], sim_t-STEP) for k in shown_tls},'q':q})
                size += 40*len(agents)+30*len(shown_tls)+40
                if len(frames) >= CHUNK_FRAMES or size > CHUNK_BYTES: flush()
        ts_el.clear()
    flush()
    if ts != list(range(0, SHOWN+1, SAMPLE)):
        raise RuntimeError('FCD covers %d of %d samples' % (len(ts), SHOWN//SAMPLE+1))
    # 还没进路网的车（插入被堵住）：要穿过施工段的也算在引擎算法的排队里
    trips = {}
    for r in ET.parse(folder/'trips.xml').getroot().iter('tripinfo'):
        trips[r.get('id')] = r
    waiting_all, pend = [], []
    for v, edges, diverted, _ in plan:
        r = trips.get(v['id'])
        dep = float(r.get('depart', '-1')) if r is not None else -1.0
        dep = dep if dep >= 0 else math.inf
        if dep > v['depart']+STEP:
            waiting_all.append((v['depart'], dep))
            if info.get(v['id']) is not None: pend.append((v['depart'], dep))
    starts, ends = sorted(a for a, _ in pend), sorted(b for _, b in pend)
    ep = [bisect.bisect_right(starts, t+PRE)-bisect.bisect_right(ends, t+PRE) for t in ts]
    es = [a+b for a, b in zip(es, ep)]
    series = minute_series(ts, qs, es)
    # 09:00 那个数拆开看（最后一个周期的平均车数）：排在 Lonsdale / Albert 西行链上的、回溢到横街上的、还没能进路网的
    lo = bisect.bisect_right(ts, SHOWN-CYCLE); mean = lambda xs: round(sum(xs[lo:])/(len(ts)-lo), 1)
    parts = {'lonsdale_albert':mean(ec),'side_streets':mean([a-b-c for a, b, c in zip(es, ec, ep)]),'waiting_to_enter':mean(ep)}
    backlog_end = sum(1 for a, b in waiting_all if a <= END < b)
    tele_log = teleports(folder, info)
    # 施工段末端线圈：每辆车第一次通过的时刻
    passed = {}
    wo = folder/'works_out.xml'
    if wo.exists():
        for e in ET.parse(wo).getroot().iter('instantOut'):
            if e.get('state') in ('enter', 'stay'):
                passed.setdefault(e.get('vehID'), float(e.get('time')))
    throughput = sum(1 for tt in passed.values() if PRE <= tt < END)
    stats = ET.parse(folder/'statistics.xml').getroot()
    safety, tele = stats.find('safety'), stats.find('teleports')
    # 车道上的碰撞 = 失败；路口内部的「碰撞」单独报：OSM 合并出来的路口内部车道几何会重叠（SUMO 默认根本不查路口），
    # 用 warn 只记录不改变动力学；ignore-junction-blocker 放行的车穿过堵路口的车也记在这里，所以两种都诚实写进 metrics
    kinds = [c.get('type') for c in ET.parse(folder/'collisions.xml').getroot().findall('collision')]
    junction = sum(1 for k in kinds if k == 'junction')
    collisions = max(len(kinds)-junction, int(safety.get('collisions'))-junction)
    loss, completed = {}, 0
    for vid, r in trips.items():
        loss[vid] = float(r.get('timeLoss', '0'))+float(r.get('departDelay', '0'))
        if float(r.get('arrival', '-1')) >= PRE: completed += 1
    cohort = [v['id'] for v, _, _, _ in plan if PRE <= v['depart'] < END]
    in_cohort = set(cohort)
    works_shape = [list(lonlat_e6(x, y)) for x, y in lanes.get(WORKS_LANE, [])]
    manifest = {'version':2,'network':'real','scenario':scenario,'duration_s':SHOWN,'sample_s':SAMPLE,'clock0_s':0,
        'agent_columns':['i','lon_e6','lat_e6','angle_deg','speed_cms'],'agents':catalog,'signal_heads':heads,'chunks':chunks,
        'works':{'link':WORKS,'closed_lane':WORKS_LANE if SCENARIOS[scenario]['closed'] else None,'lane_shape_e6':works_shape,
                 'closed_from_s':0 if SCENARIOS[scenario]['closed'] else None},
        'metrics':{'vehicles':len(seen),'completed':completed,'teleports':int(tele.get('total')),'collisions':collisions,'junction_collisions':junction,
                   'emergency_braking':int(safety.get('emergencyBraking')),
                   'mean_timeloss_s':round(sum(loss.get(v, 0.0) for v in cohort)/len(cohort), 1) if cohort else None,'mean_extra_s':None,
                   'works_queue_max_m':max(qs[:-1]),'works_queue_mean_m':round(sum(qs[:-1])/(len(qs)-1), 1),
                   'works_queue_end_m':series[-1][1],'works_queue_equiv_end_m':series[-1][2],
                   'works_queue_equiv_max_m':max(s[2] for s in series),'works_queue_equiv_end_vehicles':parts,
                   'queue_series':series,
                   'works_throughput_vph':throughput,'works_capacity_assumption_vph':ENGINE_CAPACITY_VPH,
                   'works_demand_vph':sum(1 for v, _, _, _ in plan if v['id'] in in_cohort and info.get(v['id']) is not None),
                   'insertion_backlog_end':backlog_end,'teleports_in_hour':tele_log['in_hour'],'teleports_works_bound':tele_log['works_bound'],
                   'teleport_edges':tele_log['edges'],
                   'detour_vehicles':sum(1 for v, _, d, _ in plan if d and v['id'] in in_cohort),
                   'eligible_vehicles':sum(1 for v, _, _, el in plan if el and v['id'] in in_cohort),
                   'cohort_vehicles':len(cohort)},
        'per_minute':{'halting':[round(h, 1) for h in halting],'harsh':harsh}}
    return {'manifest':manifest,'loss':{v: loss.get(v, 0.0) for v in cohort},'passed':passed,
            'bound':sorted(v for v, tw in info.items() if tw is not None)}


def teleports(folder, info):
    """run.log 里每一条瞬移：08:00–09:00 的条数、其中还没过施工段的施工路线车（会让排队变短）、按路段最多的 5 段。"""
    rows = []
    for line in (folder/'run.log').read_text(encoding='utf-8', errors='replace').splitlines():
        m = re.search(r"Teleporting vehicle '([^']+)';.*?lane='([^']*)'.*?time=([0-9]+(?:\.[0-9]+)?)", line)
        if m: rows.append((m.group(1), m.group(2).rsplit('_', 1)[0], float(m.group(3))))
    hour = [r for r in rows if PRE <= r[2] <= END]
    wb = [r for r in hour if info.get(r[0]) is not None and (r[1] == WORKS or r[1] in info[r[0]])]
    edges = {}
    for _, e, _ in hour: edges[e] = edges.get(e, 0)+1
    return {'in_hour':len(hour),'works_bound':len(wb),'edges':sorted(edges.items(), key=lambda x: (-x[1], x[0]))[:5]}


def delayed_vs_baseline(passed_k, passed_b, bound):
    """同一批车（这个情景里要穿过施工段的），09:00 前「无施工时已经过了施工点、这里还没过」的车数 —— 就是引擎 D/D/1 里的排队车数。"""
    n = 0
    for v in bound:
        b, k = passed_b.get(v, math.inf), passed_k.get(v, math.inf)
        if b < END and not k < END: n += 1
        elif k < END and not b < END: n -= 1
    return n


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
    shares = {'baseline':0.0,'original':config['p_original'],'ai':config['p_ai']}
    jobs = max(1, int(os.environ.get('SUMO_REAL_JOBS') or min(3, os.cpu_count() or 1)))
    pending = list(config['scenarios']); walls = {}; procs = {}
    while pending or procs:
        while pending and len(procs) < jobs:
            k = pending.pop(0); folder = work/k
            if folder.exists(): shutil.rmtree(folder)
            folder.mkdir(parents=True)
            spec = {'scenario':k,'folder':str(folder),'out':str(out/k),'cache':str(cache),'seed':config['seed'],'share':shares[k],'bins':bins}
            (folder/'job.json').write_text(json.dumps(spec, indent=1)+'\n')
            log = open(folder/'stdout.log', 'w')
            # 每个情景一个子进程：SUMO + 读 FCD 都在里面，几个情景真并行（Python 解析是 CPU 活，线程不顶用）
            procs[k] = (subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--job', str(folder/'job.json')], cwd=folder,
                                         stdout=log, stderr=subprocess.STDOUT), time.time(), log)
        for k, (p, t0, log) in list(procs.items()):
            try:
                rc = p.wait(timeout=.1)
            except subprocess.TimeoutExpired:
                if time.time()-t0 > 1800:  # 正常一个情景十几秒到一分钟；卡住就全部停掉，不留孤儿进程
                    for q, _, lg in procs.values(): q.kill(); lg.close()
                    raise RuntimeError('SUMO timed out: '+k)
                continue
            log.close(); del procs[k]; walls[k] = round(time.time()-t0, 2)
            if rc:
                for q, _, lg in procs.values(): q.kill(); lg.close()
                tail = lambda f: (work/k/f).read_text()[-4000:] if (work/k/f).exists() else ''
                raise RuntimeError('SUMO failed ('+k+'):\n'+tail('stdout.log')+tail('run.log'))
    results = {k: json.loads((work/k/'result.json').read_text()) for k in config['scenarios']}
    manifests = {k: r['manifest'] for k, r in results.items()}
    for k, m in manifests.items():
        if m['metrics']['collisions']:
            raise RuntimeError('SUMO reported %d collision(s) in %s' % (m['metrics']['collisions'], k))
    base = results.get('baseline')
    through = {v['id'] for v in vehicles(demand['routes'], config['seed']) if demand['routes'][v['route']]['through_works']}
    for k, m in manifests.items():
        mt = m['metrics']
        mt['works_traffic_extra_s'] = None; mt['works_queue_vs_baseline_end_m'] = None
        if base is not None and k != 'baseline':
            bl, kl = base['loss'], results[k]['loss']
            ids = [v for v in bl if v in kl]
            mt['mean_extra_s'] = round(sum(kl[v]-bl[v] for v in ids)/len(ids), 1) if ids else None
            # 原路线要穿过施工段的那批车（含绕行的）：指示牌管的就是它们
            w = [v for v in ids if v in through]
            mt['works_traffic_extra_s'] = round(sum(kl[v]-bl[v] for v in w)/len(w), 1) if w else None
            # 对照组算法：同一批车无施工时 09:00 前已经过了施工点、有施工时还没过 → D/D/1 的排队车数 × 7 m ÷ 2
            n = delayed_vs_baseline(results[k]['passed'], base['passed'], results[k]['bound'])
            mt['works_queue_vs_baseline_end_m'] = round(n*VEH_M/LANES_M, 1)
        m.update(engine=version, seed=config['seed'], diversion_share=shares[k])
        dump(out/k/'manifest.json', m)
    source = os.environ.get('SUMO_REAL_SOURCE') or ('local-macos-arm64' if sys.platform == 'darwin' and platform.machine() == 'arm64' else sys.platform+'-'+platform.machine())
    index = {'version':2,'network':'real','engine':version,'generator_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'seed':config['seed'],'hour':HOUR,'works':{'link':WORKS,'lanes_closed':1},
        'params':{**config,'source':source,'hour_window':[HOUR, HOUR+1],'warmup_s':PRE,'warmup_before_clock0':True,'shown_s':SHOWN,
                  'sim_s':END,'sample_s':SAMPLE,'step_s':STEP,'cycle_s':CYCLE,'signal_2935_green':green,'green_2935':green,
                  'works_lane_speed_kmh':round(WORKS_SPEED*3.6),'works_closed_from':'%02d:00:00' % HOUR,
                  'engine_capacity_vph':ENGINE_CAPACITY_VPH,'time_to_teleport_s':TELEPORT_S,'ignore_junction_blocker_s':JUNCTION_BLOCKER_S,
                  'demand':'flows.json wd hour %d' % HOUR,'demand_veh_per_h':demand['veh_per_h'],
                  'works_demand_veh_per_h':demand['works_veh_per_h'],'works_count_veh_per_h':demand['works_count_veh_per_h'],
                  'routes':len(demand['routes']),'network_nodes':demand['nodes'],'network_links':demand['links'],
                  'counted_edges':demand['counted_edges'],'measured_edges':demand['measured_edges'],'net_edges':demand['edges'],
                  'chain_m':round(demand['chain'][-1][1]+demand['length'][demand['chain'][-1][0]]),
                  'network_extent':NETWORK_EXTENT['en'],'network_extent_zh':NETWORK_EXTENT['zh'],
                  'view_box_uv_m':list(VIEW_BOX),'study_area':NETWORK_EXTENT['en']},
        'assumptions':{k:[x.replace('{green}', str(round(green*100))).replace('{extent}', NETWORK_EXTENT[k]) for x in v] for k, v in ASSUMPTIONS.items()},
        'scenarios':[{'id':k,'label':{'en':SCENARIOS[k]['en'],'zh':SCENARIOS[k]['zh']},'diversion_share':shares[k],
                      'manifest':k+'/manifest.json','metrics':manifests[k]['metrics']} for k in config['scenarios']],
        'timing':{'prepare_s':round(t_prep-t_start, 2),'sumo_s':walls,'job_s':{k: r['wall'] for k, r in results.items()},
                  'total_s':round(time.time()-t_start, 2),'jobs':jobs}}
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
    parser.add_argument('--job', help=argparse.SUPPRESS)  # build() 内部用：跑一个情景
    args = parser.parse_args()
    if args.job:
        run_job(json.loads(Path(args.job).read_text()))
        sys.exit(0)
    if args.prepare_only:
        print(prepare(*binaries(), args.green_2935))
        sys.exit(0)
    if not args.output:
        parser.error('--output is required')
    for k, v in validate_real({k: getattr(args, k) for k in DEFAULTS}).items(): setattr(args, k, v)
    build(args)
