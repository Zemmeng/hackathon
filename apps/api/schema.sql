-- api 模块的 D1：施工清单 + 花钱保险丝计数。建表：npx wrangler d1 execute worksites --remote --file schema.sql
-- body 存整份施工方案 JSON（格式见 docs/contract.md「施工方案」）；D1 不用 KV：KV 写完别处要 60 秒以上才看得到，也没有事务
CREATE TABLE IF NOT EXISTS worksites (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 花钱保险丝：每天（UTC）真调用大模型的次数。src/app.js 用一条原子语句加计数，并发也不会超上限
CREATE TABLE IF NOT EXISTS quota (
  day TEXT PRIMARY KEY,
  n INTEGER NOT NULL
);
