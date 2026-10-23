-- 第 6 章：根据真实查询与 EXPLAIN 结果添加的索引。
-- 每个索引都写明服务哪条查询；没有查询依据的索引不要加。
--
-- 生产环境的大表上建索引，请改用 create index concurrently（第 6、12 章），
-- 它不会长时间阻塞写入，但不能放在事务里执行。

-- 1) 外键引用列不会自动建索引。
--    memberships 的主键是 (org_id, user_id)，只能高效服务以 org_id 开头的条件；
--    “我加入了哪些组织”（RLS 辅助函数每次请求都会执行）按 user_id 查，需要单独的索引。
create index memberships_user_id_idx on public.memberships (user_id);

-- 2) 看板列表：某项目下未删除的任务，按创建时间倒序做游标分页。
--    where project_id = ? and deleted_at is null order by created_at desc, id desc limit 20
create index tasks_project_active_created_idx
  on public.tasks (project_id, created_at desc, id desc)
  where deleted_at is null;

-- 3) “分配给我的任务”，按截止日期排序；也服务 (org_id, assignee_id) 外键的 set null 查找。
create index tasks_assignee_due_idx on public.tasks (assignee_id, due_on);

-- 4) RLS 策略按 org_id 过滤 tasks；没有其他条件缩小范围时会用到。
create index tasks_org_id_idx on public.tasks (org_id);

-- 5) 任务详情页的评论列表，同时服务删除任务时的级联查找。
create index comments_task_created_idx on public.comments (task_id, created_at, id);

-- 6) 连接表的主键是 (task_id, label_id)；“打了某标签的任务”与删除标签时的级联需要反向索引。
create index task_labels_label_id_idx on public.task_labels (label_id);

-- 7) 任务的附件列表，以及删除任务时的外键检查。
create index attachments_task_id_idx on public.attachments (task_id);
