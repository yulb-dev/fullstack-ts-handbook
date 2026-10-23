# 第 11 章：Storage——桶、文件权限、签名 URL 与文件生命周期

[上一章](./10-connections-and-pooling.md) · [目录](./README.md) · [下一章](./12-environments-and-deployment.md)

任务需要附件：设计稿、需求 PDF、截图。用户需要头像。本章把文件纳入 Teamboard，并重点回答四个问题：

1. 文件放公开桶还是私有桶？
2. 谁能上传、下载、删除哪些文件？
3. 需要临时分享一个私有文件时怎么办？
4. 数据库里的记录删除了，文件怎么办？

云端跟做：Storage 已经由 Supabase 运行，上传/下载通过项目 HTTPS URL 与 API key，不使用 PostgreSQL 连接串，也不需要 Docker。先在**独立教学项目**应用本章的桶和策略迁移；普通 db push 不会把本地文件上传到云端。使用第 8 章注册的用户与下文 upload/createSignedUrl 示例验证，不直接运行只接受 localhost 的 `demo:storage`。

这里的生命周期任务会硬删除任务与文件，不是通用的只读诊断。已有业务云库不能直接套用 `job:cleanup`；目标数据库、Storage URL、权限与保留期都必须另行确认。

## 11.1 Storage 的结构：文件在对象存储，元数据在 Postgres

```text
                     ┌──────────────────────────────┐
supabase.storage ──► │ Storage API                  │ ──► S3 兼容对象存储（文件本体）
                     │   以请求者身份查询/写入：      │
                     │   storage.buckets            │ ──► Postgres（元数据 + RLS 策略）
                     │   storage.objects            │
                     └──────────────────────────────┘
```

- **桶（bucket）** 是 `storage.buckets` 表里的一行：名字、是否公开、大小上限、允许的 MIME 类型。
- **对象（object）** 是 `storage.objects` 表里的一行：所属桶、路径 `name`、上传者 `owner_id`、元数据；文件内容在对象存储里。
- **访问控制** = 在 `storage.objects` 表上写 RLS 策略。你在第 9 章学到的一切在这里同样适用。

两条官方的硬性规则：

1. **把 `storage` schema 当作只读。** 上传、复制、移动、删除一律通过 Storage API。用 SQL 删除 `storage.objects` 里的行**不会删除对象存储里的文件**——文件变成孤儿，你仍然要为它付费。官方鼓励的唯一修改是：为策略用到的列**添加索引**。
2. **数据库备份不包含 Storage 中的文件**，只包含元数据。恢复一个旧备份，不会恢复备份之后删除的文件（第 13 章）。

## 11.2 公开桶与私有桶

|                        | 私有桶（默认）                                              | 公开桶                                        |
| ---------------------- | ----------------------------------------------------------- | --------------------------------------------- |
| 下载                   | 必须经过 RLS（带用户 JWT 下载），或使用**有时效的签名 URL** | **任何拿到 URL 的人都能下载**，不检查任何权限 |
| 上传、删除、移动、复制 | 受 RLS 控制                                                 | 同样受 RLS 控制                               |
| CDN 缓存               | 有                                                          | 命中率更高，性能更好                          |
| 适合                   | 用户的私密文档、合同、身份证件、任务附件                    | 头像、公开的媒体、博客配图                    |

公开桶的 URL 是可预测的：

```text
https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>/<path>
```

### 不要把公开桶当私有存储

“文件名是随机 UUID，别人猜不到，所以放公开桶也安全”——这是一个常见又危险的想法：

- URL 会出现在浏览器历史、聊天记录、邮件、日志、分析工具、`Referer` 请求头里，一旦被转发就无法收回；
- 公开桶的下载**不检查任何权限**：员工离职、成员被移出组织后，他手里的链接依然有效；
- CDN 会缓存公开文件，即使删除了原文件，缓存也可能在一段时间内继续提供内容；
- 没有办法撤销某一个链接，只能删除或移动文件本身。

**判断标准：如果这个文件泄露给陌生人你会觉得有问题，它就属于私有桶。** Teamboard 的任务附件放私有桶；头像本来就展示给所有队友，而且不含敏感信息，放公开桶。

## 11.3 创建桶

桶是 `storage.buckets` 里的**数据行**，不是结构对象，所以 `db diff` 不会捕获它（第 3 章）。在迁移中显式插入，并用 `on conflict` 保证重复执行安全：

