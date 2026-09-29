#!/usr/bin/env python3
"""用途：从 OpenStreetMap 拉 bbox 内的机动车路网（不简化）和电车轨道，存进 raw/，给 build_network.py 用。

用法：
  apps/roads/.venv/bin/python apps/roads/tools/fetch_osm.py [--bbox S,W,N,E] [--out raw/]
      → raw/osm_drive.graphml（原始路网，保留 lanes:forward / cycleway* 等标签）
      → raw/osm_tram.geojson（railway=tram 的线）
  apps/roads/.venv/bin/python apps/roads/tools/fetch_osm.py --walk [--overpass https://overpass.kumi.systems/api]
      → raw/osm_walk.graphml（行人路网，不简化，保留 footway / crossing 标签）
退出码：0 成功；1 Overpass 请求失败
依赖：osmnx 2.x（`python3 -m venv apps/roads/.venv && apps/roads/.venv/bin/pip install osmnx`）
数据许可证：ODbL，页面要写「© OpenStreetMap contributors」。
坑：OSMnx 2.x 的 bbox 顺序是 (西, 南, 东, 北)，和本仓库 --bbox 的 (南, 西, 北, 东) 不一样。
"""
import argparse, os, sys, warnings

warnings.filterwarnings('ignore')
import osmnx as ox

DEFAULT_BBOX = (-37.8235, 144.9480, -37.8060, 144.9760)
EXTRA_WAY_TAGS = ['lanes:forward', 'lanes:backward', 'cycleway', 'cycleway:left', 'cycleway:right',
                  'cycleway:both', 'maxspeed', 'oneway']
WALK_WAY_TAGS = ['footway', 'sidewalk', 'crossing', 'foot', 'crossing:signals']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bbox', default=','.join(map(str, DEFAULT_BBOX)), help='南,西,北,东')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'raw'))
    ap.add_argument('--walk', action='store_true', help='只拉行人路网 → raw/osm_walk.graphml（给 build_walk.py）')
    ap.add_argument('--overpass', help='换 Overpass 服务器，例 https://overpass.kumi.systems/api（主站拒连时用）')
    a = ap.parse_args()
    s, w, n, e = (float(x) for x in a.bbox.split(','))
    os.makedirs(a.out, exist_ok=True)
    ox.settings.cache_folder = os.path.join(a.out, 'osm_cache')  # 默认是当前目录的 cache/，会落到模块外
    if a.overpass:
        ox.settings.overpass_url = a.overpass
    ox.settings.useful_tags_way = sorted(set(ox.settings.useful_tags_way) | set(EXTRA_WAY_TAGS) | set(WALK_WAY_TAGS))
    ox.settings.useful_tags_node = sorted(set(ox.settings.useful_tags_node) | {'highway', 'crossing'})
    if a.walk:
        try:
            W = ox.graph_from_bbox((w, s, e, n), network_type='walk', simplify=False, retain_all=True)
        except Exception as ex:
            print('❌ Overpass 请求失败：%s（可加 --overpass 换服务器）' % ex); sys.exit(1)
        wp = os.path.join(a.out, 'osm_walk.graphml')
        ox.save_graphml(W, wp)
        print('✅ 行人路网 %d 个节点、%d 条边 → %s' % (W.number_of_nodes(), W.number_of_edges(), wp))
        return
    try:
        # 先不简化、不截最大连通块：build_network.py 自己决定怎么简化和裁剪
        G = ox.graph_from_bbox((w, s, e, n), network_type='drive', simplify=False, retain_all=True)
        trams = ox.features_from_bbox((w, s, e, n), {'railway': 'tram'})
    except Exception as ex:  # Overpass 超时 / 限流
        print('❌ Overpass 请求失败：%s' % ex); sys.exit(1)
    gp = os.path.join(a.out, 'osm_drive.graphml')
    ox.save_graphml(G, gp)
    trams = trams[trams.geometry.geom_type.isin(['LineString', 'MultiLineString'])][['geometry']]
    tp = os.path.join(a.out, 'osm_tram.geojson')
    trams.to_file(tp, driver='GeoJSON')
    print('✅ 路网 %d 个节点、%d 条有向边 → %s' % (G.number_of_nodes(), G.number_of_edges(), gp))
    print('✅ 电车轨道 %d 条线 → %s' % (len(trams), tp))


if __name__ == '__main__':
    main()
