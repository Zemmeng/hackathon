#!/usr/bin/env python3
"""用途：CBD 建筑轮廓 + 高度 + 用途 + 临街路段 → public/<area>/buildings.json（任务 T11，需求见 issue #21）。

用法：
  apps/roads/.venv/bin/python apps/roads/tools/fetch_buildings.py [--bbox S,W,N,E] [--area cbd] [--refresh]
      第一次（或 --refresh）从 OSM 拉 building=* 存到 raw/osm_buildings.gpkg，之后只用本地文件重算
前置：public/<area>/network.json（tools/build_network.py）；
      可选 raw/com_footprints_2018.geojson（市政 2018 建筑轮廓，补 OSM 缺的高度；下载命令见 README）
高度优先级：OSM height → OSM building:levels × 3.2 → 市政轮廓 → 默认 12 m（height_src 记来源）
退出码：0 成功；1 所有 Overpass 服务器都失败，或缺 network.json
依赖：osmnx 2.x（带 geopandas、shapely）
数据许可证：ODbL，页面要写「© OpenStreetMap contributors」。
坑：OSMnx 的 bbox 是 (西, 南, 东, 北)；Overpass 主站时常拒连，按 OVERPASS 顺序自动换镜像。
"""
import argparse, os, sys, warnings

warnings.filterwarnings('ignore')
import osmnx as ox

MOD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_BBOX = (-37.8235, 144.9480, -37.8060, 144.9760)
M_PER_LEVEL = 3.2        # 只有楼层数时每层按多少米
DEFAULT_HEIGHT = 12.0    # OSM 和市政数据都没有高度时
FRONTAGE_M = 30          # 临街：楼离路段中心线多远以内
FRONTAGE_MAX = 4         # 每栋楼最多记几条临街路段（控制体积）
SIMPLIFY_DEG = 0.000005  # 轮廓抽稀约 0.5 米
# private.coffee 和 kumi 是同一台机器（193.219.97.30），09-29 常回 504，OSMnx 遇 504 会无限重试卡住 → 排最后
OVERPASS = ['https://overpass-api.de/api', 'https://maps.mail.ru/osm/tools/overpass/api',
            'https://overpass.private.coffee/api', 'https://overpass.kumi.systems/api']


def fetch(bbox, raw):
    """→ raw/osm_buildings.gpkg；主站拒连就换镜像。"""
    s, w, n, e = bbox
    ox.settings.cache_folder = os.path.join(raw, 'osm_cache')
    ox.settings.requests_timeout = 300
    for url in OVERPASS:
        ox.settings.overpass_url = url
        try:
            B = ox.features_from_bbox((w, s, e, n), {'building': True})
        except Exception as ex:
            print('·  %s 失败：%s' % (url, str(ex)[:120]), flush=True); continue
        B = B[B.geometry.geom_type.isin(['Polygon', 'MultiPolygon'])]
        B = B[[c for c in B.columns if not isinstance(B[c].iloc[0] if len(B) else None, (list, dict))]]
        p = os.path.join(raw, 'osm_buildings.gpkg')
        B.reset_index().to_file(p, driver='GPKG')
        print('✅ OSM 建筑 %d 个（%s）→ %s' % (len(B), url, p), flush=True)
        return p
    print('❌ 所有 Overpass 服务器都失败'); sys.exit(1)


def num(v):
    """'24'、'24 m'、'24.5;30' → 24.0；解析不了返回 None。"""
    try:
        x = float(str(v).split(';')[0].replace('m', '').strip())
        return x if x > 0 else None
    except (ValueError, TypeError):
        return None


def use_of(r):
    """OSM 标签 → issue #21 第 5 节的 use 枚举。"""
    g = lambda k: str(r.get(k) or '').lower()
    b, am, tour = g('building'), g('amenity'), g('tourism')
    if b == 'parking' or am in ('parking', 'parking_entrance'):
        return 'parking'
    if b == 'hotel' or tour in ('hotel', 'hostel', 'motel', 'apartment', 'guest_house'):
        return 'hotel'
    if b in ('university', 'school', 'college', 'kindergarten') or am in ('university', 'school', 'college', 'kindergarten'):
        return 'education'
    if b in ('civic', 'public', 'government', 'church', 'cathedral', 'chapel', 'hospital', 'train_station', 'transportation',
             'museum', 'library', 'fire_station', 'stadium') \
            or am in ('library', 'townhall', 'courthouse', 'place_of_worship', 'hospital', 'theatre', 'police', 'arts_centre',
                      'community_centre', 'post_office', 'fire_station', 'cinema', 'conference_centre') \
            or tour in ('museum', 'gallery', 'attraction'):
        return 'public'
    if b in ('retail', 'supermarket', 'kiosk', 'shop') or g('shop'):
        return 'retail'
    if b in ('office', 'commercial') or g('office'):
        return 'office'
    if b in ('apartments', 'residential', 'house', 'terrace', 'dormitory', 'semidetached_house', 'detached'):
        return 'residential'
    return 'other'