```sql
-- 私有桶：任务附件
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-attachments', 'task-attachments', false,
  10485760,                                                    -- 10 MiB
  array['image/png', 'image/jpeg', 'application/pdf', 'text/plain']
)
on conflict (id) do nothing;

-- 公开桶：头像
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true,
  1048576,                                                     -- 1 MiB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;
```

`file_size_limit` 与 `allowed_mime_types` 是**服务端强制**的上传限制：不满足的上传请求会被直接拒绝。前端的文件类型/大小检查只是体验优化，这里才是真正的规则。项目还有一个全局上传上限（本地在 `config.toml` 的 `[storage] file_size_limit` 中设置），桶的上限不能超过它。

> 另一种做法：在 `config.toml` 中声明 `[storage.buckets.<名字>]`，配合 `supabase seed buckets` 命令创建桶并上传本地文件（官方迁移文档的示例）。本教程选择迁移，因为它在所有环境中以同一种方式执行，并且与策略放在同一个文件里审阅。

## 11.4 路径设计：让策略能判断归属

对象的“目录”只是路径中的 `/` 分隔，但它是写策略的关键。Teamboard 的约定：

```text
task-attachments/{org_id}/{task_id}/{随机 uuid}-{原文件名}
avatars/{user_id}/{文件名}
```

- **第一段是租户（组织 id 或用户 id）**：策略只需看第一段就能判断归属，与第 9 章“按组织限制”一脉相承；
- **随机前缀**：同名文件不会互相覆盖，URL 也不可预测；
- 第 4 章 `attachments` 表的 `attachments_path_in_org` 约束保证数据库里登记的路径第一段就是该行的 `org_id`。

Supabase 提供的辅助函数：

| 函数                       | 对 `a/b/c.png` 返回                 |
| -------------------------- | ----------------------------------- |
| `storage.foldername(name)` | `{a,b}`（目录数组，`[1]` 是第一层） |
| `storage.filename(name)`   | `c.png`                             |
| `storage.extension(name)`  | `png`                               |

## 11.5 storage.objects 上的策略

不同操作需要的权限（官方访问控制文档）：

| 操作                                   | 需要的策略                      |
| -------------------------------------- | ------------------------------- |
| 上传（`upload`）                       | INSERT                          |
| 覆盖上传（`upload` 带 `upsert: true`） | INSERT **+ SELECT + UPDATE**    |
| 私有桶下载、生成签名 URL、列出文件     | SELECT                          |
| 删除                                   | DELETE（以及能看到它的 SELECT） |

**没有策略时，Storage 不允许任何上传。** 写入第五份迁移（完整内容见 [example/supabase/migrations/20261022094000_storage_and_lifecycle.sql](./example/supabase/migrations/20261022094000_storage_and_lifecycle.sql)）：

```bash
npx supabase migration new storage_and_lifecycle
```

### 任务附件（私有）

```sql
create policy "attachments bucket: members read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'task-attachments'
  and (storage.foldername(name))[1] in (
    select org_id::text from private.user_org_ids() as org_id
  )
);

create policy "attachments bucket: members upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'task-attachments'
  and (storage.foldername(name))[1] in (
    select org_id::text from private.user_org_ids() as org_id
  )
);

create policy "attachments bucket: uploader deletes"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'task-attachments'
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[1] in (
    select org_id::text from private.user_org_ids() as org_id
  )
);
```

一个值得注意的写法：**比较时把组织 id 转成文本，而不是把路径转成 uuid。** 如果写成 `(storage.foldername(name))[1]::uuid in (...)`，有人上传路径为 `hello/x.pdf` 的文件时，`'hello'::uuid` 会让整条语句报错——SQL 不保证 `and` 两边的求值顺序，即使前面写了 `bucket_id = ...` 也不能保证它先执行。用文本比较，非法路径只会“不匹配”。

`owner_id` 是 Storage 根据上传者的 JWT 自动填写的（文本类型），所以删除策略可以判断“是不是你上传的”。

### 头像（公开）

```sql
create policy "avatars bucket: owner reads own folder"
on storage.objects for select to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "avatars bucket: owner uploads to own folder"
on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "avatars bucket: owner updates own folder"
on storage.objects for update to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text))
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "avatars bucket: owner deletes own folder"
on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
```

