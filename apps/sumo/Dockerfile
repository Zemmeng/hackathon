# hackathon-sumo 的容器镜像：原生 SUMO 1.27.1 + apps/web/tools/sumo/serve.py（HTTP 接口 /sumo/v1/*）
# 构建上下文 = apps/web（wrangler.jsonc 的 image_build_context "../web"），所以下面 COPY 的路径都相对 apps/web
# 本地试构建（不推送）：docker build --platform linux/amd64 -f apps/sumo/Dockerfile apps/web
#   Cloudflare 只跑 linux/amd64；wrangler deploy 自己会加 --platform linux/amd64，Apple 芯片上靠 colima 的 Rosetta 转译
FROM python:3.12-slim

# eclipse-sumo 的 manylinux wheel 自带 FOX / xerces / proj 等，但不带 X11 / GL 客户端库和 libatomic（manylinux 白名单里的），
# slim 镜像也没有；少一个 sumo 就起不来 —— 下面的 ldd 检查会让构建直接失败，而不是等上线才发现（libatomic1 就是这么查出来的）
RUN apt-get update \
 && apt-get install -y --no-install-recommends libx11-6 libxext6 libxrender1 libgl1 libsm6 libice6 libatomic1 \
 && rm -rf /var/lib/apt/lists/*

# 运行时变量：serve.py 按 HOST / PORT 监听，结果写 SUMO_DATA_DIR，只留最新 SUMO_KEEP_RUNS 次运行
# worker.js 的 SumoContainer.envVars 每次启动会再传一遍同样的值（两边一起改）
# ALLOW_ORIGINS 故意不设：浏览器的 Origin 头在 Worker 里就删掉了，容器只收 Worker 转来的请求
# LANG=C.UTF-8：build_demo.py 读 `sumo --version` 的第一行，locale 不对会读歪
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    LANG=C.UTF-8 LC_ALL=C.UTF-8 \
    HOST=0.0.0.0 PORT=8080 SUMO_DATA_DIR=/data SUMO_KEEP_RUNS=20

WORKDIR /app
COPY tools/sumo/requirements.txt tools/sumo/requirements.txt
RUN pip install -r tools/sumo/requirements.txt

# 构建时就查：缺共享库、版本不对都让构建失败（别等部署到 Cloudflare 才报）
RUN SUMO_HOME=$(python -c 'import sumo; print(sumo.SUMO_HOME)') \
 && ! ldd "$SUMO_HOME/bin/sumo" "$SUMO_HOME/bin/netconvert" | grep 'not found' \
 && sumo --version | grep -q 'Eclipse SUMO sumo 1.27.1' \
 && netconvert --version > /dev/null

# 保持 tools/sumo 这层目录：build_demo.py 用 Path(__file__).parents[2] 当跑 `sumo --version` 的工作目录
COPY tools/sumo/build_demo.py tools/sumo/serve.py tools/sumo/smoke.py tools/sumo/

# 构建时跑一次最小的端到端（真 netconvert + sumo + 回放导出，Apple M5 上约 1 s），通过就删掉
# 参数要在公开范围内：clearance_s 600–2400（< 600 在短流量下会失败，实测）
RUN python tools/sumo/build_demo.py --scenarios closure --demand-duration-s 60 --clearance-s 600 \
      --output /tmp/check-out --work-dir /tmp/check-raw > /dev/null \
 && test -f /tmp/check-out/index.json \
 && rm -rf /tmp/check-out /tmp/check-raw

# 用 root 跑：/data 是容器自己的临时盘（睡眠 / 重启就清空），不挂卷，也就没有权限问题
RUN mkdir -p /data
EXPOSE 8080

# Cloudflare 不看 HEALTHCHECK（它用 SumoContainer.pingEndpoint 探端口）；留着给本机 docker run 用
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/sumo/v1/health' % os.environ.get('PORT','8080'), timeout=4)"

# serve.py 自己处理 SIGTERM（Cloudflare 睡眠 / 重启时发），跑着的那次让它跑完，排队的丢掉
CMD ["python", "tools/sumo/serve.py"]
