#!/usr/bin/env python3
"""用途：校验 public/cbd/ 下的 network.json、flows.json、signals.json（规则见 PRD.md 第 7 节）。
文件还没生成时只做骨架检查；文件一出现，对应的校验自动生效。
用法：python3 tests/test_roads.py（test.sh 会自动跑）；最后一行固定「N passed, M failed」
"""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
MOD = os.path.dirname(HERE)
CBD = os.path.join(MOD, 'public', 'cbd')
P = F = 0


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
    with open(p, encoding='utf-8') as f:
        return json.load(f), p


def largest_scc_share(node_ids, links):
    """最大强连通分量占全部节点的比例（Kosaraju，迭代写法，避免递归太深）。"""
    fwd, rev = {n: [] for n in node_ids}, {n: [] for n in node_ids}
    for l in links:
        if l['from'] in fwd and l['to'] in fwd:
            fwd[l['from']].append(l['to']); rev[l['to']].append(l['from'])
    seen, order = set(), []
    for s in node_ids:
        if s in seen:
            continue
        stack = [(s, iter(fwd[s]))]; seen.add(s)
        while stack:
            v, it = stack[-1]
            nxt = next(it, None)
            if nxt is None:
                stack.pop(); order.append(v)
            elif nxt not in seen:
                seen.add(nxt); stack.append((nxt, iter(fwd[nxt])))
    comp, best = {}, 0
    for s in reversed(order):
        if s in comp:
            continue
        size, stack = 0, [s]; comp[s] = s
        while stack:
            v = stack.pop(); size += 1
            for u in rev[v]:
                if u not in comp:
                    comp[u] = s; stack.append(u)
        best = max(best, size)
    return best / max(1, len(node_ids))


# ---- 骨架 ----
ok(os.path.exists(os.path.join(MOD, 'PRD.md')) and os.path.exists(os.path.join(MOD, 'README.md')), 'PRD.md 和 README.md 都在')
tools = [f for f in os.listdir(os.path.join(MOD, 'tools')) if f.endswith('.py')] if os.path.isdir(os.path.join(MOD, 'tools')) else []
bad = []
for t in tools:
    src = os.path.join(MOD, 'tools', t)
    try:
        compile(open(src, encoding='utf-8').read(), src, 'exec')  # 只检查语法，不写 .pyc
    except SyntaxError as e:
        bad.append('%s 第 %s 行: %s' % (t, e.lineno, e.msg))
ok(not bad, 'tools/ 下 %d 个脚本语法都对%s' % (len(tools), ('：' + '；'.join(bad)) if bad else ''))