公开桶的**下载**不需要 SELECT 策略（任何人都能通过公开 URL 下载）。这里的 SELECT 策略有两个作用：支持 `upsert` 覆盖（需要 SELECT + UPDATE），以及让用户只能**列出**自己目录下的文件——官方文档特别提醒，给公开桶写 `using (bucket_id = 'avatars')` 这类宽泛的 SELECT 策略，会让任何人都能**列出桶里的所有文件名**。如果确实需要更细的区分，官方提供了 `storage.allow_only_operation()` 与 `storage.allow_any_operation()` 来按具体的 Storage 操作（列出 vs 下载）区分 SELECT 策略。

### 为策略加索引

策略按 `bucket_id` 和路径过滤 `storage.objects`。文件很多时，可以为常用的过滤条件加索引——这是官方明确允许对 `storage` schema 做的修改。先用 EXPLAIN 确认需要，再添加。

## 11.6 上传、登记、下载：完整流程

`scripts/storage-demo.mjs` 演示了完整流程。核心代码：

```js
// 1. 生成路径：{org_id}/{task_id}/{uuid}-{文件名}
const path = `${task.org_id}/${task.id}/${randomUUID()}-${fileName}`;

// 2. 上传到私有桶（以 Erin 的身份，受 storage.objects 的 INSERT 策略约束）
const upload = await erin.storage
  .from("task-attachments")
  .upload(path, file, { contentType: "text/plain" });
if (upload.error) throw upload.error;

// 3. 在数据库登记元数据；失败就删除刚上传的文件，避免孤儿
const meta = await erin.from("attachments").insert({
  org_id: task.org_id,
  task_id: task.id,
  object_path: path,
  file_name: fileName,
  content_type: "text/plain",
  size_bytes: file.size,
});
if (meta.error) {
  await erin.storage.from("task-attachments").remove([path]);
  throw meta.error;
}
```

几个关于上传的事实（官方 Standard Uploads 文档）：

- 标准上传适合不超过 6 MB 的文件；更大的文件推荐使用 TUS 可续传上传。
- 上传到已存在的路径默认返回 `400 Asset Already Exists`；要覆盖需 `upsert: true`（以及对应的 SELECT + UPDATE 策略）。
- **官方建议尽量不要覆盖文件**：CDN 需要时间把变更传播到所有边缘节点，期间用户可能拿到旧内容。上传到新路径是避免缓存问题的推荐做法——这也是我们在路径里加随机前缀的另一个原因。
- 两个客户端同时上传同一路径：默认先完成的成功，后者收到 `400`；使用 upsert 时后完成的覆盖前者。

可选本地路线运行演示（云端按上面的登录客户端逐步操作，路径必须取真实测试组织/任务的 id，不用写死种子 id）：

```bash
npx supabase db reset && npm run dev:users && npm run demo:rls && npm run demo:storage
```

预期输出（节选）：

```text
✓ 上传成功： <org_id>/<task_id>/<uuid>-meeting-notes.txt
✓ 附件元数据已登记
✗ 用公开地址访问私有文件：HTTP 400              ← 私有桶没有公开地址（具体状态码以实际为准）
✓ 60 秒签名 URL 下载：HTTP 200，内容 = 周会纪要：首屏图片改为响应式。
✗ Grace 下载：Object not found                  ← 对她来说文件“不存在”（RLS 过滤）
✗ Grace 生成签名 URL：Object not found
✗ 上传可执行文件：mime type application/x-msdownload is not supported
```

（错误文案随 Storage 版本可能不同，关键是哪些成功、哪些失败。）

## 11.7 签名 URL：什么时候用，有什么代价

私有文件有两种下载方式：

| 方式       | 怎么做                                                                   | 适合                                                                               |
| ---------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 带身份下载 | `supabase.storage.from(b).download(path)`，请求携带用户 JWT，由 RLS 判断 | 程序内读取文件内容                                                                 |
| 签名 URL   | `createSignedUrl(path, 秒数)` 生成一个带签名的临时链接                   | 需要一个 URL 的场景：`<img src>`、`<a download>`、发给第三方服务、邮件中的下载链接 |

```js
const { data, error } = await supabase.storage
  .from("task-attachments")
  .createSignedUrl(path, 60); // 60 秒后失效
// data.signedUrl
```

**签名 URL 在有效期内，任何拿到它的人都能下载，不再检查身份。** 所以：

