import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    status: text("status").notNull().default("todo"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    ownerId: text("owner_id").notNull(),
    assigneeId: text("assignee_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("tasks_title_unique").on(table.title)],
);

export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