# ---- network.json ----
net, p = load('network.json')
link_ids = set()
if net is not None:
    ok(os.path.getsize(p) < 2 * 1024 * 1024, 'network.json 小于 2 MB（实际 %d KB）' % (os.path.getsize(p) // 1024))
    nodes, links = net.get('nodes', []), net.get('links', [])
    nid = [n.get('id') for n in nodes]; lid = [l.get('id') for l in links]
    link_ids = set(lid)
    ok(isinstance(net.get('version'), int), 'version 是整数')
    ok(len(nid) == len(set(nid)) and len(lid) == len(set(lid)) and nodes and links, '节点 %d 个、路段 %d 条，id 各自唯一' % (len(nid), len(lid)))
    ns = set(nid)
    dangling = [l['id'] for l in links if l.get('from') not in ns or l.get('to') not in ns]
    ok(not dangling, '每条路段的 from / to 都是存在的节点%s' % ('（坏的：%s）' % dangling[:5] if dangling else ''))
    badv = []
    for l in links:
        try:
            spd = l['speed_kmh']; t_expect = l['len_m'] / (spd / 3.6)
            if not (l['len_m'] > 0 and l['lanes'] >= 1 and 5 <= spd <= 110 and l['cap_vph'] > 0 and abs(l['t0_s'] - t_expect) <= 0.05 * t_expect + 0.1):
                badv.append(l['id'])
        except (KeyError, TypeError, ZeroDivisionError):
            badv.append(l.get('id'))
    ok(not badv, '路段的长度、车道、限速、通行能力、自由流时间都合理%s' % ('（有问题：%d 条，如 %s）' % (len(badv), badv[:5]) if badv else ''))
    s, w, n, e = net.get('bbox', [0, 0, 0, 0]); m = 300 / 111320.0; mlon = m / max(0.1, math.cos(math.radians((s + n) / 2)))
    outside = [x['id'] for x in nodes if not (s - m <= x['lat'] <= n + m and w - mlon <= x['lon'] <= e + mlon)]
    ok(not outside, '所有节点都在 bbox 内（外扩 300 米）%s' % ('（出界 %d 个）' % len(outside) if outside else ''))
    share = largest_scc_share(nid, links)
    ok(share >= 0.9, '路网连通：最大强连通分量占 %.0f%% 的节点（要求 ≥ 90%%）' % (share * 100))

# ---- flows.json ----
flows, p = load('flows.json')
if flows is not None:
    ok(os.path.getsize(p) < 2 * 1024 * 1024, 'flows.json 小于 2 MB（实际 %d KB）' % (os.path.getsize(p) // 1024))
    days = flows.get('days', {})
    badf = []
    for d in ('wd', 'we'):
        for k, arr in days.get(d, {}).items():
            if not (isinstance(arr, list) and len(arr) == 24 and all(isinstance(x, (int, float)) and x >= 0 for x in arr)):
                badf.append('%s/%s' % (d, k))
    ok(not badf, '每组都是 24 个非负数%s' % ('（有问题：%s）' % badf[:5] if badf else ''))
    if link_ids:
        miss = [k for k in link_ids if k not in days.get('wd', {}) or k not in days.get('we', {})]
        ok(not miss, '路网里每条路段都有工作日和周末车流%s' % ('（缺 %d 条）' % len(miss) if miss else ''))
        names = {l['id']: l.get('name') or '' for l in net['links']}
        lat = [days['wd'][k][17] for k in days.get('wd', {}) if 'la trobe' in str(names.get(k, '')).lower()]
        ok(any(100 <= v <= 2000 for v in lat), '常识：La Trobe 至少一条路段工作日 17 点在 100–2000 辆 / 小时（找到 %d 条）' % len(lat))
        # 校准：按路口估的每车道流量（site_split）不能和按车道实测的（detector_map）差出 2 倍
        meth = flows.get('method', {}); lanes = {l['id']: l['lanes'] for l in net['links']}
        per_lane = lambda m: sorted(days['wd'][k][17] / lanes[k] for k, v in meth.items() if v == m and k in lanes)
        dm, ss = per_lane('detector_map'), per_lane('site_split')
        if dm and ss:
            a, b = dm[len(dm) // 2], ss[len(ss) // 2]
            ok(0.5 <= b / max(a, 1) <= 2, '校准：site_split 每车道 17 点中位数 %d，detector_map %d，相差在 2 倍内' % (b, a))
        cap = {l['id']: l['cap_vph'] for l in net['links']}
        over = [k for k in days.get('wd', {}) if k in cap and max(days['wd'][k]) > 1.2 * cap[k]]
        ok(len(over) <= 0.05 * max(1, len(cap)), '工作日任一小时车流超过通行能力 1.2 倍的路段不超过 5%%（%d 条）' % len(over))
    cov = flows.get('coverage', {})
    ok(cov.get('links') == cov.get('measured', -1) + cov.get('estimated', -1), 'coverage：links = measured + estimated')

# ---- signals.json ----
sig, p = load('signals.json')
if sig is not None:
    sites = sig.get('sites', [])
    ids = [x.get('site') for x in sites]
    ok(len(ids) == len(set(ids)), '信号灯站点号唯一（%d 个）' % len(ids))
    if net is not None:
        ns = {n['id'] for n in net['nodes']}
        badn = [x['site'] for x in sites if x.get('node') is not None and x['node'] not in ns]
        ok(not badn, '匹配到的节点都存在%s' % ('（坏的：%s）' % badn[:5] if badn else ''))

# ---- equipment.json（PRD-2 §6.4）----
eq, p = load('equipment.json')
if eq is not None:
    ok(isinstance(eq.get('version'), int) and os.path.getsize(p) < 2 * 1024 * 1024, 'equipment.json：version 是整数、小于 2 MB')
    items = eq.get('items', [])
    ids = [x.get('id') for x in items]
    ok(items and len(ids) == len(set(ids)), '设备 %d 种，id 唯一' % len(ids))
    CAT = {'barrier', 'sign', 'vms', 'arrow_board', 'ped_signal'}
    EFF = {'close', 'route_vehicles', 'route_peds', 'warn', 'message', 'control_crossing'}
    bad = [x.get('id') for x in items if x.get('category') not in CAT or x.get('effect') not in EFF]
    ok(not bad, 'category 和 effect 都在约定取值里%s' % ('（坏的：%s）' % bad if bad else ''))
    bad = [x['id'] for x in items if x.get('category') == 'barrier' and not (x.get('unit_len_m') or 0) > 0]
    bad += [x['id'] for x in items if x.get('category') == 'vms' and not ((x.get('lines') or 0) > 0 and (x.get('chars_per_line') or 0) > 0)]
    ok(not bad, '护栏都有 unit_len_m > 0，VMS 都有 lines 和 chars_per_line%s' % ('（坏的：%s）' % bad if bad else ''))
    bad = [x['id'] for x in items if not (isinstance(x.get('qty'), (int, float)) and x['qty'] >= 0)
           or not set(x.get('assumed', [])) <= set(x)]
    ok(not bad, '每项 qty ≥ 0，assumed 里列的字段都存在%s' % ('（坏的：%s）' % bad if bad else ''))
    have = {x.get('category') for x in items}
    ok({'barrier', 'sign', 'vms', 'arrow_board', 'ped_signal'} <= have and sum(x.get('category') == 'sign' for x in items) >= 5,
       '最少清单：护栏、≥ 5 种静态标志、VMS、箭头板、行人临时信号灯都有')

# ---- transit.json（PRD-2 §6）----
tr, p = load('transit.json')
if tr is not None:
    ok(isinstance(tr.get('version'), int) and os.path.getsize(p) < 2 * 1024 * 1024, 'transit.json：version 是整数、小于 2 MB（%d KB）' % (os.path.getsize(p) // 1024))
    routes, stops = tr.get('routes', []), tr.get('stops', [])
    rids, sids = {r['id'] for r in routes}, {x['id'] for x in stops}
    ok(len(rids) == len(routes) and len(sids) == len(stops) and routes and stops, '线路 %d 条、站点 %d 个，id 各自唯一' % (len(routes), len(stops)))
    if net is not None:
        lk = {l['id']: l for l in net['links']}
        bad = [x for r in routes for d in r['dirs'] for x in d['links'] if x not in lk]
        bad += [x['road_link'] for x in stops if x.get('road_link') is not None and x['road_link'] not in lk]
        ok(not bad, '线路用到的路段、站点挂的 road_link 都在 network.json 里%s' % ('（坏的：%s）' % bad[:5] if bad else ''))
        tram_links = {x for r in routes if r['mode'] == 'tram' for d in r['dirs'] for x in d['links']}
        share = sum(lk[x]['tram'] for x in tram_links if x in lk) / max(1, len(tram_links))
        ok(share >= 0.8, '电车线路用到的路段里 %.0f%% 在 network.json 标了 tram（要求 ≥ 80%%）' % (share * 100))
        on_lt = {r['id'] for r in routes if r['mode'] == 'tram' for d in r['dirs'] for x in d['links'] if 'la trobe' in str(lk.get(x, {}).get('name') or '').lower()}
        ok(on_lt, '常识：La Trobe St 上至少挂着一条电车线路（%s）' % sorted(on_lt))
    bad = [x for r in routes for d in r['dirs'] for x in d['stops'] if x not in sids]
    bad += [r_ for x in stops for r_ in x.get('routes', []) if r_ not in rids]
    ok(not bad, '线路的站点、站点的线路互相都存在%s' % ('（坏的：%s）' % bad[:5] if bad else ''))
    bad = ['%s/%s/%s' % (r['id'], d['dir'], k) for r in routes for d in r['dirs'] for k in ('wd', 'we')
           if not (len(d['trips'].get(k, [])) == 24 and all(isinstance(v, (int, float)) and v >= 0 for v in d['trips'][k]))]
    ok(not bad, '每个方向的班次都是 24 个非负数%s' % ('（坏的：%s）' % bad[:5] if bad else ''))

print('%d passed, %d failed' % (P, F))
sys.exit(1 if F else 0)
