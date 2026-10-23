/**
 * 日期工具：全部把「现在」作为参数传入（now: Date），
 * 而不是内部调用 Date.now()。依赖注入让测试既可以用 fake timers，
 * 也可以直接传固定时间，两条路都不依赖真实时钟。
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** "还有 3 天" / "今天到期" / "已逾期 2 天" —— 只按日历天比较，忽略时分秒 */
export function dueLabel(due: Date, now: Date): string {
  const startOfUtcDay = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diffDays = Math.round((startOfUtcDay(due) - startOfUtcDay(now)) / DAY);
  if (diffDays === 0) return "今天到期";
  if (diffDays > 0) return `还有 ${diffDays} 天`;
  return `已逾期 ${-diffDays} 天`;
}

/** 相对时间：<1 分钟「刚刚」，<1 小时「x 分钟前」，<24 小时「x 小时前」，其余「x 天前」 */
export function relativeTimeLabel(past: Date, now: Date): string {
  const diff = now.getTime() - past.getTime();
  if (diff < 0) throw new RangeError("past 不能晚于 now");
  if (diff < MINUTE) return "刚刚";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
  return `${Math.floor(diff / DAY)} 天前`;
}

/** UTC 时间 → Asia/Shanghai 的 YYYY-MM-DD，用于展示层；固定时区保证任何机器结果一致 */
export function formatShanghaiDate(utc: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(utc);
}

export function isOverdue(due: Date | null, now: Date): boolean {
  return due !== null && due.getTime() < now.getTime();
}
