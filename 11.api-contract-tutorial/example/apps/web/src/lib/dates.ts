/**
 * 契约里有两种「时间」，展示方式不同（第 12 章）：
 * - date-time：UTC 时间点 → 按用户所在时区展示
 * - date：日历日期（YYYY-MM-DD）→ 没有时区，原样按日历展示
 */

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatInstant(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

/**
 * ⚠️ 不要写 new Date("2026-10-30")：它会被当成 UTC 零点，
 * 在 UTC-5 的用户那里显示成 10 月 29 日。日历日期要按年月日拆开构造本地日期。
 */
export function formatCalendarDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(y, m - 1, d),
  );
}
