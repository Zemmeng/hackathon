#!/usr/bin/env python3
"""用途：把 raw/gtfs/3.zip（电车）、4.zip（市区巴士）整理成 public/<area>/transit.json（格式见 PRD-2 §3B）。

用法：
  apps/roads/.venv/bin/python apps/roads/tools/build_transit.py [--bbox S,W,N,E] [--area cbd] [--wd 2026-09-29] [--we 2026-10-03]
前置：tools/fetch_gtfs.py 已下好 raw/gtfs/；tools/build_network.py 已生成 network.json
退出码：0 成功；1 缺输入文件
依赖：shapely（随 osmnx 装好）。巴士的 stop_times.txt 解压后约 900 MB，流式读，约 1–2 分钟。
做法：
  1. 服务日：calendar + calendar_dates 算出 wd / we 两天各自运营的 service_id
  2. 只留当天、在 bbox 内停站的车次；按（模式, 线路号, 方向）归组
  3. 每组取最常用的 shape，截 bbox 内的部分，每 SAMPLE_M 米取一个点，
     在 MATCH_M 米内找朝向差 ≤ 45° 的有向路段；一条路段至少命中 2 个点才算（避开路口处的误配）
     对不上的长度记 offnet_m（Swanston St 这类只走电车的段）
  4. 每小时班次 = 车次进 bbox 后第一站的出发小时
  5. 站点挂最近的路段（ROAD_LINK_M 米内），没有就 null
"""
import argparse, collections, csv, datetime, io, json, math, os, sys, zipfile

from shapely import STRtree
from shapely.geometry import LineString, Point

MOD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_BBOX = (-37.8235, 144.9480, -37.8060, 144.9760)
FEEDS = {'3': 'tram', '4': 'bus'}   # PTV 子包编号 → 模式（fetch_gtfs.py 里核对过 route_type）
SAMPLE_M = 10
MATCH_M = 15
ROAD_LINK_M = 30
MAX_ANGLE = 45


class Proj:
    """局部等距投影（米），CBD 范围内误差可以忽略。"""

    def __init__(self, lat0, lon0):
        self.lat0, self.lon0, self.k = lat0, lon0, math.cos(math.radians(lat0))

    def xy(self, lat, lon):
        return ((lon - self.lon0) * 111320 * self.k, (lat - self.lat0) * 111320)


def bearing(x1, y1, x2, y2):
    return math.degrees(math.atan2(y2 - y1, x2 - x1)) % 360


def angle_diff(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


def rows(z, name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), encoding='utf-8-sig'))


def active_services(z, day):
    ymd, wk = day.replace('-', ''), datetime.date.fromisoformat(day).strftime('%A').lower()
    on = {r['service_id'] for r in rows(z, 'calendar.txt') if r['start_date'] <= ymd <= r['end_date'] and r[wk] == '1'}
    if 'calendar_dates.txt' in z.namelist():
        for r in rows(z, 'calendar_dates.txt'):
            if r['date'] == ymd:
                (on.add if r['exception_type'] == '1' else on.discard)(r['service_id'])
    return on


