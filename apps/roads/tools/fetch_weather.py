#!/usr/bin/env python3
"""用途：拉墨尔本 CBD 逐小时历史天气（Open-Meteo archive，ecmwf_ifs）→ public/<area>/weather_hourly.json（T31）。

用法：python3 apps/roads/tools/fetch_weather.py [--from 2026-08-01 --to 2026-09-27] [--area cbd]
      不给 --from / --to 时，按 raw/ 里的交通数据（SCATS cbd_VSDATA_*.csv、行人 peds.csv）最早到最晚那天拉，
      保证天气覆盖每一个有交通数据的日子；交通数据的覆盖情况记进输出的 traffic_days
退出码：0 成功；1 请求失败或小时数对不上
依赖：只用 Python 标准库。免费、不要 key。
数据许可证：CC BY 4.0，署名「Weather data by Open-Meteo.com」（https://open-meteo.com/）。
坑（09-30 实测）：
  - 一定要带 models=ecmwf_ifs：默认模型的能见度全是 null
  - 返回的格点是 -37.786, 144.940，在 CBD 西北约 3 km，不是请求的坐标
  - 时间是本地时间、不带时区；这个窗口全是 UTC+10（夏令时 10-04 才开始）
  - 降水在时间 T 的值是 T 之前那一小时的（Open-Meteo 文档；对到 SCATS 小时时见 backtest_weather.py）
"""
import argparse, csv, datetime, glob, json, os, re, sys, urllib.parse, urllib.request

MOD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = 'https://archive-api.open-meteo.com/v1/archive'
LAT, LON = -37.8136, 144.9631   # Melbourne CBD（请求坐标；返回的格点见输出 grid）
VARS = ['precipitation', 'rain', 'temperature_2m', 'wind_speed_10m', 'wind_gusts_10m', 'weather_code', 'visibility']


def traffic_days(raw):
    """→ {'scats': [日期...], 'peds': [日期...]}，从 raw/ 里实际下到的文件读"""
    scats = sorted('%s-%s-%s' % (m[:4], m[4:6], m[6:]) for m in
                   (re.search(r'(\d{8})', os.path.basename(p)).group(1) for p in glob.glob(os.path.join(raw, 'cbd_VSDATA_*.csv'))))
    peds = set()
    pp = os.path.join(raw, 'peds.csv')
    if os.path.exists(pp):
        peds = {r['sensing_date'][:10] for r in csv.DictReader(open(pp, encoding='utf-8-sig'), delimiter=';')}
    return {'scats': scats, 'peds': sorted(peds)}


def gaps(days):
    if not days:
        return []
    d0, d1 = datetime.date.fromisoformat(days[0]), datetime.date.fromisoformat(days[-1])
    have = set(days)
    return [(d0 + datetime.timedelta(i)).isoformat() for i in range((d1 - d0).days + 1) if (d0 + datetime.timedelta(i)).isoformat() not in have]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--from', dest='d_from', help='默认：交通数据最早那天')
    ap.add_argument('--to', dest='d_to', help='默认：交通数据最晚那天')
    ap.add_argument('--area', default='cbd')
    ap.add_argument('--raw', default=os.path.join(MOD, 'raw'))
    a = ap.parse_args()
    td = traffic_days(a.raw)
    alld = sorted(set(td['scats']) | set(td['peds']))
    if not (a.d_from and a.d_to):
        if not alld:
            print('❌ raw/ 里没有交通数据，给 --from / --to，或先跑 fetch_scats.py --range'); sys.exit(1)
        a.d_from, a.d_to = a.d_from or alld[0], a.d_to or alld[-1]
        print('·  按交通数据定窗口：%s .. %s（SCATS %d 天、行人 %d 天）' % (a.d_from, a.d_to, len(td['scats']), len(td['peds'])))
    q = {'latitude': LAT, 'longitude': LON, 'start_date': a.d_from, 'end_date': a.d_to, 'hourly': ','.join(VARS),
         'timezone': 'Australia/Melbourne', 'models': 'ecmwf_ifs'}
    url = API + '?' + urllib.parse.urlencode(q)
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            d = json.load(r)
    except Exception as ex:
        print('❌ Open-Meteo 请求失败：%s' % ex); sys.exit(1)
    h = d['hourly']
    days = (datetime.date.fromisoformat(a.d_to) - datetime.date.fromisoformat(a.d_from)).days + 1
    if len(h['time']) != days * 24:
        print('❌ 小时数 %d ≠ %d 天 × 24（跨夏令时切换日？）' % (len(h['time']), days)); sys.exit(1)
    nulls = {v: sum(1 for x in h[v] if x is None) for v in VARS}
    out = {
        'version': 1,
        'window': [a.d_from, a.d_to],
        'source': 'Open-Meteo Historical Weather API, model ecmwf_ifs',
        'licence': 'CC BY 4.0',
        'attribution': 'Weather data by Open-Meteo.com (https://open-meteo.com/)',
        'request': {'latitude': LAT, 'longitude': LON, 'url': url},
        'grid': {'latitude': d['latitude'], 'longitude': d['longitude'], 'elevation_m': d.get('elevation')},
        'timezone': d['timezone'], 'utc_offset_s': d['utc_offset_seconds'],
        'units': {v: d['hourly_units'][v] for v in VARS},
        'notes': ['time 是本地时间、不带时区', 'precipitation / rain 在时间 T 的值是 T 之前那一小时的（Open-Meteo 文档）',
                  '格点在 CBD 西北约 3 km；雨点时间对不准，雨天要拿 BoM 逐日雨量核'],
        'nulls': nulls,
        'traffic_days': {  # 拉天气时 raw/ 里实际有的交通数据
            'scats': {'from': td['scats'][0] if td['scats'] else None, 'to': td['scats'][-1] if td['scats'] else None,
                      'n_days': len(td['scats']), 'missing': gaps(td['scats'])},
            'peds': {'from': td['peds'][0] if td['peds'] else None, 'to': td['peds'][-1] if td['peds'] else None,
                     'n_days': len(td['peds']), 'missing': gaps(td['peds'])},
            'not_covered_by_weather': [d for d in alld if not (a.d_from <= d <= a.d_to)],
        },
        'hourly': {'time': h['time'], **{v: h[v] for v in VARS}},
    }
    d_out = os.path.join(MOD, 'public', a.area)
    os.makedirs(d_out, exist_ok=True)
    p = os.path.join(d_out, 'weather_hourly.json')
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    wet = sum(1 for x in h['precipitation'] if x is not None and x >= 0.1)
    rain = sum(1 for x in h['precipitation'] if x is not None and x >= 1)
    print('✅ weather_hourly.json：%d 小时（%d 天），格点 %.4f, %.4f；降水 ≥ 0.1 mm/h 的 %d 小时、≥ 1 mm/h 的 %d 小时；缺值 %s；%d KB'
          % (len(h['time']), days, d['latitude'], d['longitude'], wet, rain, {k: v for k, v in nulls.items() if v}, os.path.getsize(p) // 1024))


if __name__ == '__main__':
    main()
