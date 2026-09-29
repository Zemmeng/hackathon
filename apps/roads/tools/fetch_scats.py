#!/usr/bin/env python3
"""用途：从 DataVic 远程抽 SCATS 数据，不用先下完整的月包（服务器支持 HTTP Range）。

用法：
  python3 apps/roads/tools/fetch_scats.py --day 2026-09-22 [--bbox S,W,N,E] [--out raw/]
      抽一天，只留 bbox 内站点的行，存成 raw/cbd_VSDATA_20260922.csv（约 4.6 MB 下载）
  python3 apps/roads/tools/fetch_scats.py --range 2026-08-01..2026-09-27
      抽一段日期（同月只开一次 zip，已抽过的天跳过，缺的天跳过）；8 周约 270 MB、30 分钟
  python3 apps/roads/tools/fetch_scats.py --sites [--out raw/]
      下载信号灯站点表 raw/victorian_traffic_signals.csv（约 300 KB）
  python3 apps/roads/tools/fetch_scats.py --sheet 2921 [--out raw/]
      从检测器配置表的大包（约 2 GB）里只抽一个路口的配置表（PDF 或网页）
退出码：0 成功；1 找不到数据（日期不在已发布的月份、站点号不在包里等）
依赖：只用 Python 标准库。数据许可证 CC BY 4.0（维州交通与规划部）。
"""
import argparse, csv, io, json, os, sys, urllib.request, zipfile

CKAN = 'https://discover.data.vic.gov.au/api/3/action/package_show?id='
DEFAULT_BBOX = (-37.8235, 144.9480, -37.8060, 144.9760)


class HTTPRange(io.RawIOBase):
    """把远程文件当成本地可 seek 的文件读，zipfile 只会取它需要的那几段。"""

    def __init__(self, url):
        self.url, self.pos, self.fetched = url, 0, 0
        with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=60) as r:
            self.size = int(r.headers['Content-Length'])

    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def readinto(self, b):
        n = min(len(b), self.size - self.pos)
        if n <= 0:
            return 0
        req = urllib.request.Request(self.url, headers={'Range': 'bytes=%d-%d' % (self.pos, self.pos + n - 1)})
        with urllib.request.urlopen(req, timeout=120) as r:
            d = r.read()
        b[:len(d)] = d; self.pos += len(d); self.fetched += len(d)
        return len(d)


def resources(pkg):
    with urllib.request.urlopen(CKAN + pkg, timeout=60) as r:
        return json.load(r)['result']['resources']


def remote_zip(url):
    f = HTTPRange(url)
    return zipfile.ZipFile(io.BufferedReader(f, buffer_size=1 << 16)), f


def sites_csv(out):
    url = resources('victorian-traffic-signals')[0]['url']
    p = os.path.join(out, 'victorian_traffic_signals.csv')
    urllib.request.urlretrieve(url, p)
    print('✅ 站点表 → %s' % p)
    return p


def in_bbox(sites_path, bbox):
    s, w, n, e = bbox
    keep = set()
    for r in csv.DictReader(open(sites_path, encoding='utf-8-sig')):
        try:
            la, lo = float(r['LATITUDE']), float(r['LONGITUDE'])
        except ValueError:
            continue
        if s <= la <= n and w <= lo <= e:
            keep.add(r['SITE_NO'])
    return keep


def fetch_days(days, bbox, out, strict=True):
    """抽若干天；同一个月只打开一次远程 zip。已经抽过的天跳过（raw/cbd_VSDATA_<日期>.csv 存在）。"""
    import datetime
    sp = os.path.join(out, 'victorian_traffic_signals.csv')
    if not os.path.exists(sp):
        sites_csv(out)
    keep = in_bbox(sp, bbox)
    by_month = {}
    for day in days:
        by_month.setdefault(day[:7], []).append(day)
    all_res = resources('traffic-signal-volume-data')
    for ym, ds in sorted(by_month.items()):
        todo = [d for d in ds if not os.path.exists(os.path.join(out, 'cbd_VSDATA_%s.csv' % d.replace('-', '')))]
        if not todo:
            print('·  %s 的 %d 天都已抽过，跳过' % (ym, len(ds))); continue
        name = 'traffic signal volume data %s %s' % (datetime.date.fromisoformat(ds[0]).strftime('%B').lower(), ym[:4])
        res = [r for r in all_res if r['name'].lower() == name]
        if not res:
            print('❌ 找不到「%s」的月包（可能还没发布，或当年的数据是整年一个包）' % name); sys.exit(1)
        z, f = remote_zip(res[0]['url'])
        names = set(z.namelist())
        for day in todo:
            member = 'VSDATA_%s.csv' % day.replace('-', '')
            if member not in names:
                print('❌ 月包里没有 %s（官方有缺天的情况，比如 2026-08-31）' % member)
                if strict:
                    sys.exit(1)
                continue
            rd = csv.reader(io.TextIOWrapper(z.open(member), encoding='utf-8-sig'))
            p = os.path.join(out, 'cbd_' + member)
            n = 0
            with open(p + '.part', 'w', newline='') as fo:  # 先写 .part，中断不会留下半个文件
                w = csv.writer(fo); w.writerow(next(rd))
                for r in rd:
                    if r[0] in keep:
                        w.writerow(r); n += 1
            os.replace(p + '.part', p)
            print('✅ %s → %s（bbox 内 %d 个站点、%d 行；累计下载 %.1f MB）' % (member, p, len(keep), n, f.fetched / 1e6), flush=True)


def fetch_day(day, bbox, out):
    fetch_days([day], bbox, out)


def fetch_sheet(site, out):
    num = int(site)
    for r in resources('traffic-signal-configuration-data-sheets'):
        try:
            lo, hi = [int(x) for x in r['name'].rsplit(' ', 1)[-1].split('-')]
        except ValueError:
            continue
        if lo <= num <= hi:
            z, f = remote_zip(r['url'])
            hits = [m for m in z.namelist() if os.path.basename(m).split('.')[0] == str(num) or ('/%d_files/' % num) in m]
            if not hits:
                print('❌ %s 里没有站点 %s' % (r['name'], site)); sys.exit(1)
            for m in hits:
                if m.endswith('/'):
                    continue
                dst = os.path.join(out, 'sheet_' + m.replace('/', '__'))
                open(dst, 'wb').write(z.read(m))
            print('✅ 站点 %s 的配置表 %d 个文件 → %s（下载 %.1f MB）' % (site, len(hits), out, f.fetched / 1e6))
            return
    print('❌ 没有覆盖站点 %s 的配置表包' % site); sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--day'); g.add_argument('--sites', action='store_true'); g.add_argument('--sheet')
    g.add_argument('--range', help='起..止，例 2026-08-01..2026-09-27；缺的天跳过不报错')
    ap.add_argument('--bbox', default=','.join(map(str, DEFAULT_BBOX)), help='南,西,北,东')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'raw'))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    if a.sites:
        sites_csv(a.out)
    elif a.sheet:
        fetch_sheet(a.sheet, a.out)
    elif a.range:
        import datetime
        lo, hi = (datetime.date.fromisoformat(x) for x in a.range.split('..'))
        days = [(lo + datetime.timedelta(i)).isoformat() for i in range((hi - lo).days + 1)]
        fetch_days(days, tuple(float(x) for x in a.bbox.split(',')), a.out, strict=False)
    else:
        fetch_day(a.day, tuple(float(x) for x in a.bbox.split(',')), a.out)


if __name__ == '__main__':
    main()
