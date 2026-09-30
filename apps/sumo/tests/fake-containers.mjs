// 测试用的假 @cloudflare/containers（真包 import 'cloudflare:workers'，node 里加载不了）
// tests/worker.test.mjs 用 node:module 的钩子把 '@cloudflare/containers' 指到这里；不是测试文件本身（不叫 *.test.mjs）
export const calls = [];

export class Container {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}

// 记下 worker.js 用什么参数取容器；binding.stub 是测试塞进去的假容器
export function getContainer(binding, name) {
  calls.push({ binding, name });
  if (!binding) throw new TypeError("Cannot read properties of undefined (reading 'idFromName')");
  return binding.stub;
}
