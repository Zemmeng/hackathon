#!/usr/bin/env python3
"""用途：把 raw/cbd_VSDATA_*.csv（SCATS 每天每检测器 96 个 15 分钟计数）整理成 public/<area>/flows.json（格式见 PRD 5.2）。

用法：
  python3 apps/roads/tools/build_flows.py [--area cbd] [--from 2026-08-01] [--to 2026-09-27]
前置：tools/build_network.py 已生成 network.json；tools/fetch_scats.py --range 已抽好 raw/cbd_VSDATA_*.csv
退出码：0 成功；1 缺 network.json 或没有任何 SCATS 文件
依赖：只用 Python 标准库。

每条路段的车流怎么来（写进 method）：
  detector_map   站点在 DETECTOR_MAP 里、进口方向对得上：直接用那几个检测器的和（依据配置表，最准）
  site_split     路段终点是有 SCATS 数据的路口：车道数 ×「这个路口有效检测器的平均每小时流量」
                 （信号灯检测器基本一条车道一个，所以「每检测器平均」≈「每车道平均」；日均 < MIN_DAILY 的检测器
                  当作行人按钮 / 坏掉的，不算）
  street_interp  同一条街上下游相邻路段的平均，沿街一路传过去
  class_default  同道路等级、已测路段的「每车道流量」中位数 × 车道数
"""
import argparse, csv, datetime, glob, json, math, os, statistics, sys

MOD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOLIDAYS = {'2026-09-25'}   # 维州公众假期（AFL 总决赛前一天）
MIN_DAILY = 300            # 检测器工作日日均低于这个数不算有效（行人按钮、坏检测器）
INTERP_ROUNDS = 30         # 沿街插值最多传多少段
# 站点 → {进口车流朝向: [检测器号]}；依据配置表第 2 页平面图（2921 的核对见 apps/sim/tools/build_demand.py 的 DET）
DETECTOR_MAP = {'2921': {'E': [7], 'W': [5], 'S': [3]}}


def kind(day):
    return 'we' if datetime.date.fromisoformat(day).weekday() >= 5 else 'wd'


