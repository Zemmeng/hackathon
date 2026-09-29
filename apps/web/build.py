"""把 src/ 打包成单文件网页。

用法：python3 apps/web/build.py（任意目录都能跑）
产物：
  public/index.html     完整 HTML 文档，Cloudflare Pages / 任何静态服务器直接托管（进仓库）
  out/web-artifact.html 只有 body 级内容，给 Claude Artifact 发布用（out/ 不进仓库）
"""
import pathlib

root = pathlib.Path(__file__).resolve().parent
src = root / "src"


def bundle():
    head = (src / "head.html").read_text(encoding="utf-8")
    css = (src / "styles.css").read_text(encoding="utf-8")
    body = (src / "body.html").read_text(encoding="utf-8")
    js = "\n".join(p.read_text(encoding="utf-8") for p in sorted((src / "js").glob("*.js")))
    js = js.replace("'use strict';\n", "")
    script = "<script>\n'use strict';\n" + js + "\n</script>\n"
    style = "<style>\n" + css + "</style>\n"
    page = (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        + head + style + "</head>\n<body>\n" + body + script + "</body>\n</html>\n"
    )
    return page, head + style + body + script


if __name__ == "__main__":
    page, artifact = bundle()
    (root / "public").mkdir(exist_ok=True)
    (root / "public" / "index.html").write_text(page, encoding="utf-8", newline="\n")
    (root / "out").mkdir(exist_ok=True)
    (root / "out" / "web-artifact.html").write_text(artifact, encoding="utf-8", newline="\n")
    print(f"public/index.html {len(page.encode('utf-8'))} bytes")
