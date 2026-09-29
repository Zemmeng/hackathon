// llm.js —— 大模型调用的唯一出口（只在 Worker 里跑；key 只从 env 读，绝不回显、不进日志）
// 用哪家、用谁的 key 还没定（D-0929-1333「大模型的 api 到时候再定」），所以现在只有「未接入」：
// 调用一律抛 LlmError('no_provider')，上层兜底成关键词规则。定了以后只改这个文件：
//   env.LLM_PROVIDER 选分支，env.LLM_MODEL 选模型，key 用 `wrangler secret put <变量名>` 放 Cloudflare（D-10：只有 DEPLOYER 执行）
//   callModel 的约定：入参 { system, user, schema, maxTokens, signal } → 回 { json, usage }；
//   json 必须已按 schema 解析好（用结构化输出，别自己抠文本）；失败抛 LlmError，code 用 ASCII 短码。
// 真调用前先报次数和花费、经 lead 同意（D-09）；第一次真调用后把 usage 和延迟写进 README「外部 API」节。

export class LlmError extends Error {
  constructor(code, msg) {
    super(msg || code);
    this.name = 'LlmError';
    this.code = code;
  }
}

export function providerReady(env) {
  return Boolean(env && env.LLM_PROVIDER && env.LLM_MODEL);
}

export function modelName(env) {
  return providerReady(env) ? String(env.LLM_MODEL) : '';
}

// eslint-disable-next-line no-unused-vars
export async function callModel(env, req) {
  if (!providerReady(env)) throw new LlmError('no_provider', 'LLM provider not chosen yet');
  throw new LlmError('unknown_provider', 'LLM provider is not implemented yet');
}
