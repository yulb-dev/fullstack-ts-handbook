-- 首次启动时由 postgres 镜像的 entrypoint 自动执行（仅当数据目录为空）。
-- 生产环境的 schema 变更应走迁移流程（阶段 8/9），这里只是本地可复现环境的种子。
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tasks (title, status) VALUES
  ('阅读 Docker 教程第 1 章', 'done'),
  ('为 API 写多阶段 Dockerfile', 'doing');