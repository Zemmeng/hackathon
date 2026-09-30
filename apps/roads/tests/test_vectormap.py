#!/usr/bin/env python3
"""用途：校验 public/cbd/vectormap.json（T35：给网页 CITY 层当底图的真实 OSM 矢量图层）。文件还没生成时只做骨架检查。
数据由 tools/fetch_vectormap.py 在构建期从 OpenFreeMap 的 OpenMapTiles 矢量瓦片解码而来，网页运行时只取这一个同源文件。
用法：python3 tests/test_vectormap.py（test.sh 会自动跑）；最后一行固定「N passed, M failed」
许可：ODbL（OpenStreetMap）+ CC BY 4.0（OpenMapTiles schema）。
"""
import json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CBD = os.path.join(os.path.dirname(HERE), 'public', 'cbd')
P = F = 0
FILL_KINDS = ['water', 'aeroway', 'wood', 'grass', 'wetland', 'ice', 'sand', 'park', 'sport', 'civic', 'urban']
LINE_KINDS = ['waterway', 'rail', 'transit']
MIN_AREA_M2 = 200.0          # 和 fetch_vectormap.py 一致：比这小的面在构建期就丢了
PAD_DEG = 0.022              # 瓦片是整块解码的（没按 bbox 裁），允许超出 bbox 一个 z14 瓦片（经度 360/2^14 ≈ 0.02197°）
YARRA_LAT = -37.815          # 雅拉河在 bbox 南侧；用来确认水域不是解错了地方


def ok(cond, msg):
    global P, F
    if cond:
        P += 1; print('✅ ' + msg)
    else:
        F += 1; print('❌ ' + msg)


def area_m2(ring):
    """等距圆柱近似，和构建脚本同一套算法（只用来筛零碎面）"""
    k = 111320 * math.cos(math.radians(ring[0][0]))
    a = 0.0
    for i in range(len(ring)):
        la0, lo0 = ring[i]
        la1, lo1 = ring[(i + 1) % len(ring)]
        a += (lo0 * k) * (la1 * 111320) - (lo1 * k) * (la0 * 111320)
    return abs(a) / 2


def line_len(pts):
    k = 111320 * math.cos(math.radians(pts[0][0]))
    return sum(math.hypot((pts[i + 1][0] - pts[i][0]) * 111320, (pts[i + 1][1] - pts[i][1]) * k)
               for i in range(len(pts) - 1))


p = os.path.join(CBD, 'vectormap.json')
if not os.path.exists(p):
    print('·  vectormap.json 还没生成，跳过它的校验（python3 tools/fetch_vectormap.py）')
    ok(True, '骨架：test_vectormap.py 能跑')