1. **有效期要短**：页面展示用几分钟足够；一次性下载用几十秒。
2. **它几乎不能被撤销**：官方说明签名 URL 由每个项目独立的内部密钥签名，与 Auth 的 JWT 密钥无关——轮换 JWT 密钥、停用旧 key 都**不影响**已签发的签名 URL，它们会一直有效到过期；需要撤销时只能联系 Supabase 支持。
3. **不要把签名 URL 存进数据库或写进日志**，每次需要时重新生成。
4. 生成签名 URL 需要该对象的 SELECT 权限：Grace 无法为 Erin 组织的文件签名，演示中已验证。

### 签名上传 URL

`createSignedUploadUrl(path)` 生成一个**上传**用的签名链接（官方 JS 参考：有效期 2 小时），持有者无需再认证即可向该路径上传。典型用法是让**服务端先做业务校验**（配额、文件数量、付费状态），再签发上传链接，客户端用 `uploadToSignedUrl(path, token, file)` 直接上传到 Storage，文件不经过你的服务器。

```js
// 服务端（secret key 或代表用户的客户端），校验通过后：
const { data } = await supabase.storage
  .from("task-attachments")
  .createSignedUploadUrl(path);
// 把 data.path 与 data.token 返回给前端

// 前端：
await supabase.storage
  .from("task-attachments")
  .uploadToSignedUrl(data.path, data.token, file);
```

同样的原则：链接只发给需要的人，路径由服务端决定而不是客户端随意指定。

## 11.8 文件与数据库的一致性

文件在对象存储，元数据在 Postgres，**两者之间没有分布式事务**。任何一步都可能失败，你需要为每种失败设计结果：

| 步骤                                 | 失败时的后果           | 处理                                                                 |
| ------------------------------------ | ---------------------- | -------------------------------------------------------------------- |
| 先上传文件，再写元数据；写元数据失败 | 孤儿文件               | 捕获错误后立即删除文件（演示代码已这样做）；再加上定期的孤儿扫描兜底 |
| 先写元数据，再上传；上传失败         | 数据库指向不存在的文件 | 不推荐这个顺序                                                       |
| 删除元数据行，再删文件；删文件失败   | 孤儿文件               | 发件箱模式（11.9）                                                   |
| 先删文件，再删元数据；删元数据失败   | 数据库指向已删除的文件 | 页面显示“文件已失效”，可重试删除                                     |

孤儿扫描可以用只读查询完成（读取 `storage.objects` 是允许的）：

```sql
-- task-attachments 桶中没有任何 attachments 行引用的对象（上传超过 1 天，避开进行中的上传）
select o.name, o.created_at
  from storage.objects o
  left join public.attachments a on a.object_path = o.name
 where o.bucket_id = 'task-attachments'
   and a.id is null
   and o.created_at < now() - interval '1 day';
```

然后由服务端用 Storage API 删除这些对象，**而不是**对 `storage.objects` 执行 `delete`。

## 11.9 文件生命周期：没有自动过期，自己实现保留期

Supabase Storage **没有**类似“30 天后自动删除”的对象生命周期规则可供配置。保留与清理要自己实现。Teamboard 的设计：

```text
用户软删除任务 ──► tasks.deleted_at = now()
                      │  30 天后
                      ▼
清理任务：private.purge_deleted_tasks('30 days')   ← 分批硬删除
                      │  外键 cascade
                      ▼
attachments 行被删除 ──► 触发器把 object_path 写入 private.storage_cleanup_queue（同一事务）
                      │
                      ▼
清理任务读取队列 ──► Storage API remove(paths) ──► 成功：出队；失败：attempts + 1，记录错误
```

这就是**发件箱（outbox）模式**：数据库事务无法调用外部 API，但可以在同一个事务里“登记一件待办”，由外部任务可靠地完成。删除行和登记待删路径要么一起成功、要么一起回滚，不会出现“行删了但没人知道要删文件”。

迁移中的相关部分：

