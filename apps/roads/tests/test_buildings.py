#!/usr/bin/env python3
"""用途：校验 public/cbd/buildings.json（T11，验收见 issue #21 第 7 节）。文件还没生成时只做骨架检查。
单独一个文件，不并进 test_roads.py：T7（PR #14）也在改 test_roads.py，分开免得两边合并冲突。
用法：python3 tests/test_buildings.py（test.sh 会自动跑）；最后一行固定「N passed, M failed」
"""
import json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CBD = os.path.join(os.path.dirname(HERE), 'public', 'cbd')
P = F = 0
USES = {'retail', 'office', 'residential', 'education', 'public', 'parking', 'hotel', 'other'}
SRCS = {'osm_height', 'osm_levels', 'com', 'default'}
FIELDS = {'id', 'name', 'use', 'height_m', 'levels', 'height_src', 'footprint', 'frontage'}
SWANSTON_LATROBE = (-37.809594, 144.963826)  # SCATS 2921


def ok(cond, msg):
    global P, F
    if cond:
        P += 1; print('✅ ' + msg)
    else:
        F += 1; print('❌ ' + msg)


def dist_m(a, b):
    k = math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * k)


p = os.path.join(CBD, 'buildings.json')
if not os.path.exists(p):
    print('·  buildings.json 还没生成，跳过它的校验')
    ok(True, '骨架：test_buildings.py 能跑')
else:
    raw = open(p, encoding='utf-8').read()
    doc = json.loads(raw)
    ok(os.path.getsize(p) <= 2 * 1024 * 1024, 'buildings.json ≤ 2 MB（%d KB）' % (os.path.getsize(p) // 1024))
    ok(isinstance(doc.get('version'), int) and 'bbox' in doc and doc.get('buildings'), 'version、bbox、buildings 都在（%d 栋）' % len(doc.get('buildings', [])))
    net_p = os.path.join(CBD, 'network.json')
    net = json.load(open(net_p, encoding='utf-8')) if os.path.exists(net_p) else None
    if net is not None:
        ok(doc['bbox'] == net['bbox'], 'bbox 和 network.json 一致')
    bs = doc.get('buildings', [])
    ids = [b['id'] for b in bs]
    ok(len(ids) == len(set(ids)) and all(re.match(r'^[wr]\d+$', i) for i in ids), 'id 唯一，且是 w / r + OSM id')
    s, w, n, e = doc['bbox']
    bad = [b['id'] for b in bs if len(b['footprint']) < 3 or not all(s <= la <= n and w <= lo <= e for la, lo in b['footprint'])]
    ok(not bad, '每栋楼 footprint ≥ 3 个点且都在 bbox 内%s' % ('（坏的 %d 栋，如 %s）' % (len(bad), bad[:3]) if bad else ''))
    bad = [b['id'] for b in bs if not (0 < b['height_m'] < 350) or b['height_src'] not in SRCS or b['use'] not in USES]
    ok(not bad, '0 < height_m < 350，height_src、use 都在枚举内%s' % ('（坏的：%s）' % bad[:5] if bad else ''))
    tall = {b['name']: b['height_m'] for b in bs if b.get('name') in ('Eureka Tower', 'Rialto Towers')}
    ok(all(h >= 200 for h in tall.values()), '常识：Eureka Tower、Rialto Towers 高度 ≥ 200 m（%s；OSM 外轮廓只标裙楼 20 m）' % tall)
    share = sum(1 for b in bs if b['height_src'] != 'default') / max(1, len(bs))
    ok(share >= 0.7, '高度来源不是 default 的占 %.0f%%（要求 ≥ 70%%）' % (share * 100))
    if net is not None:
        lk = {l['id'] for l in net['links']}
        bad = [f['link'] for b in bs for f in b['frontage'] if f['link'] not in lk]
        ok(not bad, 'frontage 的路段 id 都在 network.json 里%s' % ('（坏的：%s）' % bad[:5] if bad else ''))
    near = lambda b: min(dist_m(SWANSTON_LATROBE, tuple(q)) for q in b['footprint'])
    for want in ('State Library Victoria', 'Melbourne Central'):  # 全名精确匹配：子串会把「State Library Station」地铁站也算进来
        hit = [b['name'] for b in bs if b.get('name') == want and near(b) <= 150]
        ok(hit, '地标：Swanston × La Trobe 150 m 内按名字找得到「%s」（%s）' % (want, hit[:2]))
    # 反向断言：不能有 key / token，也不能有住户等个人信息（只允许约定的字段）
    ok(not re.search(r'(sk-[A-Za-z0-9]{16,}|api[_-]?key|secret|token|Bearer\s)', raw, re.I), '反向：文件里没有 key / token 字样')
    extra = sorted({k for b in bs for k in b} - FIELDS)
    ok(not extra and not re.search(r'addr:|phone|email|contact:|@[a-z0-9-]+\.[a-z]', raw, re.I),
       '反向：没有地址、电话、邮箱等个人信息字段%s' % ('（多出字段：%s）' % extra if extra else ''))

print('%d passed, %d failed' % (P, F))
sys.exit(1 if F else 0)
