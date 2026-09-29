#!/usr/bin/env python3
"""用途：从原始开放数据算出路口每小时的流量画像，写成 public/demand/demand_2921.json。

用法：
  python3 apps/sim/tools/build_demand.py --scats <cbd_volume.csv> --ped <cbd_pedestrian_hourly.csv> \
      --sensors <sensor_locations.csv> [--out apps/sim/public/demand/demand_2921.json]

输入（都不进仓库，下载和裁剪方法见 apps/sim/README.md「外部 API」节）：
  --scats    DataVic Traffic Signal Volume Data 的 CSV（可以是已裁到 CBD 的子集），列 NB_SCATS_SITE, QT_INTERVAL_COUNT, NB_DETECTOR, V00..V95
  --ped      City of Melbourne Pedestrian Counting System 每小时计数 CSV，列 location_id, sensing_date, hourday, direction_1, direction_2
  --sensors  传感器位置 CSV，用来记下每个传感器 direction_1 / direction_2 的含义
输出：{scats: {键: {wd: [24 个小时均值], we: [...]}}, ped: {键: {wd: [[方向1, 方向2] × 24], we: ...}}, ped_dirs: {...}}
  wd = 周一到周五，we = 周六周日；负数（检测器故障）当缺失，不参与平均。
退出码：0 成功；1 输入里一行 2921 的数据都没有
"""
import argparse, csv, datetime, json, sys

SITE = '2921'  # Swanston St / La Trobe St
HOLIDAYS = {'2026-09-25'}  # 维州 AFL Grand Final 前的周五公众假期
DET = {  # 检测器号 → 流向（依据站点 2921 配置表第 2 页平面图、第 4 页检测器功能表）
    'car_eb': 7, 'car_wb': 5, 'car_sb_left': 3,
    'bike_nb_swanston': 1, 'bike_wb_latrobe': 4,
    'tram_sb_swanston': 11, 'tram_nb_swanston': 13, 'tram_wb_latrobe': 22,
}
PED = {'3': 'ped_swanston_west', '66': 'ped_swanston_east', '62': 'ped_latrobe_north_w', '187': 'ped_latrobe_north_e'}


def kind(date):
    return 'we' if datetime.date.fromisoformat(date).weekday() >= 5 else 'wd'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scats', required=True)
    ap.add_argument('--ped', required=True)
    ap.add_argument('--sensors', required=True)
    ap.add_argument('--out', default='apps/sim/public/demand/demand_2921.json')
    a = ap.parse_args()

    inv = {v: k for k, v in DET.items()}
    acc = {k: {'wd': [[0, 0] for _ in range(24)], 'we': [[0, 0] for _ in range(24)]} for k in DET}
    rows = 0
    for r in csv.reader(open(a.scats, encoding='utf-8-sig')):
        if r[0] != SITE or not r[2].isdigit() or int(r[2]) not in inv or r[1] in HOLIDAYS:
            continue
        rows += 1
        v = [int(x) for x in r[3:99]]
        for h in range(24):
            q = v[h * 4:h * 4 + 4]
            if all(x >= 0 for x in q):
                c = acc[inv[int(r[2])]][kind(r[1])][h]
                c[0] += sum(q); c[1] += 1
    if not rows:
        print('❌ %s 里没有站点 %s 的数据' % (a.scats, SITE)); sys.exit(1)
    out = {'scats': {k: {d: [round(s / n, 1) if n else None for s, n in acc[k][d]] for d in ('wd', 'we')} for k in acc}}

    pacc = {v: {d: [[0, 0, 0] for _ in range(24)] for d in ('wd', 'we')} for v in PED.values()}
    for r in csv.DictReader(open(a.ped, encoding='utf-8-sig')):
        if r['location_id'] not in PED or r['sensing_date'] in HOLIDAYS:
            continue
        c = pacc[PED[r['location_id']]][kind(r['sensing_date'])][int(r['hourday'])]
        c[0] += int(r['direction_1']); c[1] += int(r['direction_2']); c[2] += 1
    out['ped'] = {k: {d: [[round(x / n, 1), round(y / n, 1)] if n else None for x, y, n in pacc[k][d]] for d in ('wd', 'we')} for k in pacc}
    sensors = {s['location_id']: s for s in csv.DictReader(open(a.sensors, encoding='utf-8-sig'))}
    out['ped_dirs'] = {PED[k]: [sensors[k]['direction_1'], sensors[k]['direction_2'], sensors[k]['sensor_description']] for k in PED}
    json.dump(out, open(a.out, 'w'))
    print('✅ 写出 %s（SCATS %d 行）' % (a.out, rows))


if __name__ == '__main__':
    main()
