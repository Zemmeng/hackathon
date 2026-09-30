// hackathon-sumo（T37，D-0930-1700）：现场 SUMO = 这个 Worker + 一个 Cloudflare Container（apps/sumo/Dockerfile，跑 apps/web/tools/sumo/serve.py）。
// 只由 site 经服务绑定 SUMO 转来 /api/sumo/v1/*（workers_dev 关着，没有自己的公网地址）；白名单、删头、限流、忙闸、错误码都在 proxy.js。
// 容器只开 1 个实例（getContainer(…, 'main')）：serve.py 的任务状态在内存 + 临时盘里，多实例会查不到别的实例建的运行。
// ⚠️ 除了 default 和 SumoContainer 不许有别的 export：workerd 把每个具名导出都当入口（Durable Object 类必须具名导出，这个可以）
import { Container, getContainer } from '@cloudflare/containers';
import { handle, CONTAINER_ENV } from './proxy.js';

export class SumoContainer extends Container {
  defaultPort = 8080; // = CONTAINER_ENV.PORT = Dockerfile 的 PORT
  sleepAfter = '12h'; // 评审期间别睡：一睡临时盘清空、下次冷启动要几秒；按醒着的时间计费（README §费用）
  envVars = { ...CONTAINER_ENV };
  pingEndpoint = 'container/sumo/v1/health'; // 启动时探这个路径（任何 HTTP 响应都算端口就绪），不探 serve.py 没有的 /

  onStart() {
    console.log('SUMO 容器已启动');
  }

  onStop({ exitCode, reason } = {}) {
    console.log('SUMO 容器已停止', exitCode, reason);
  }
}

export default {
  async fetch(request, env) {
    return handle(request, env, () => getContainer(env.SUMO_CONTAINER, 'main'));
  },
};
