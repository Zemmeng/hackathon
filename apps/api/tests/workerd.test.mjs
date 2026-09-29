// 冒烟：用 wrangler 的 unstable_dev 在真的 Workers 运行时（workerd）里起 Worker，按 wrangler.jsonc 的配置跑
// 查 /api/health、/api/read、400、静态资源（reader.js、answers/demo.json）。node 直接调 fetch() 测不到的：配置、assets 绑定、打包
// 用法：cd apps/api && npm i 后 node tests/workerd.test.mjs；没装 wrangler 就跳过（CI 和没 npm i 的队友不受影响）
import { ok, eq, sec, done } from "./mini.mjs";

const here = new URL("..", import.meta.url).pathname;
let unstable_dev;
try {
  ({ unstable_dev } = await import("wrangler"));
} catch {
  console.log("⏭ 跳过：没装 wrangler（cd apps/api && npm i 以后再跑）");
}

if (unstable_dev) {
  process.chdir(here);
  const worker = await unstable_dev("src/worker.js", {
    config: "wrangler.jsonc",
    ip: "127.0.0.1",
    logLevel: "error",
    experimental: { disableExperimentalWarning: true },
  });
  const post = (body) => worker.fetch("/api/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const REQ = {
    persona: "commuter",
    kmh: 40,
    signs: [{ kind: "vms", frames: [["USE", "RUSSELL ST", "SAVE 8 MIN"]], read_s: 9 }],
    roads: ["La Trobe St", "Russell St", "Elizabeth St"],
  };
  try {
    await sec("GET /api/health（wrangler.jsonc 里 MOCK=1）", async () => {
      const r = await worker.fetch("/api/health");
      const b = await r.json();
      eq([r.status, b.ok, b.mock], [200, true, true], "200 · ok · mock");
    });

    await sec("POST /api/read", async () => {
      const r = await post(REQ);
      const b = await r.json();
      eq([r.status, b.ok, b.reading.src], [200, true, "rule"], "200 · 规则读数");
      eq([b.reading.advice, b.reading.saving_min], [{ "Russell St": "use" }, 8], "advice · saving_min");
      const bad = await post({ ...REQ, signs: [{ kind: "vms", frames: [["A", "B", "C", "D", "E"]], read_s: 6 }] });
      eq([bad.status, (await bad.json()).error], [400, "too_many_lines"], "5 行 → 400");
      const nope = await worker.fetch("/api/nope");
      eq([nope.status, (await nope.json()).error], [404, "not_found"], "未知接口 → 404 JSON");
    });

    await sec("静态资源：浏览器能拿到 reader.js 和答案文件", async () => {
      const js = await worker.fetch("/js/reader.js");
      ok(js.status === 200 && /javascript/.test(js.headers.get("content-type") || ""), "reader.js 200 且是 JS");
      ok((await js.text()).includes("export async function readSigns"), "reader.js 内容对");
      const ans = await worker.fetch("/answers/demo.json");
      eq([ans.status, typeof (await ans.json()).answers], [200, "object"], "answers/demo.json 200");
    });
  } finally {
    await worker.stop();
  }
}

done();
