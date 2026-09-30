#!/usr/bin/env python3
"""用途：CBD 的真实 OSM 矢量底图 → public/<area>/vectormap.json（水域、绿地、用地、铁路，给网页 CITY 层当底图）。

用法：
  python3 apps/roads/tools/fetch_vectormap.py [--bbox S,W,N,E] [--area cbd] [--zoom 14] [--refresh]
      从 OpenFreeMap 公共实例的 OpenMapTiles 矢量瓦片（.pbf，免 key，无请求上限）拉一圈瓦片，
      解码成 lat/lon 存本地 —— 网页运行时只取同源的这一个文件，不连任何外部服务器
      tile_source 跟着它返回的 TileJSON 走，不写死快照日期（快照每周换）
前置：无（只用标准库，不需要 apps/roads/.venv）
退出码：0 成功；1 瓦片源连不上 / TileJSON 里没有 tiles
依赖：无
数据许可证：ODbL（OpenStreetMap）+ CC BY 4.0（OpenMapTiles schema），页面要写「© OpenStreetMap contributors」
坑：MVT 是自己解的最小实现（protobuf wire format），只认 Layer / Feature / Value 那几号字段，
    不支持 extension、不保证对任意瓦片都对；只用于本项目这一圈瓦片
    瓦片整块落盘到 raw/vectormap_tiles/，重跑不重下（--refresh 强制重下）
"""
import argparse, json, math, os, struct, sys, time, urllib.error, urllib.request

MOD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_BBOX = (-37.8235, 144.9480, -37.8060, 144.9760)  # 和 network.json / buildings.json 同一个 bbox
# 默认源：OpenFreeMap 公共实例（openfreemap.org）。它给的是 TileJSON，tiles[0] 才是当期快照的瓦片模板
DEFAULT_SOURCE = 'https://tiles.openfreemap.org/planet'
UA = 'hackathon-roads/1.0 (vector basemap)'
TIMEOUT_S = 60
PAUSE_S = 0.4            # 每个瓦片之间停一下，别把公共实例当 CDN 压
MIN_AREA_M2 = 200.0      # 比这小的面丢掉（z14 的泛化已经滤过一遍，这里再滤一次零碎）
ROUND = 6                # 经纬度小数位：1e-6° ≈ 0.11 m，CITY 层 1 px ≈ 0.6 m

# OpenMapTiles 的图层 / class → 本项目的一小组 kind（网页 VEC 调色板按 kind 上色）
POLY_KIND = {
    'water': {'': 'water'},
    'aeroway': {'': 'aeroway'},
    'landcover': {'wood': 'wood', 'grass': 'grass', 'farmland': 'grass', 'wetland': 'wetland',
                  'ice': 'ice', 'sand': 'sand', 'rock': 'sand'},
    'park': {'': 'park'},
    'landuse': {'park': 'park', 'garden': 'park', 'playground': 'park', 'zoo': 'park', 'cemetery': 'park',
                'pitch': 'sport', 'track': 'sport',
                'school': 'civic', 'university': 'civic', 'college': 'civic', 'hospital': 'civic',
                'residential': 'urban', 'commercial': 'urban', 'retail': 'urban', 'industrial': 'urban',
                'railway': 'urban', 'garages': 'urban', 'bus_station': 'urban', 'quarry': 'urban',
                'landfill': 'urban', 'military': 'urban'},
}
LINE_KIND = {'waterway': {'': 'waterway'}, 'transportation': {'rail': 'rail', 'transit': 'transit'}}
KINDS = ['water', 'aeroway', 'wood', 'grass', 'wetland', 'ice', 'sand', 'park', 'sport', 'civic', 'urban']


# ---------- protobuf / MVT ----------

def varint(buf, i):
    r = 0; s = 0
    while True:
        b = buf[i]; i += 1
        r |= (b & 0x7F) << s
        if not b & 0x80:
            return r, i
        s += 7


def fields(buf):
    """→ (field_no, value)；varint 给 int，length-delimited 给 bytes"""
    i, n = 0, len(buf)
    while i < n:
        key, i = varint(buf, i)
        fn, wt = key >> 3, key & 7
        if wt == 0:
            v, i = varint(buf, i)
        elif wt == 2:
            ln, i = varint(buf, i)
            v = buf[i:i + ln]; i += ln
        elif wt == 5:
            v = buf[i:i + 4]; i += 4
        elif wt == 1:
            v = buf[i:i + 8]; i += 8
        else:
            raise ValueError('wire type %d' % wt)
        yield fn, v


def packed(buf):
    i, out = 0, []
    while i < len(buf):
        v, i = varint(buf, i)
        out.append(v)
    return out


def zz(v):
    return (v >> 1) ^ -(v & 1)


def value_of(buf):
    for fn, v in fields(buf):
        if fn == 1:
            return v.decode('utf-8', 'replace')
        if fn == 2:
            return struct.unpack('<f', v)[0]
        if fn == 3:
            return struct.unpack('<d', v)[0]
        if fn in (4, 5):
            return v
        if fn == 6:
            return zz(v)
        if fn == 7:
            return bool(v)
    return None