def heading(geom):
    """路段最后一小段的朝向：E / N / W / S（按 45° 扇区）。"""
    (la1, lo1), (la2, lo2) = geom[-2], geom[-1]
    ang = math.degrees(math.atan2(la2 - la1, (lo2 - lo1) * math.cos(math.radians(la1)))) % 360
    return 'ENWS'[int(((ang + 45) % 360) // 90)]


def load_detectors(files, d_from, d_to):
    """→ {站点: {检测器: {'wd'|'we': [24 个每小时平均]}}}, 用到的天数"""
    acc, days = {}, {'wd': set(), 'we': set()}
    for p in files:
        for r in csv.reader(open(p, encoding='utf-8-sig')):
            if not r or not r[2].isdigit():
                continue
            day = r[1][:10]
            if not (d_from <= day <= d_to) or day in HOLIDAYS:
                continue
            k = kind(day); days[k].add(day)
            v = [int(x) for x in r[3:99]]
            slot = acc.setdefault(r[0], {}).setdefault(int(r[2]), {'wd': [[0, 0] for _ in range(24)], 'we': [[0, 0] for _ in range(24)]})[k]
            for h in range(24):
                q = v[4 * h:4 * h + 4]
                if min(q) >= 0:  # 负数 = 故障或缺失；这一小时有缺就整小时不算
                    slot[h][0] += sum(q); slot[h][1] += 1
    out = {}
    for site, dets in acc.items():
        for det, byk in dets.items():
            out.setdefault(site, {})[det] = {k: [s / n if n else None for s, n in byk[k]] for k in ('wd', 'we')}
    return out, {k: sorted(v) for k, v in days.items()}


def fill(arr):
    """某些小时全部缺数时，用相邻小时补。"""
    if all(x is None for x in arr):
        return [0.0] * 24
    out = list(arr)
    for h in range(24):
        if out[h] is None:
            for d in range(1, 24):
                cand = [x for x in (arr[(h - d) % 24], arr[(h + d) % 24]) if x is not None]
                if cand:
                    out[h] = sum(cand) / len(cand); break
    return out


def per_lane_profile(dets):
    """有效检测器的每小时平均 → {'wd': [24], 'we': [24]}；没有有效检测器返回 None。"""
    active = [d for d in dets.values() if sum(x or 0 for x in d['wd']) >= MIN_DAILY]
    if not active:
        return None
    return {k: [statistics.mean(fill(d[k])[h] for d in active) for h in range(24)] for k in ('wd', 'we')}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--area', default='cbd')
    ap.add_argument('--raw', default=os.path.join(MOD, 'raw'))
    ap.add_argument('--from', dest='d_from', default='2026-08-01')
    ap.add_argument('--to', dest='d_to', default='2026-09-27')
    a = ap.parse_args()
    np_ = os.path.join(MOD, 'public', a.area, 'network.json')
    if not os.path.exists(np_):
        print('❌ 没有 %s：先跑 tools/build_network.py' % np_); sys.exit(1)
    files = sorted(glob.glob(os.path.join(a.raw, 'cbd_VSDATA_*.csv')))
    if not files:
        print('❌ raw/ 里没有 cbd_VSDATA_*.csv：先跑 tools/fetch_scats.py --range %s..%s' % (a.d_from, a.d_to)); sys.exit(1)
    net = json.load(open(np_, encoding='utf-8'))
    links = {l['id']: l for l in net['links']}
    node_site = {n['id']: n['signal'] for n in net['nodes'] if n.get('signal')}

    dets, days = load_detectors(files, a.d_from, a.d_to)
    if not days['wd'] or not days['we']:
        print('⚠️  工作日 %d 天、周末 %d 天：缺一类时用另一类代替' % (len(days['wd']), len(days['we'])))
    for site in dets.values():
        for d in site.values():
            if not days['we']:
                d['we'] = d['wd']
            if not days['wd']:
                d['wd'] = d['we']

    flows, method = {'wd': {}, 'we': {}}, {}

    def put(lid, prof, m, scale=1.0):
        for k in ('wd', 'we'):
            flows[k][lid] = [max(0.0, x * scale) for x in prof[k]]
        method[lid] = m

    # 1) 进口路段：detector_map 或 site_split
    lane_prof = {s: per_lane_profile(d) for s, d in dets.items()}
    for lid, l in links.items():
        site = node_site.get(l['to'])
        if not site or node_site.get(l['from']) == site or site not in dets:
            continue  # 终点不是有数据的信号灯路口，或是同一个路口内部的连接段
        dm = DETECTOR_MAP.get(site, {}).get(heading(l['geometry']))
        if dm and all(d in dets[site] for d in dm):
            put(lid, {k: [sum(fill(dets[site][d][k])[h] for d in dm) for h in range(24)] for k in ('wd', 'we')}, 'detector_map')
        elif lane_prof.get(site):
            put(lid, lane_prof[site], 'site_split', l['lanes'])

    # 2) 同一条街上下游插值
    out_by, in_by = {}, {}
    for lid, l in links.items():
        out_by.setdefault(l['from'], []).append(lid); in_by.setdefault(l['to'], []).append(lid)

    def same_street(lid):
        l = links[lid]
        if not l['name']:
            return []
        nb = [x for x in out_by.get(l['to'], []) if links[x]['to'] != l['from']]
        nb += [x for x in in_by.get(l['from'], []) if links[x]['from'] != l['to']]
        return [x for x in nb if links[x]['name'] == l['name']]

    for _ in range(INTERP_ROUNDS):
        new = {}
        for lid in links:
            if lid in method:
                continue
            known = [x for x in same_street(lid) if x in method]
            if known:
                # 按每车道流量平均，再乘本段车道数
                new[lid] = {k: [statistics.mean(flows[k][x][h] / links[x]['lanes'] for x in known) * links[lid]['lanes']
                                for h in range(24)] for k in ('wd', 'we')}
        if not new:
            break
        for lid, prof in new.items():
            put(lid, prof, 'street_interp')

    # 3) 按道路等级默认
    measured = [x for x, m in method.items() if m in ('detector_map', 'site_split')]
    by_class = {}
    for x in measured:
        by_class.setdefault(links[x]['highway'], []).append(x)
    all_med = {k: [statistics.median(flows[k][x][h] / links[x]['lanes'] for x in measured) for h in range(24)] for k in ('wd', 'we')}
    for lid, l in links.items():
        if lid in method:
            continue
        pool = by_class.get(l['highway'])
        med = {k: [statistics.median(flows[k][x][h] / links[x]['lanes'] for x in pool) for h in range(24)] for k in ('wd', 'we')} if pool else all_med
        put(lid, med, 'class_default', l['lanes'])

    n_meas = sum(1 for m in method.values() if m in ('detector_map', 'site_split'))
    out = {
        'version': 1, 'unit': 'veh/h',
        'period': '%s..%s（去掉缺数的天和公众假期 %s）' % (a.d_from, a.d_to, ', '.join(sorted(HOLIDAYS))),
        'days_used': {k: len(v) for k, v in days.items()},
        'sources': ['Traffic Signal Volume Data, DTP Victoria (CC BY 4.0)'],
        'assumptions': {'min_daily_active_detector': MIN_DAILY, 'detector_map_sites': sorted(DETECTOR_MAP),
                        'site_split': 'lanes × 路口有效检测器的平均每小时流量'},
        'days': {k: {lid: [round(x) for x in flows[k][lid]] for lid in links} for k in ('wd', 'we')},
        'method': {lid: method[lid] for lid in links},
        'coverage': {'links': len(links), 'measured': n_meas, 'estimated': len(links) - n_meas},
    }
    p = os.path.join(MOD, 'public', a.area, 'flows.json')
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    cnt = {}
    for m in method.values():
        cnt[m] = cnt.get(m, 0) + 1
    print('✅ flows.json：路段 %d，%s；工作日 %d 天、周末 %d 天；%d KB'
          % (len(links), '、'.join('%s %d' % kv for kv in sorted(cnt.items())), len(days['wd']), len(days['we']), os.path.getsize(p) // 1024))


if __name__ == '__main__':
    main()