```sql
create table private.storage_cleanup_queue (
  id bigint generated always as identity primary key,
  bucket_id text not null,
  object_path text not null,
  enqueued_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  constraint storage_cleanup_queue_object_key unique (bucket_id, object_path)
);

-- 普通成员删除附件时也要能入队，但他们对 private 里的队列没有权限 → security definer
create function private.enqueue_attachment_cleanup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.storage_cleanup_queue (bucket_id, object_path)
  values ('task-attachments', old.object_path)
  on conflict (bucket_id, object_path) do nothing;
  return old;
end;
$$;

create trigger attachments_enqueue_cleanup
  after delete on public.attachments
  for each row execute function private.enqueue_attachment_cleanup();

-- 有了清理队列，就可以把第 4 章的 restrict 演进为 cascade
alter table public.attachments
  drop constraint attachments_task_fk,
  add constraint attachments_task_fk foreign key (task_id, org_id)
    references public.tasks (id, org_id) on delete cascade;

-- 分批硬删除回收站里超过保留期的任务
create function private.purge_deleted_tasks(p_older_than interval, p_batch_size integer default 500)
returns integer language plpgsql set search_path = '' as $$
declare
  v_deleted integer;
begin
  delete from public.tasks
   where id in (
     select id from public.tasks
      where deleted_at is not null and deleted_at < now() - p_older_than
      order by deleted_at
      limit p_batch_size
   );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function private.purge_deleted_tasks(interval, integer) from public;
revoke all on table private.storage_cleanup_queue from anon, authenticated, service_role;
```

注意第 4 章的约束演进：这是一个**新迁移**修改了旧迁移创建的约束，而不是回去改旧迁移。`drop constraint` 与 `add constraint` 放在同一条 `alter table` 里、同一个迁移事务中完成，不会出现“没有外键”的中间状态。

清理任务 [scripts/storage-cleanup.mjs](./example/scripts/storage-cleanup.mjs) 同时使用两种服务端凭据：

- **直连**（`DATABASE_URL`）读写 `private` 里的队列——它不在 Data API 暴露的 schema 中；
- **secret key** 调用 Storage API 删除文件——绕过 Storage 的 RLS（官方：服务端可以用 service key 访问全部 Storage API）。

```bash
npm run job:cleanup
```

分批执行（每批 500 行一个短事务）是 Supabase 数据删除指南的建议：一次删除几百万行会长时间持锁、产生大量 WAL；分批可以控制节奏、缩短锁持有时间。

### 用 pg_cron 定时执行数据库那一半

“硬删除过期任务”这一步完全在数据库内完成，可以交给 `pg_cron` 扩展定时执行（需在 Dashboard 启用扩展）：

```sql
select cron.schedule(
  'purge-deleted-tasks',
  '0 3 * * *',                                         -- 每天 03:00（UTC）
  $$select private.purge_deleted_tasks('30 days', 5000)$$
);
```

删除文件那一半需要调用 Storage API，仍由服务端任务（或 Edge Function 定时调用）完成。

### 其他生命周期场景

| 场景                                       | 做法                                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 临时上传（例如导入文件，处理完就不需要了） | 放在 `tmp/` 前缀下，定期扫描 `created_at` 早于 N 天的对象并删除                                                             |
| 用户注销账号                               | 头像目录 `avatars/{user_id}/` 整体删除；任务附件是否保留属于业务决定（它们属于组织）                                        |
| 组织删除                                   | 先删除该组织目录下的全部对象（或依靠级联 + 清理队列），再删除组织                                                           |
| 大量对象的清空                             | 官方说明：通过 Dashboard 或 Storage API 清空桶有每桶 20 万个对象的硬限制；更大的桶使用 S3 协议与 AWS CLI 的 `sync --delete` |

## 11.10 Storage 安全清单

- [ ] 敏感文件只放私有桶；公开桶只放本来就打算公开的内容。
- [ ] 每个桶设置 `file_size_limit` 和 `allowed_mime_types`。
- [ ] 路径以租户 id 开头，策略按路径第一段判断归属；比较时不做可能失败的类型转换。
- [ ] 公开桶不写宽泛的 SELECT 策略（否则任何人都能列出所有文件）。
- [ ] 签名 URL 有效期尽量短，不存储、不记录日志。
- [ ] 文件的删除一律通过 Storage API，不对 `storage.objects` 执行 SQL 删除。
- [ ] 元数据与文件的不一致有处理方案：上传失败清理、删除走发件箱、定期扫描孤儿。
- [ ] 有明确的保留期与清理任务；记住数据库备份不包含文件。
- [ ] secret key 只在服务端清理任务里使用。

## 11.11 本章练习

