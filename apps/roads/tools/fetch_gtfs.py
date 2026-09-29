#!/usr/bin/env python3
"""用途：从 DataVic「GTFS Schedule」总包（约 275 MB）里只抽电车和市区巴士两个子包，存到 raw/gtfs/。

用法：python3 apps/roads/tools/fetch_gtfs.py [--modes 3,4] [--out raw/gtfs]
      → raw/gtfs/3.zip（电车，约 14 MB 下载）、raw/gtfs/4.zip（市区巴士，约 87 MB 下载）；已存在就跳过
退出码：0 成功；1 找不到总包或子包
依赖：只用 Python 标准库（复用 fetch_scats.py 的 HTTP Range 读法）。数据许可证 CC BY 4.0（维州交通与规划部 / PTV）。
坑：子包在总包里是压缩存放的（deflate），只能整个子包下，不能再往里 Range。
    子包编号按 PTV 惯例（3 电车、4 市区巴士），以 routes.txt 的 route_type 为准（0 = 电车、3 = 巴士）。
"""
import argparse, os, shutil, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_scats import remote_zip, resources  # noqa: E402

MOD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--modes', default='3,4')
    ap.add_argument('--out', default=os.path.join(MOD, 'raw', 'gtfs'))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    zips = [r['url'] for r in resources('gtfs-schedule') if r['url'].lower().endswith('.zip')]
    if not zips:
        print('❌ gtfs-schedule 数据集里没有 zip'); sys.exit(1)
    z, f = remote_zip(zips[0])
    names = set(z.namelist())
    for m in a.modes.split(','):
        member, dst = '%s/google_transit.zip' % m, os.path.join(a.out, '%s.zip' % m)
        if os.path.exists(dst):
            print('·  %s 已存在，跳过' % dst); continue
        if member not in names:
            print('❌ 总包里没有 %s' % member); sys.exit(1)
        with z.open(member) as src, open(dst + '.part', 'wb') as out:
            shutil.copyfileobj(src, out, 1 << 20)
        os.replace(dst + '.part', dst)
        print('✅ %s → %s（累计下载 %.1f MB）' % (member, dst, f.fetched / 1e6), flush=True)


if __name__ == '__main__':
    main()
