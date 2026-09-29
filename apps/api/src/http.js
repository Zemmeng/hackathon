// worker.js 和 register.js 共用的小工具：按字节限长读请求体、JSON 响应、§错误格式

// 最多读 max 字节：Content-Length 超了直接拒；否则边读边数，超了就取消流，不把整个请求体攒进内存。超限回 null
export async function readLimited(request, max) {
  const len = Number(request.headers?.get?.("content-length"));
  if (Number.isFinite(len) && len > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    // 读数只取决于请求体，但 POST 本来就不缓存；health 要看到当前版本；登记表随时会变
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// docs/contract.md §错误格式
export const fail = (status, error, msg) => json({ ok: false, error, msg }, status);