def build(bbox, raw, area):
    import json, datetime, math
    from zoneinfo import ZoneInfo
    import geopandas as gpd
    from shapely import STRtree
    from shapely.geometry import LineString, Point, Polygon, box

    np_ = os.path.join(MOD, 'public', area, 'network.json')
    if not os.path.exists(np_):
        print('❌ 没有 %s：先跑 tools/build_network.py' % np_); sys.exit(1)
    net = json.load(open(np_, encoding='utf-8'))
    s, w, n, e = bbox
    lat0, lon0 = (s + n) / 2, (w + e) / 2
    k = math.cos(math.radians(lat0))
    xy = lambda la, lo: ((lo - lon0) * 111320 * k, (la - lat0) * 111320)

    B = gpd.read_file(os.path.join(raw, 'osm_buildings.gpkg'))
    B = B[B['element'].isin(['way', 'relation'])]
    area_box = box(w, s, e, n)

    # 市政 2018 轮廓：每行是一栋楼的一部分；高 = 各部分楼顶最高 − 楼的地面（structure_min_elevation）
    com = []
    cp = os.path.join(raw, 'com_footprints_2018.geojson')
    if os.path.exists(cp):
        C = gpd.read_file(cp)
        for g, top, base in zip(C.geometry, C['footprint_max_elevation'], C['structure_min_elevation']):
            if g is not None and top is not None and base is not None and top > base:
                p = g.representative_point()
                com.append((Point(*xy(p.y, p.x)), float(top) - float(base)))
    com_tree = STRtree([c[0] for c in com]) if com else None

    segs, seg_link = [], []
    for l in net['links']:
        pts = [xy(*q) for q in l['geometry']]
        for a_, b_ in zip(pts, pts[1:]):
            if a_ != b_:
                segs.append(LineString([a_, b_])); seg_link.append(l['id'])
    link_tree = STRtree(segs)

    out, src_cnt = [], {}
    for _, r in B.iterrows():
        geom = r.geometry
        if geom is None or not geom.is_valid and not geom.buffer(0).is_valid:
            continue
        geom = geom if geom.is_valid else geom.buffer(0)
        if not area_box.contains(geom):
            continue  # 跨 bbox 边界的楼不要（验收要求所有点都在 bbox 内）
        poly = max(geom.geoms, key=lambda x: x.area) if geom.geom_type == 'MultiPolygon' else geom
        poly = Polygon(poly.exterior).simplify(SIMPLIFY_DEG)
        ring = [(round(la, 5), round(lo, 5)) for lo, la in poly.exterior.coords][:-1]
        ring = [p for i, p in enumerate(ring) if i == 0 or p != ring[i - 1]]
        if len(ring) < 3:
            continue
        pxy = Polygon([xy(la, lo) for la, lo in ring])
        levels = num(r.get('building:levels'))
        h, src = num(r.get('height')), 'osm_height'
        if h is None and levels:
            h, src = levels * M_PER_LEVEL, 'osm_levels'
        if h is None and com_tree is not None:
            hits = [com[i][1] for i in com_tree.query(pxy, predicate='contains')]
            if hits:
                h, src = max(hits), 'com'
        if h is None:
            h, src = DEFAULT_HEIGHT, 'default'
        h = min(h, 340.0)
        near = {}
        for i in link_tree.query(pxy, predicate='dwithin', distance=FRONTAGE_M):
            d = segs[i].distance(pxy)
            if seg_link[i] not in near or d < near[seg_link[i]]:
                near[seg_link[i]] = d
        frontage = [{'link': lid, 'dist_m': round(d, 1)} for lid, d in sorted(near.items(), key=lambda kv: kv[1])[:FRONTAGE_MAX]]
        name = r.get('name')
        out.append({'id': '%s%s' % ('w' if r['element'] == 'way' else 'r', int(r['id'])),
                    'name': name if isinstance(name, str) and name else None, 'use': use_of(r),
                    'height_m': round(h, 1), 'levels': int(levels) if levels else None, 'height_src': src,
                    'footprint': [list(p) for p in ring], 'frontage': frontage})
        src_cnt[src] = src_cnt.get(src, 0) + 1
    out.sort(key=lambda x: x['id'])
    doc = {'version': 1, 'area': area, 'bbox': list(bbox),
           'generated': datetime.datetime.now(ZoneInfo('Australia/Melbourne')).isoformat(timespec='seconds'),
           'sources': ['© OpenStreetMap contributors (ODbL)', 'City of Melbourne 2018 Building Footprints (CC BY)'],
           'assumptions': {'m_per_level': M_PER_LEVEL, 'default_height_m': DEFAULT_HEIGHT, 'frontage_m': FRONTAGE_M,
                           'frontage_max': FRONTAGE_MAX, 'simplify_deg': SIMPLIFY_DEG,
                           'com_height': '市政 2018 轮廓：落在楼内的各部分 footprint_max_elevation 最大值 − structure_min_elevation'},
           'buildings': out}
    p = os.path.join(MOD, 'public', area, 'buildings.json')
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    uses = {}
    for x in out:
        uses[x['use']] = uses.get(x['use'], 0) + 1
    print('✅ buildings.json：%d 栋；高度来源 %s；用途 %s；有临街路段 %d；%d KB'
          % (len(out), src_cnt, uses, sum(1 for x in out if x['frontage']), os.path.getsize(p) // 1024))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bbox', default=','.join(map(str, DEFAULT_BBOX)), help='南,西,北,东')
    ap.add_argument('--area', default='cbd')
    ap.add_argument('--raw', default=os.path.join(MOD, 'raw'))
    ap.add_argument('--refresh', action='store_true', help='重新从 OSM 拉')
    a = ap.parse_args()
    bbox = tuple(float(x) for x in a.bbox.split(','))
    os.makedirs(a.raw, exist_ok=True)
    gp = os.path.join(a.raw, 'osm_buildings.gpkg')
    if a.refresh or not os.path.exists(gp):
        fetch(bbox, a.raw)
    build(bbox, a.raw, a.area)


if __name__ == '__main__':
    main()
