#!/usr/bin/env python3
"""用途：生成 public/<area>/equipment.json —— 施工设备库存（类型、规格、在模型里起什么作用、数量和日租价）。格式见 PRD-2 §3A。

用法：python3 apps/roads/tools/build_equipment.py [--area cbd]
退出码：0 成功
依赖：只用 Python 标准库。

来源（2026-09-29 查）：
  - 规格：RPM Hire 官网产品页（每项的 url）。只记类型、规格和链接，不抄图片和大段文字
  - 标志编号：只填查实的（TfNSW 标志登记：T1-1 Roadwork Ahead、T2-16 End Roadwork）；其余 null，不猜
  - RPM 官网没有静态标志牌的产品页 → 静态标志 url 为 null，规格按 AS 1742.3 常用尺寸
  - 官网没有公开价格：qty 和 day_rate_aud 全是假设，列进每项的 assumed
"""
import argparse, json, os

MOD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RPM = 'https://www.rpmhire.com.au/products/'
CATEGORIES = ('barrier', 'sign', 'vms', 'arrow_board', 'ped_signal')
EFFECTS = ('close', 'route_vehicles', 'route_peds', 'warn', 'message', 'control_crossing')
ASSUMED = ['qty', 'day_rate_aud']

ITEMS = [
    # ---- 护栏：effect=close，围住 can_close 里的东西 ----
    {'id': 'barrier_water', 'category': 'barrier', 'name': 'Water-filled barrier (ArmorZone)',
     'effect': 'close', 'can_close': ['lane', 'footpath', 'bike_lane'], 'applies_to': ['vehicle', 'ped', 'bike'],
     'unit_len_m': 2.0, 'width_m': 0.45, 'weight_kg': {'empty': 56, 'filled': 496},
     'rating': 'MASH TL1/TL2', 'max_speed_kmh': 70, 'note': '官网：适合 50 km/h 以下道路，最高 70；表面光滑，对行人和骑车人更友好',
     'qty': 200, 'day_rate_aud': 4, 'url': RPM + 'water-filled-barriers/'},
    {'id': 'barrier_klemmfix', 'category': 'barrier', 'name': 'Klemmfix plastic guidance barrier',
     'effect': 'close', 'can_close': ['lane', 'bike_lane'], 'applies_to': ['vehicle', 'bike'],
     'unit_len_m': 1.0, 'height_m': 0.99, 'weight_kg': {'panel': 2.1, 'base': 16},
     'rating': None, 'note': '导向用塑料隔板，被撞后回弹；不是防撞护栏',
     'qty': 300, 'day_rate_aud': 2, 'url': RPM + 'klemmfix/'},
    {'id': 'barrier_steel', 'category': 'barrier', 'name': 'Steel barrier (BG800)',
     'effect': 'close', 'can_close': ['lane'], 'applies_to': ['vehicle'],
     'unit_len_m': 6.0, 'height_m': 0.8, 'weight_kg_per_m': 90,
     'rating': 'NCHRP350 TL-3/TL-4, MASH TL-3', 'max_speed_kmh': 100, 'note': '另有 12 m 一节；最小变形 13 cm',
     'qty': 40, 'day_rate_aud': 20, 'url': RPM + 'steel-barriers/'},
    # ---- 静态标志：RPM 官网无产品页 ----
    {'id': 'sign_roadwork_ahead', 'category': 'sign', 'name': 'Roadwork ahead', 'code': 'T1-1',
     'effect': 'warn', 'applies_to': ['vehicle', 'bike'], 'qty': 30, 'day_rate_aud': 5, 'url': None},
    {'id': 'sign_lane_closed_left', 'category': 'sign', 'name': 'Left lane closed', 'code': None,
     'effect': 'warn', 'applies_to': ['vehicle'], 'side': 'left', 'qty': 20, 'day_rate_aud': 5, 'url': None},
    {'id': 'sign_lane_closed_right', 'category': 'sign', 'name': 'Right lane closed', 'code': None,
     'effect': 'warn', 'applies_to': ['vehicle'], 'side': 'right', 'qty': 20, 'day_rate_aud': 5, 'url': None},
    {'id': 'sign_detour_left', 'category': 'sign', 'name': 'Detour (left)', 'code': None,
     'effect': 'route_vehicles', 'applies_to': ['vehicle'], 'dir': 'left', 'qty': 20, 'day_rate_aud': 5, 'url': None},
    {'id': 'sign_detour_right', 'category': 'sign', 'name': 'Detour (right)', 'code': None,
     'effect': 'route_vehicles', 'applies_to': ['vehicle'], 'dir': 'right', 'qty': 20, 'day_rate_aud': 5, 'url': None},
    {'id': 'sign_detour_straight', 'category': 'sign', 'name': 'Detour (straight ahead)', 'code': None,
     'effect': 'route_vehicles', 'applies_to': ['vehicle'], 'dir': 'straight', 'qty': 20, 'day_rate_aud': 5, 'url': None},
    {'id': 'sign_footpath_closed', 'category': 'sign', 'name': 'Footpath closed, use other side', 'code': None,
     'effect': 'route_peds', 'applies_to': ['ped'], 'qty': 30, 'day_rate_aud': 5, 'url': None},
    {'id': 'sign_bike_lane_closed', 'category': 'sign', 'name': 'Bike lane closed / Bicycles merge', 'code': None,
     'effect': 'warn', 'applies_to': ['bike'], 'qty': 20, 'day_rate_aud': 5, 'url': None,
     'note': '自行车并入车道；effect 表里没有「骑车人改道」，先用 warn + applies_to 区分'},
    {'id': 'sign_end_roadwork', 'category': 'sign', 'name': 'End roadwork', 'code': 'T2-16',
     'effect': 'warn', 'applies_to': ['vehicle', 'bike'], 'qty': 30, 'day_rate_aud': 5, 'url': None,
     'note': '模型里不起作用，只为清单完整；effect 占位用 warn'},
    # ---- VMS：effect=message，自由文案 ----
    # 官网同一页前后不一致（09-29 核对原文）：FAQ 写「12-13 characters per line up to 4 lines of text per screen」，
    # 文案指南写「Up to 10 characters per line (including any spaces)」「Ideally, 3 lines of text and 8 characters per line」
    # 「Generally 2 seconds for 1,2 or 3 lines of text. 3 seconds if the screen is flashing」。
    # 取 10：和 T5 的 readSigns() / /api/read 一致（超了回 400），@jinmingq 在 #14 指出
    {'id': 'vms_a', 'category': 'vms', 'name': 'Variable Message Sign (A class, trailer)',
     'effect': 'message', 'applies_to': ['vehicle', 'bike'], 'lines': 4, 'chars_per_line': 10,
     'lines_recommended': 3, 'chars_recommended': 8, 'seconds_per_screen': 2, 'seconds_per_screen_flashing': 3,
     'display_m': [1.04, 1.62], 'power': 'solar + battery',
     'note': '官网文案指南：每行最多 10 个字符（含空格）、每屏最多 4 行；最好 3 行 × 8 字；每屏停 2 秒（闪烁 3 秒）。同页 FAQ 写 12–13 字，以 10 为准',
     'qty': 4, 'day_rate_aud': 150, 'url': RPM + 'variable-message-signs/'},
    {'id': 'vms_c', 'category': 'vms', 'name': 'Variable Message Sign (C class, trailer)',
     'effect': 'message', 'applies_to': ['vehicle', 'bike'], 'lines': 4, 'chars_per_line': 10,
     'lines_recommended': 3, 'chars_recommended': 8, 'seconds_per_screen': 2, 'seconds_per_screen_flashing': 3,
     'display_m': [1.85, 2.73], 'power': 'solar + battery',
     'note': '比 A class 字大、看得远，字数规则同 A class（每行最多 10 字、最好 3 行 × 8 字）',
     'qty': 2, 'day_rate_aud': 200, 'url': RPM + 'variable-message-signs/'},
    # ---- 箭头板：指示车辆并道方向 ----
    {'id': 'arrow_board', 'category': 'arrow_board', 'name': 'Portable arrow board (trailer)',
     'effect': 'route_vehicles', 'applies_to': ['vehicle'], 'modes': ['left', 'right', 'double'],
     'panel_m': [2.4, 1.2], 'lamps': 15, 'power': 'solar + battery', 'note': '官网：VicRoads / RMS 认可',
     'qty': 4, 'day_rate_aud': 100, 'url': RPM + 'arrow-boards/'},
    # ---- 行人临时信号灯 ----
    {'id': 'ped_signal_portable', 'category': 'ped_signal', 'name': 'Pedestrian portable traffic lights',
     'effect': 'control_crossing', 'applies_to': ['ped', 'vehicle'], 'lantern_mm': 200,
     'standard': 'AS 4191:2015', 'power': 'solar + battery', 'note': '一套含主机和从机，无线联动；通讯中断时闪黄',
     'qty': 3, 'day_rate_aud': 250, 'url': RPM + 'pedestrian-portable-traffic-lights/'},
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--area', default='cbd')
    a = ap.parse_args()
    items = [dict(it, assumed=list(ASSUMED)) for it in ITEMS]
    for it in items:
        assert it['category'] in CATEGORIES and it['effect'] in EFFECTS, it['id']
    out = {
        'version': 1,
        'sources': ['RPM Hire 官网产品页（类型、规格），2026-09-29 查', 'TfNSW 标志登记（T1-1、T2-16）',
                    '数量和日租价为假设，官网没有公开价格'],
        'categories': list(CATEGORIES), 'effects': list(EFFECTS),
        'items': items,
    }
    d = os.path.join(MOD, 'public', a.area)
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, 'equipment.json')
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    by = {}
    for it in items:
        by[it['category']] = by.get(it['category'], 0) + 1
    print('✅ equipment.json：%d 种设备（%s）；%d KB' % (len(items), '、'.join('%s %d' % kv for kv in by.items()), os.path.getsize(p) // 1024))


if __name__ == '__main__':
    main()