def hour_of(t):
    return int(t.split(':')[0]) % 24


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bbox', default=','.join(map(str, DEFAULT_BBOX)), help='南,西,北,东')
    ap.add_argument('--area', default='cbd')
    ap.add_argument('--wd', default='2026-09-29', help='代表工作日（避开公众假期）')
    ap.add_argument('--we', default='2026-10-03', help='代表周六')
    ap.add_argument('--gtfs', default=os.path.join(MOD, 'raw', 'gtfs'))
    a = ap.parse_args()
    s, w, n, e = (float(x) for x in a.bbox.split(','))
    inb = lambda la, lo: s <= la <= n and w <= lo <= e
    np_ = os.path.join(MOD, 'public', a.area, 'network.json')
    miss = [p for p in [np_] + [os.path.join(a.gtfs, m + '.zip') for m in FEEDS] if not os.path.exists(p)]
    if miss:
        print('❌ 缺 %s：先跑 tools/build_network.py 和 tools/fetch_gtfs.py' % miss); sys.exit(1)

    net = json.load(open(np_, encoding='utf-8'))
    P = Proj((s + n) / 2, (w + e) / 2)
    seg_geoms, seg_meta = [], []
    for l in net['links']:
        pts = [P.xy(*p) for p in l['geometry']]
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            if (x1, y1) != (x2, y2):
                seg_geoms.append(LineString([(x1, y1), (x2, y2)])); seg_meta.append((l['id'], bearing(x1, y1, x2, y2)))
    tree = STRtree(seg_geoms)
    link_len = {l['id']: l['len_m'] for l in net['links']}

    def nearest_link(x, y, want_bearing=None, radius=MATCH_M):
        pt = Point(x, y)
        best = None
        for i in tree.query(pt, predicate='dwithin', distance=radius):
            lid, b = seg_meta[i]
            if want_bearing is not None and angle_diff(b, want_bearing) > MAX_ANGLE:
                continue
            d = seg_geoms[i].distance(pt)
            if best is None or d < best[0]:
                best = (d, lid)
        return best[1] if best else None

    routes, stops_out = [], {}
    for feed, mode in FEEDS.items():
        z = zipfile.ZipFile(os.path.join(a.gtfs, feed + '.zip'))
        svc = {'wd': active_services(z, a.wd), 'we': active_services(z, a.we)}
        stops = {}
        for r in rows(z, 'stops.txt'):
            try:
                la, lo = float(r['stop_lat']), float(r['stop_lon'])
            except ValueError:
                continue
            if inb(la, lo):
                stops[r['stop_id']] = (r['stop_name'], la, lo)
        rinfo = {r['route_id']: r['route_short_name'] or r['route_id'] for r in rows(z, 'routes.txt')}
        trips = {}
        for r in rows(z, 'trips.txt'):
            days = [k for k in ('wd', 'we') if r['service_id'] in svc[k]]
            if days:
                trips[r['trip_id']] = (rinfo.get(r['route_id'], r['route_id']), r.get('direction_id') or '0',
                                       r.get('shape_id'), r.get('trip_headsign') or '', days)
        first = {}                        # trip → (stop_sequence, 出发时刻) 进 bbox 后第一站
        served = collections.defaultdict(set)  # stop → 线路号
        for r in rows(z, 'stop_times.txt'):
            t = r['trip_id']
            if t not in trips or r['stop_id'] not in stops:
                continue
            seq = int(r['stop_sequence'])
            if t not in first or seq < first[t][0]:
                first[t] = (seq, r['departure_time'] or r['arrival_time'])
            served[r['stop_id']].add((trips[t][0], trips[t][1]))
        groups = collections.defaultdict(list)
        for t in first:
            short, d, shape, head, _ = trips[t]
            groups[(short, d)].append(t)
        want_shapes = {collections.Counter(trips[t][2] for t in ts).most_common(1)[0][0] for ts in groups.values()}
        shape_pts = collections.defaultdict(list)
        for r in rows(z, 'shapes.txt'):
            if r['shape_id'] in want_shapes:
                shape_pts[r['shape_id']].append((int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon'])))
        stop_routes = collections.defaultdict(set)
        by_route = collections.defaultdict(list)
        for (short, d), ts in sorted(groups.items()):
            rid = '%s_%s' % (mode, short)
            shape = collections.Counter(trips[t][2] for t in ts).most_common(1)[0][0]
            pts = [(la, lo) for _, la, lo in sorted(shape_pts.get(shape, []))]
            idx = [i for i, (la, lo) in enumerate(pts) if inb(la, lo)]
            clip = pts[idx[0]:idx[-1] + 1] if idx else []
            # 沿线取点匹配路段
            hits, seq, offnet = collections.Counter(), [], 0.0
            xy = [P.xy(la, lo) for la, lo in clip]
            for (x1, y1), (x2, y2) in zip(xy, xy[1:]):
                L = math.hypot(x2 - x1, y2 - y1)
                if L == 0:
                    continue
                b = bearing(x1, y1, x2, y2)
                k = max(1, int(L // SAMPLE_M))
                for j in range(k):
                    f = (j + 0.5) / k
                    lid = nearest_link(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f, b)
                    if lid is None:
                        offnet += L / k
                    else:
                        hits[lid] += 1
                        if not seq or seq[-1] != lid:
                            seq.append(lid)
            links = [x for x in seq if hits[x] >= 2]
            links = [x for i, x in enumerate(links) if i == 0 or links[i - 1] != x]

            def along(sid):  # 站点在走向上的位置（最近的走向点下标），用来给站点排序
                sx, sy = P.xy(*stops[sid][1:])
                return min(range(len(xy)), key=lambda i: math.hypot(sx - xy[i][0], sy - xy[i][1])) if xy else 0
            ts_stops = sorted({sid for sid, rs in served.items() if (short, d) in rs}, key=along)
            trips_h = {k: [0] * 24 for k in ('wd', 'we')}
            for t in ts:
                for k in trips[t][4]:
                    trips_h[k][hour_of(first[t][1])] += 1
            sid_out = ['s%s_%s' % (mode[0], x) for x in ts_stops]
            for x in sid_out:
                stop_routes[x].add(rid)
            by_route[rid].append({
                'dir': int(d) if str(d).isdigit() else 0,
                'headsign': collections.Counter(trips[t][3] for t in ts).most_common(1)[0][0],
                'links': links, 'offnet_m': round(offnet), 'stops': sid_out, 'trips': trips_h,
                'geometry': [[round(la, 5), round(lo, 5)] for la, lo in LineString([(lo, la) for la, lo in clip]).simplify(0.00003).coords]
                if len(clip) >= 2 else [[round(la, 5), round(lo, 5)] for la, lo in clip],
            })
        for rid, dirs in sorted(by_route.items()):
            routes.append({'id': rid, 'mode': mode, 'short': rid.split('_', 1)[1], 'dirs': dirs})
        for sid, (name, la, lo) in stops.items():
            oid = 's%s_%s' % (mode[0], sid)
            if oid in stop_routes:
                x, y = P.xy(la, lo)
                stops_out[oid] = {'id': oid, 'name': name, 'lat': round(la, 6), 'lon': round(lo, 6), 'mode': mode,
                                  'road_link': nearest_link(x, y, None, ROAD_LINK_M), 'routes': sorted(stop_routes[oid])}
        print('·  %s：线路 %d、站点 %d' % (mode, len(by_route), sum(1 for v in stops_out.values() if v['mode'] == mode)), flush=True)

    total = sum(dd['offnet_m'] for r in routes for dd in r['dirs'])
    on_len = sum(link_len[x] for r in routes for dd in r['dirs'] for x in dd['links'])
    out = {
        'version': 1,
        'sources': ['PTV GTFS Schedule (DataVic, CC BY 4.0)，子包 3（电车）、4（市区巴士）'],
        'service_dates': {'wd': a.wd, 'we': a.we},
        'assumptions': {'sample_m': SAMPLE_M, 'match_m': MATCH_M, 'max_angle_deg': MAX_ANGLE, 'stop_road_link_m': ROAD_LINK_M,
                        'trips_hour': '车次进 bbox 后第一站的出发小时'},
        'routes': routes,
        'stops': sorted(stops_out.values(), key=lambda x: x['id']),
        'coverage': {'routes': len(routes), 'stops': len(stops_out),
                     'matched_len_pct': round(100 * on_len / max(1.0, on_len + total), 1)},
    }
    p = os.path.join(MOD, 'public', a.area, 'transit.json')
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('✅ transit.json：线路 %d（电车 %d、巴士 %d）、站点 %d；对上路网的长度 %.1f%%；%d KB'
          % (len(routes), sum(r['mode'] == 'tram' for r in routes), sum(r['mode'] == 'bus' for r in routes),
             len(stops_out), out['coverage']['matched_len_pct'], os.path.getsize(p) // 1024))


if __name__ == '__main__':
    main()