def parse_tile(data):
    """→ [(layer_name, extent, [(tags, gtype, rings)])]；gtype 1=点 2=线 3=面
    rings 对线是 [[点…]]，对面是 [[环…]]（第 0 个是外环，其余是洞，绕向和 MVT 里一致）"""
    out = []
    for fn, layer in fields(data):
        if fn != 3:
            continue
        name, extent, keys, vals, feats = '', 4096, [], [], []
        for lf, lv in fields(layer):
            if lf == 1:
                name = lv.decode('utf-8', 'replace')
            elif lf == 2:
                feats.append(lv)
            elif lf == 3:
                keys.append(lv.decode('utf-8', 'replace'))
            elif lf == 4:
                vals.append(value_of(lv))
            elif lf == 5:
                extent = lv
        feats_out = []
        for f in feats:
            tags, gtype, geom = {}, 0, []
            for ff, fv in fields(f):
                if ff == 2:
                    t = packed(fv)
                    tags = {keys[t[i]]: vals[t[i + 1]] for i in range(0, len(t) - 1, 2)}
                elif ff == 3:
                    gtype = fv
                elif ff == 4:
                    geom = packed(fv)
            feats_out.append((tags, gtype, cursor_to_rings(geom)))
        out.append((name, extent, feats_out))
    return out


def cursor_to_rings(cmds):
    """MVT 游标几何 → [[点…]]：一次 MoveTo 起一段（面里就是新环），ClosePath 收尾"""
    rings, ring, x, y = [], None, 0, 0
    i = 0
    while i < len(cmds):
        cid, cnt = cmds[i] & 7, cmds[i] >> 3
        i += 1
        if cid == 1:                      # MoveTo
            for _ in range(cnt):
                x += zz(cmds[i]); y += zz(cmds[i + 1]); i += 2
                if ring:
                    rings.append(ring)
                ring = [(x, y)]
        elif cid == 2:                    # LineTo
            for _ in range(cnt):
                x += zz(cmds[i]); y += zz(cmds[i + 1]); i += 2
                if ring is None:
                    ring = [(x, y)]
                else:
                    ring.append((x, y))
        elif cid == 7:                    # ClosePath
            if ring:
                rings.append(ring)
                ring = None
        else:
            raise ValueError('geometry command %d' % cid)
    if ring:
        rings.append(ring)
    return rings


# ---------- 瓦片 → 经纬度 ----------

def lonlat(z, tx, ty, px, py, extent):
    n = 2 ** z
    lon = (tx + px / extent) / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + py / extent) / n))))
    return lat, lon


def tile_range(bbox, z):
    s, w, n, e = bbox
    m = 2 ** z

    def xt(lon):
        return (lon + 180.0) / 360.0 * m

    def yt(lat):
        r = math.radians(lat)
        return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * m

    return (int(xt(w)), int(xt(e)), int(yt(n)), int(yt(s)))  # x0, x1, y0, y1（含）


def area_m2(ring, lat0):
    """等距圆柱近似：够用来筛掉零碎面，不追求精确"""
    k = 111320 * math.cos(math.radians(lat0))
    a = 0.0
    for i in range(len(ring)):
        la0, lo0 = ring[i]
        la1, lo1 = ring[(i + 1) % len(ring)]
        a += (lo0 * k) * (la1 * 111320) - (lo1 * k) * (la0 * 111320)
    return abs(a) / 2


def ring_bbox(ring):
    la = [p[0] for p in ring]; lo = [p[1] for p in ring]
    return min(la), min(lo), max(la), max(lo)


def hits(ring, s, w, n, e):
    s0, w0, n0, e0 = ring_bbox(ring)
    return not (n0 < s or s0 > n or e0 < w or w0 > e)


def round_ring(ring):
    """去重（round 后相邻重复点）、去退化环；够不成环的返回 None"""
    out = []
    for la, lo in ring:
        p = (round(la, ROUND), round(lo, ROUND))
        if not out or out[-1] != p:
            out.append(p)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out if len(out) >= 3 else None


def round_line(pts):
    out = []
    for la, lo in pts:
        p = (round(la, ROUND), round(lo, ROUND))
        if not out or out[-1] != p:
            out.append(p)
    return out if len(out) >= 2 else None


# ---------- 主流程 ----------

