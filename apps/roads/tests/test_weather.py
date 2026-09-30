#!/usr/bin/env python3
"""用途：校验 public/cbd/weather_hourly.json 和 weather_backtest.json（T31，验收见 docs/arch/T31-weather-backtest-PRD.md 第 6 节）。
文件还没生成时只做骨架检查。反向断言尽量独立重算，不信回测脚本自己的分类。
用法：python3 tests/test_weather.py（test.sh 会自动跑）；最后一行固定「N passed, M failed」
"""
import datetime, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CBD = os.path.join(os.path.dirname(HERE), 'public', 'cbd')
P = F = 0
VERDICTS = {'ok', 'too_strong', 'too_weak', 'wrong_direction', 'untestable', 'no_sample'}


def ok(cond, msg):
    global P, F
    if cond:
        P += 1; print('✅ ' + msg)
    else:
        F += 1; print('❌ ' + msg)


def load(name):
    p = os.path.join(CBD, name)
    if not os.path.exists(p):
        print('·  %s 还没生成，跳过它的校验' % name)
        return None, p
    return json.load(open(p, encoding='utf-8')), p


wx, p = load('weather_hourly.json')
precip_at = {}
if wx is not None:
    ok(isinstance(wx.get('version'), int) and os.path.getsize(p) < 2 * 1024 * 1024, 'weather_hourly.json：version 是整数、小于 2 MB')
    t = wx['hourly']['time']
    d0, d1 = (datetime.date.fromisoformat(x) for x in wx['window'])
    ndays = (d1 - d0).days + 1
    ok(len(t) == ndays * 24, '小时数 = 天数 × 24（%d = %d × 24）' % (len(t), ndays))
    ok(all(re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:00$', x) for x in t), '时间是本地时间（YYYY-MM-DDTHH:00，不带时区）')
    ok(wx.get('timezone') == 'Australia/Melbourne' and wx.get('utc_offset_s') == 36000, '时区 Australia/Melbourne、UTC+10（窗口在夏令时前）')
    ok(all(len(wx['hourly'][v]) == len(t) for v in wx['hourly']), '每个变量都和时间一样长')
    ok('Open-Meteo' in wx.get('attribution', '') and wx.get('licence') == 'CC BY 4.0', '带 Open-Meteo 署名和 CC BY 4.0')
    precip_at = dict(zip(t, wx['hourly']['precipitation']))
    td = wx.get('traffic_days')
    ok(td is not None and not td['not_covered_by_weather']
       and td['scats']['from'] >= wx['window'][0] and td['scats']['to'] <= wx['window'][1]
       and td['peds']['from'] >= wx['window'][0] and td['peds']['to'] <= wx['window'][1],
       '天气窗口覆盖所有交通数据的日子（SCATS %s..%s、行人 %s..%s）' % (
           (td or {}).get('scats', {}).get('from'), (td or {}).get('scats', {}).get('to'),
           (td or {}).get('peds', {}).get('from'), (td or {}).get('peds', {}).get('to')))

bt, p = load('weather_backtest.json')
if bt is not None:
    ok(isinstance(bt.get('version'), int) and os.path.getsize(p) < 2 * 1024 * 1024, 'weather_backtest.json：version 是整数、小于 2 MB（%d KB）' % (os.path.getsize(p) // 1024))
    au = bt['audit']
    base = set(au['baseline_hours'])
    wetset = set(au['class_hours']['wet']) | set(au['class_hours']['rain']) | set(au['class_hours']['fog'])
    ok(not (base & wetset), '反向：基线里没有任何 wet / rain / fog 小时（%d 个基线小时）' % len(base))
    if precip_at:
        # 独立重算：交通第 h 小时对 T = h+1 的降水（第 h 小时的前 2 小时同理）；基线小时这三个都必须是 0
        def p_at(d, h):
            dt = datetime.datetime.fromisoformat(d) + datetime.timedelta(hours=h)
            return precip_at.get(dt.strftime('%Y-%m-%dT%H:00'))
        bad = [x for x in base for d, h in [(x[:10], int(x[11:]))] if any((p_at(d, h + k) or 0) > 0 for k in (1, 0, -1))]
        ok(not bad, '反向：独立按 weather_hourly.json 重算，基线小时本小时和前 2 小时模型降水都是 0%s' % ('（坏的：%s）' % bad[:3] if bad else ''))
    excl = {x['date'] for x in bt['excluded_days']}
    ok({'2026-09-25', '2026-09-26'} <= excl, '剔除清单里有 09-25 公众假期和 09-26 AFL 总决赛')
    leak = [d for r in bt['results'] + bt['capacity_proxy'] for d in r.get('days', []) if d in excl]
    leak += [c['date'] for c in bt['cases'] if c['date'] in excl]
    leak += [d for d in bt['placebo']['days'] if d in excl]
    leak += [x for x in base | wetset if x[:10] in excl]
    ok(not leak, '反向：excluded_days 里的日子不出现在任何结果、通行能力、个案、安慰剂和基线里%s' % ('（漏了：%s）' % sorted(set(leak))[:3] if leak else ''))
    small = [r for r in bt['results'] + bt['capacity_proxy'] if r['n_days'] < 3 and (r['ratio'] is not None or r['ci95'] is not None)]
    ok(not small, '反向：n_days < 3 的格子 ratio 和 ci95 都是 null（没有样本就不给数）')
    inside = [r for r in bt['results'] + bt['capacity_proxy'] if r['ratio'] is not None and not (r['ci95'][0] <= r['ratio'] <= r['ci95'][1])]
    ok(not inside, '每个点估计都落在自己的 95% 区间里')
    pl = bt['placebo']
    ok(pl['ci95'] is not None and pl['ci95'][0] <= 1.0 <= pl['ci95'][1], '安慰剂（车）的 ci95 包含 1.0：%s' % pl['ci95'])
    bad = [x['mode'] for x in pl['by_mode'] if x['ci95'] is None or not (x['ci95'][0] <= 1.0 <= x['ci95'][1])]
    ok(not bad, '安慰剂每种交通方式的 ci95 都包含 1.0%s' % ('（不含的：%s）' % bad if bad else ''))
    ok(all(x['share_ci_contains_1'] >= 0.8 for x in pl.get('repeated', [])) and pl.get('repeated'),
       '安慰剂再抽 %s 次，区间含 1.0 的比例都 ≥ 80%%（%s）' % (pl['repeated'][0]['draws'] if pl.get('repeated') else 0,
                                                    {x['mode']: x['share_ci_contains_1'] for x in pl.get('repeated', [])}))
    ok(bt.get('bom_loaded') is True, '雨天拿 BoM 逐日雨量核过（raw/ 里有 IDCJDW3033 CSV）')
    rainy = [c for c in bt['cases'] if any((x or 0) >= 0.1 for x in c['rain_mm_h'])]
    ok(rainy and all(c.get('bom_daily_mm') is not None for c in rainy), '个案里每个雨天都有 bom_daily_mm')
    c19 = [c for c in bt['cases'] if c['date'] == '2026-08-19']
    ok(c19 and 'model_false_alarm' in c19[0].get('flag', ''), '08-19 早上标成模型误报')
    # BoM 雨量是前一天 9 点到当天 9 点：08-19 那行是 0 mm，只覆盖到 08-19 早上 9 点；9 点起归 08-20 那行（2.6 mm）
    ok(not [x for x in au['class_hours']['wet'] if x.startswith('2026-08-19 ') and int(x[11:]) < 9],
       '反向：08-19 早上 9 点前（BoM 0 mm 那段）不在 wet 小时里（模型误报，不当雨天用）')
    ok(all(w['verdict'] in VERDICTS for w in bt['wxp_compare']), 'wxp_compare 的 verdict 都在约定取值里')
    have = {w['wxp'] for w in bt['wxp_compare']}
    ok({'storm.rate', 'storm.T', 'flood.rate', 'fog.rate', 'heat.rate', 'wind.rate'} <= have, 'WXP 的雷暴 / 内涝 / 雾 / 高温 / 大风都有对照')

print('%d passed, %d failed' % (P, F))
sys.exit(1 if F else 0)