else:
    raw = open(p, encoding='utf-8').read()
    doc = json.loads(raw)
    ok(os.path.getsize(p) <= 2 * 1024 * 1024, 'vectormap.json ≤ 2 MB（%d KB）' % (os.path.getsize(p) // 1024))
    FIELDS = {'version', 'area', 'bbox', 'generated', 'zoom', 'tile_source', 'sources', 'assumptions', 'polygons', 'lines'}
    ok(set(doc) == FIELDS, '顶层字段就是约定的那几个%s' % ('（多出 %s）' % sorted(set(doc) - FIELDS) if set(doc) - FIELDS else ''))
    ok(doc.get('version') == 1 and doc.get('area') == 'cbd', 'version 1、area cbd')
    ok(doc.get('generated', '').startswith('2'), '记了生成时间（%s）' % doc.get('generated', '')[:19])
    # bbox 得和同目录另外两个文件一致，不然 CITY 层会缺一块或多一块
    for name in ('network.json', 'buildings.json'):
        q = os.path.join(CBD, name)
        if os.path.exists(q):
            ok(doc['bbox'] == json.load(open(q, encoding='utf-8'))['bbox'], 'bbox 和 %s 一致' % name)

    # 瓦片源：必须是模板，不能是写死的一块瓦片
    ts = doc.get('tile_source', '')
    ok(ts.startswith('https://') and '{z}' in ts and '{x}' in ts and '{y}' in ts,
       'tile_source 是 {z}/{x}/{y} 模板（%s）' % ts[:60])
    ok(isinstance(doc.get('sources'), list) and any('OpenStreetMap' in s for s in doc['sources'])
       and any('OpenMapTiles' in s for s in doc['sources']), '署名里 OSM 和 OpenMapTiles 都在')
    ok(doc.get('zoom') == 14 and doc['assumptions'].get('round') == 6, 'zoom 14、经纬度留 6 位')

    # 图层：kind 在枚举内、顺序固定（重跑 diff 干净）、没有空图层
    pk = [x['kind'] for x in doc['polygons']]
    lk = [x['kind'] for x in doc['lines']]
    ok(all(k in FILL_KINDS for k in pk) and len(pk) == len(set(pk)), '面的 kind 都在枚举内且不重复（%s）' % pk)
    ok(all(k in LINE_KINDS for k in lk) and len(lk) == len(set(lk)), '线的 kind 都在枚举内且不重复（%s）' % lk)
    ok(pk == [k for k in FILL_KINDS if k in pk] and lk == [k for k in LINE_KINDS if k in lk], 'kind 按固定顺序输出')
    ok(not [x for x in doc['polygons'] if not x['polys']] and not [x for x in doc['lines'] if not x['pts']],
       '没有空图层')

    s, w, n, e = doc['bbox']
    bad, thin, dup, prec = [], [], 0, 0
    for x in doc['polygons']:
        ok_kind = x['kind']
        for poly in x['polys']:
            for ring in poly:
                if len(ring) < 3:
                    thin.append((ok_kind, len(ring))); continue
                if area_m2(ring) < MIN_AREA_M2:
                    bad.append((ok_kind, round(area_m2(ring)), ring[0]))
                for la, lo in ring:
                    if not (s - PAD_DEG <= la <= n + PAD_DEG and w - PAD_DEG <= lo <= e + PAD_DEG):
                        bad.append((ok_kind, (la, lo)))
                    if round(la, 6) != la or round(lo, 6) != lo:
                        prec += 1
    for x in doc['lines']:
        for pts in x['pts']:
            if len(pts) < 2:
                thin.append((x['kind'], len(pts))); continue
            if line_len(pts) < 1:
                bad.append((x['kind'], 'zero length', pts[0]))
            for la, lo in pts:
                if not (s - PAD_DEG <= la <= n + PAD_DEG and w - PAD_DEG <= lo <= e + PAD_DEG):
                    bad.append((x['kind'], (la, lo)))
                if round(la, 6) != la or round(lo, 6) != lo:
                    prec += 1
    for x in doc['polygons']:
        for poly in x['polys']:
            for ring in poly:
                dup += sum(1 for i in range(len(ring)) if ring[i] == ring[(i + 1) % len(ring)])
    for x in doc['lines']:
        for pts in x['pts']:
            dup += sum(1 for i in range(len(pts) - 1) if pts[i] == pts[i + 1])
    ok(not thin, '每个面 ≥ 3 个点、每条线 ≥ 2 个点%s' % ('（坏的：%s）' % thin[:3] if thin else ''))
    ok(not bad, '每个面/线都在 bbox ± %.3f° 内、面积 ≥ %d m²、长度 > 0%s' % (PAD_DEG, MIN_AREA_M2, ('（坏的：%s）' % bad[:3]) if bad else ''))
    ok(not dup and prec == 0, '没有相邻重复点（%d 处）、经纬度都规整到 6 位（%d 个超精度）' % (dup, prec))
    # 绕向：外环和洞都留着，网页按 nonzero 一次填完；这里只确认没有把环写成开放折线
    ok(all(len(ring) >= 3 and ring[0] != ring[-1] for x in doc['polygons'] for poly in x['polys'] for ring in poly),
       '环首尾点没重复记（闭合由 canvas closePath 做）')

    # 常识：水域里得有雅拉河（bbox 南侧的大水面），铁路/电车得有，且没有离谱的超长线段
    water = [ring for x in doc['polygons'] if x['kind'] == 'water' for poly in x['polys'] for ring in poly]
    big = [a for a in (area_m2(r) for r in water) if a >= 50000]
    ok(len(big) >= 1, '水域里有 ≥ 5 万 m² 的大水面（雅拉河），实测 %d 个' % len(big))
    ok(all(min(la for la, _ in r) < YARRA_LAT for r in water if area_m2(r) >= 50000),
       '大水面落在 bbox 南侧（雅拉河在 Flinders St 以南）')
    tr = [pts for x in doc['lines'] if x['kind'] == 'transit' for pts in x['pts']]
    ok(tr and any(line_len(q) >= 200 for q in tr), '电车线（transit）有 %d 段，其中有长过 200 m 的' % len(tr))
    rl = [pts for x in doc['lines'] if x['kind'] == 'rail' for pts in x['pts']]
    ok(rl and all(line_len(q) <= 3000 for q in rl), '铁路线（rail）%d 段，没有超过 3 km 的（瓦片内不可能有这么长的直段）' % len(rl))
    rails = sum(line_len(q) for q in rl)
    ok(1000 <= rails <= 200000, '铁路总长 %d m 在一座 CBD 的合理量级内' % round(rails))

    # 反向断言：不能有 key / token，也不能有住户等个人信息（只允许约定的坐标和字段）
    ok(not re.search(r'(sk-[A-Za-z0-9]{16,}|api[_-]?key|secret|token|Bearer\s)', raw, re.I), '反向：文件里没有 key / token 字样')
    extra = sorted(({k for x in doc['polygons'] for k in x} | {k for x in doc['lines'] for k in x}) - {'kind', 'polys', 'pts'})
    ok(not extra and not re.search(r'addr:|phone|email|@[a-z0-9-]+\.[a-z]', raw, re.I),
       '反向：只有 kind / polys / pts，没有地址、邮箱等字段%s' % ('（多出字段：%s）' % extra if extra else ''))
    ok(not re.search(r'https?://(?!tiles\.openfreemap\.org)', raw), '反向：文件里只出现瓦片源的地址，没有别的外链')

print('%d passed, %d failed' % (P, F))
sys.exit(1 if F else 0)