1. 增加“用户头像”功能：写出前端上传自己头像的代码，并说明路径与 `upsert` 需要哪些策略。
2. 有人提议把合同 PDF 放进公开桶，“文件名是 UUID，没人猜得到”。给出至少三条反对理由。
3. 管理员也需要能删除组织内任何人上传的附件。修改 Storage 的删除策略。注意不要把路径强转为 uuid。
4. 清理任务删除文件时 Storage API 返回错误，会发生什么？会不会丢失“待删除”的记录？
5. 为什么 `enqueue_attachment_cleanup` 需要 `security definer`，而 `purge_deleted_tasks` 不需要？

### 参考答案

1. ```js
   const {
     data: { user },
   } = await supabase.auth.getUser();
   await supabase.storage
     .from("avatars")
     .upload(`${user.id}/avatar.png`, file, {
       contentType: file.type,
       upsert: true,
     });
   const { data } = supabase.storage
     .from("avatars")
     .getPublicUrl(`${user.id}/avatar.png`);
   ```
   需要 INSERT、SELECT、UPDATE 三条策略，且都限制在 `auth.uid()` 对应的目录。由于覆盖同一路径会遇到 CDN 缓存延迟，可以改为每次上传新文件名（如带时间戳），并在 `profiles` 中记录当前头像路径。
2. 公开桶下载不检查权限，任何拿到 URL 的人都能下载；URL 会通过转发、日志、浏览器历史、Referer 泄露且无法撤销；被移出组织的人仍可访问；CDN 缓存使删除后仍可能被访问一段时间；合同属于敏感数据，泄露后果严重。
3. ```sql
   drop policy "attachments bucket: uploader deletes" on storage.objects;
   create policy "attachments bucket: uploader or admins delete"
   on storage.objects for delete to authenticated
   using (
     bucket_id = 'task-attachments'
     and (
       (owner_id = (select auth.uid()::text)
         and (storage.foldername(name))[1] in (select org_id::text from private.user_org_ids() as org_id))
       or (storage.foldername(name))[1] in (
         select m.org_id::text from public.memberships m
          where m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
       )
     )
   );
   ```
   用文本比较组织 id；写在一个新迁移里。更整洁的做法是新增一个返回“我担任管理员的组织 id 集合”的 `security definer` 辅助函数。
4. 脚本把这一批记录的 `attempts` 加一并写入 `last_error`，记录留在队列中，下次运行重试；`attempts` 达到 5 后不再自动重试，需要人工查看 `last_error`。记录不会丢失，因为只有删除成功后才出队。
5. 触发器在普通成员删除附件时执行，执行者是 `authenticated` 角色，它对 `private.storage_cleanup_queue` 没有任何权限，所以必须以所有者身份写入。`purge_deleted_tasks` 只由服务端以 `postgres` 身份（或 pg_cron）调用，调用者本来就有权限；不必要的 `security definer` 只会扩大风险面。

## 本章验收

- [ ] 能说明 Storage 的文件与元数据分别存在哪里，知道 `storage` schema 应视为只读、数据库备份不含文件。
- [ ] 能根据数据敏感度选择公开桶或私有桶，说出“公开桶当私有存储”的至少四个风险。
- [ ] 能在迁移中创建带大小与类型限制的桶。
- [ ] 能设计以租户开头的路径，并在 `storage.objects` 上写出读、写、删、覆盖所需的策略。
- [ ] 能解释签名 URL 与签名上传 URL 的用途、有效期与不可撤销性。
- [ ] 能列出文件与元数据不一致的各种情况及处理方式。
- [ ] 能用发件箱模式与分批清理实现文件生命周期，知道 Storage 没有内置的过期规则。

## 官方阅读

- [Supabase：Storage Buckets（公开与私有）](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Supabase：Creating buckets（上传限制）](https://supabase.com/docs/guides/storage/buckets/creating-buckets)
- [Supabase：Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase：Storage Helper Functions](https://supabase.com/docs/guides/storage/schema/helper-functions)
- [Supabase：The Storage Schema（只读、可加索引）](https://supabase.com/docs/guides/storage/schema/design)
- [Supabase：Serving assets（公开 URL 与签名 URL）](https://supabase.com/docs/guides/storage/serving/downloads)
- [Supabase：Standard Uploads（覆盖与 CDN）](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
- [Supabase：Delete Objects](https://supabase.com/docs/guides/storage/management/delete-objects)
- [Supabase：createSignedUploadUrl](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl)
- [Supabase：pg_cron](https://supabase.com/docs/guides/database/extensions/pg_cron)
