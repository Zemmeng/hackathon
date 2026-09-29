-- 施工清单（D1）。建表：npx wrangler d1 execute worksites --remote --file schema.sql
-- body 存整份施工方案 JSON（格式见 docs/contract.md「施工方案」）；D1 不用 KV：KV 写完别处要 60 秒以上才看得到，也没有事务
CREATE TABLE IF NOT EXISTS worksites (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