def get(url, timeout=TIMEOUT_S):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def tile_template(source):
    doc = json.loads(get(source).decode('utf-8'))
    tiles = doc.get('tiles') or []
    if not tiles:
        print('❌ %s 返回的 TileJSON 里没有 tiles' % source)
        sys.exit(1)
    return tiles[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bbox', default=None, help='S,W,N,E，默认和 network.json 一致')
    ap.add_argument('--area', default='cbd')
    ap.add_argument('--zoom', type=int, default=14)
    ap.add_argument('--source', default=DEFAULT_SOURCE, help='TileJSON 地址（默认 OpenFreeMap 公共实例）')
    ap.add_argument('--out', default=os.path.join(MOD, 'raw'))
    ap.add_argument('--refresh', action='store_true', help='重下瓦片（默认用 raw/vectormap_tiles/ 里的）')
    a = ap.parse_args()
    bbox = tuple(float(x) for x in a.bbox.split(',')) if a.bbox else DEFAULT_BBOX
    s, w, n, e = bbox

    tmpl = tile_template(a.source)
    print('·  源 %s' % tmpl)
    tiles = {}
    for z in (a.zoom,):
        x0, x1, y0, y1 = tile_range(bbox, z)
        print('·  zoom %d：x %d–%d，y %d–%d（%d 块）' % (z, x0, x1, y0, y1, (x1 - x0 + 1) * (y1 - y0 + 1)))
        for tx in range(x0, x1 + 1):
            for ty in range(y0, y1 + 1):
                cache = os.path.join(a.out, 'vectormap_tiles', str(z), str(tx), '%d.pbf' % ty)
                if a.refresh or not os.path.exists(cache):
                    url = tmpl.replace('{z}', str(z)).replace('{x}', str(tx)).replace('{y}', str(ty))
                    os.makedirs(os.path.dirname(cache), exist_ok=True)
                    try:
                        blob = get(url)
                    except urllib.error.HTTPError as ex:
                        print('❌ %s → HTTP %s' % (url, ex.code)); sys.exit(1)
                    except Exception as ex:
                        print('❌ %s → %s' % (url, str(ex)[:120])); sys.exit(1)
                    open(cache, 'wb').write(blob)
                    time.sleep(PAUSE_S)
                tiles[(z, tx, ty)] = open(cache, 'rb').read()

    polys, lines, seen = {}, {}, {}
    for (z, tx, ty), blob in tiles.items():
        for lname, extent, feats in parse_tile(blob):
            lt = LINE_KIND.get(lname)
            pk = POLY_KIND.get(lname)
            if not (lt or pk):
                continue
            for tags, gtype, rings in feats:
                if tags.get('brunnel') == 'tunnel':
                    continue
                cls = str(tags.get('class') or '')
                if gtype == 3 and pk is not None:
                    kind = pk.get(cls) or pk.get('')
                    if not kind:
                        continue
                    keep = []
                    for ring in rings:
                        q = [(lonlat(z, tx, ty, px, py, extent)) for px, py in ring]
                        q = round_ring(q)
                        if q and hits(q, s, w, n, e) and area_m2(q, q[0][0]) >= MIN_AREA_M2:
                            keep.append(q)
                    if not keep:
                        continue
                    key = (kind, tuple(tuple(r) for r in keep))
                    if key in seen:
                        continue
                    seen[key] = 1
                    polys.setdefault(kind, []).append([[list(p) for p in r] for r in keep])
                elif gtype == 2 and lt is not None:
                    kind = lt.get(cls) or lt.get('')
                    if not kind:
                        continue
                    for ring in rings:
                        q = round_line([lonlat(z, tx, ty, px, py, extent) for px, py in ring])
                        if not q or not hits(q, s, w, n, e):
                            continue
                        key = (kind, tuple(q))
                        if key in seen:
                            continue
                        seen[key] = 1
                        lines.setdefault(kind, []).append([list(p) for p in q])

    # kind 固定顺序输出，重跑 diff 干净
    doc = {
        'version': 1,
        'area': a.area,
        'bbox': [s, w, n, e],
        'generated': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
        'zoom': a.zoom,
        'tile_source': tmpl,
        'sources': ['© OpenStreetMap contributors (ODbL)',
                    'OpenMapTiles map data schema, CC BY 4.0'],
        'assumptions': {'round': ROUND, 'min_area_m2': MIN_AREA_M2, 'tunnel': 'dropped',
                        'note': '经纬度坐标，网页用 6-engine.js 的 geoToWorld 换到页面坐标；'
                                '道路和建筑不在这个文件里（见 network.json / buildings.json）'},
        'polygons': [{'kind': k, 'polys': polys[k]} for k in KINDS if k in polys],
        'lines': [{'kind': k, 'pts': lines[k]} for k in ('waterway', 'rail', 'transit') if k in lines],
    }
    out_dir = os.path.join(MOD, 'public', a.area)
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, 'vectormap.json')
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    npoly = sum(len(p['polys']) for p in doc['polygons'])
    nrings = sum(len(poly) for p in doc['polygons'] for poly in p['polys'])
    npts = sum(len(r) for p in doc['polygons'] for poly in p['polys'] for r in poly)
    nlines = sum(len(l['pts']) for l in doc['lines'])
    print('·  %s：%.0f KB，%d 个面 / %d 环 / %d 点，%d 条线' % (
        os.path.relpath(out, MOD), os.path.getsize(out) / 1024, npoly, nrings, npts, nlines))
    for p in doc['polygons']:
        s_ = sum(len(r) for poly in p['polys'] for r in poly)
        print('     %-8s 面 %d / 点 %d' % (p['kind'], len(p['polys']), s_))
    for l in doc['lines']:
        print('     %-8s 线 %d / 点 %d' % (l['kind'], len(l['pts']), sum(len(q) for q in l['pts'])))


if __name__ == '__main__':
    main()
