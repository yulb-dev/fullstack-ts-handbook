import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  primaryKey,
  snakeCase,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// 枚举值与 API 契约里的 TaskStatus / TaskPriority 保持一致（第 12 章讲为什么不直接复用）
export const taskStatus = pgEnum("task_status", ["todo", "doing", "done"]);
export const taskPriority = pgEnum("task_priority", ["low", "medium", "high"]);
export const memberRole = pgEnum("member_role", ["owner", "editor", "viewer"]);

// 所有时间点统一 timestamptz + 毫秒精度：与 JS Date / ISO 字符串的精度一致，游标分页才不会因为截断而漏行
const createdAt = timestamp({ withTimezone: true, precision: 3 })
  .notNull()
  .defaultNow();
const updatedAt = timestamp({ withTimezone: true, precision: 3 })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

export const users = snakeCase.table(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    displayName: text().notNull(),
    createdAt,
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)],
);

// 服务端会话：Cookie 里只放随机 token，数据库只存 token 的 SHA-256
export const sessions = snakeCase.table(
  "sessions",
  {
    tokenHash: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    csrfToken: text().notNull(),
    expiresAt: timestamp({ withTimezone: true, precision: 3 }).notNull(),
    createdAt,
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const projects = snakeCase.table("projects", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  createdAt,
});

export const projectMembers = snakeCase.table(
  "project_members",
  {
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("project_members_user_id_idx").on(t.userId),
  ],
);

export const tasks = snakeCase.table(
  "tasks",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text().notNull(),
    description: text(),
    status: taskStatus().notNull().default("todo"),
    priority: taskPriority().notNull().default("medium"),
    // 截止「日期」是日历概念，不是时间点：用 date，并以 'YYYY-MM-DD' 字符串进出
    dueDate: date({ mode: "string" }),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    // 乐观并发控制：每次更新 +1，客户端用 If-Match 带回它（第 11 章）
    version: integer().notNull().default(1),
    createdAt,
    updatedAt,
  },
  (t) => [
    // 游标分页的排序键 (created_at desc, id desc) 需要对应的复合索引（第 12 章）
    index("tasks_project_created_idx").on(
      t.projectId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    // 同一项目里「未完成」任务标题不可重复（不区分大小写）——第 9 章的 409 来源
    uniqueIndex("tasks_project_open_title_uq")
      .on(t.projectId, sql`lower(${t.title})`)
      .where(sql`${t.status} <> 'done'`),
    check("tasks_title_len_ck", sql`char_length(${t.title}) between 1 and 120`),
    check("tasks_version_pos_ck", sql`${t.version} > 0`),
  ],
);

// 幂等键记录：同一用户 + 同一个键 = 同一次「创建意图」（第 11 章）
export const idempotencyKeys = snakeCase.table(
  "idempotency_keys",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: uuid().notNull(),
    // 作用域：同一个键不能被挪用到别的接口
    scope: text().notNull(),
    // 请求体指纹：同键不同内容要拒绝，而不是悄悄返回旧结果
    requestHash: text().notNull(),
    responseStatus: integer().notNull(),
    responseBody: jsonb().notNull(),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index("idempotency_keys_created_idx").on(t.createdAt),
  ],
);
