// 测试小工具：ok() 记一条断言；t() 包住一段异步测试，抛异常算失败；done() 打「N passed, M failed」并按结果退出
let P = 0, F = 0;
export function ok(cond, msg) {
  if (cond) { P++; console.log('✅ ' + msg); } else { F++; console.log('❌ ' + msg); }
}
export async function t(name, fn) {
  try { await fn(); } catch (e) { F++; console.log(`❌ ${name} 抛异常：${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`); }
}
export function done() {
  console.log(`${P} passed, ${F} failed`);
  process.exit(F ? 1 : 0);
}
export { refCard } from '../tools/demo-cards.mjs';
