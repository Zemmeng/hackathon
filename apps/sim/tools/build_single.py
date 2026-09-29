#!/usr/bin/env python3
"""用途：把 public/ 下的 index.html + style.css + js/sim.js + js/ui.js + 数据拼成一个自包含的 HTML，
      用来发成手机能直接打开的网页（claude.ai Artifact 只收单文件，不能 fetch 数据）。

用法：python3 apps/sim/tools/build_single.py [输出路径，默认 out/sim-single.html]
退出码：0 成功；1 拼接时找不到约定的锚点（index.html / ui.js 的结构改了，照报错改这里）
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, '..', 'public')


def read(*p):
    return open(os.path.join(PUB, *p), encoding='utf-8').read()


def die(msg):
    print('❌ ' + msg); sys.exit(1)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'out/sim-single.html'
    html, css = read('index.html'), read('style.css')
    sim, ui = read('js', 'sim.js'), read('js', 'ui.js')
    data = json.dumps(json.loads(read('demand', 'demand_2921.json')), separators=(',', ':'))

    sim = re.sub(r'\nexport \{[^}]*\};\s*$', '\n', sim)
    ui, n1 = re.subn(r"^import \{[^}]*\} from './sim\.js\?v=\d+';\n", '', ui, flags=re.M)
    ui, n2 = re.subn(r"^const DATA = await fetch\(.*\n", 'const DATA = %s;\n' % data, ui, flags=re.M)
    if not (n1 and n2):
        die('ui.js 里找不到 import 行或 const DATA = await fetch(...) 行')
    head = re.search(r'<head>\n(.*?)</head>', html, re.S)
    body = re.search(r'<body>\n(.*?)</body>', html, re.S)
    if not (head and body):
        die('index.html 里找不到 <head> 或 <body>')
    head_keep = '\n'.join(l for l in head.group(1).split('\n')
                          if not re.search(r'<meta |style\.css|js/ui\.js', l))
    page = '%s\n<style>\n%s</style>\n%s\n<script type="module">\n%s\n%s</script>\n' % (head_keep.strip(), css, body.group(1).strip(), sim, ui)
    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    open(out, 'w', encoding='utf-8').write(page)
    print('✅ 写出 %s（%d KB）' % (out, len(page) // 1024))


if __name__ == '__main__':
    main()
