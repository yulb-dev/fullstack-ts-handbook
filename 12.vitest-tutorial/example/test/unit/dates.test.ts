import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dueLabel,
  formatShanghaiDate,
  isOverdue,
  isSameUtcDay,
  relativeTimeLabel,
} from "@/domain/dates.js";

// 固定基准时间：2026-03-10T12:00:00Z（UTC 中午，避开时区日界线）
const NOW = new Date("2026-03-10T12:00:00Z");

describe("dueLabel（按日历天比较）", () => {
  it("同一天到期 → 今天到期", () => {
    expect(dueLabel(new Date("2026-03-10T23:59:59Z"), NOW)).toBe("今天到期");
  });

  it("差 1 天 / 3 天", () => {
    expect(dueLabel(new Date("2026-03-11T00:00:01Z"), NOW)).toBe("还有 1 天");
    expect(dueLabel(new Date("2026-03-13T12:00:00Z"), NOW)).toBe("还有 3 天");
  });

  it("逾期 2 天", () => {
    expect(dueLabel(new Date("2026-03-08T12:00:00Z"), NOW)).toBe("已逾期 2 天");
  });

  it("边界：只差几小时但跨了 UTC 日界线，也算「还有 1 天」", () => {
    // 23:00 → 次日 01:00 只差 2 小时，但日历天 +1：钉住「按天不按小时」的规则
    const late = new Date("2026-03-10T23:00:00Z");
    const nextMorning = new Date("2026-03-11T01:00:00Z");
    expect(dueLabel(nextMorning, late)).toBe("还有 1 天");
  });
});

describe("relativeTimeLabel（分段边界）", () => {
  const minus = (ms: number) => new Date(NOW.getTime() - ms);

  it.each([
    [0, "刚刚"],
    [59_999, "刚刚"], // 59.999 秒仍是「刚刚」
    [60_000, "1 分钟前"], // 恰好 1 分钟进入下一段
    [59 * 60_000, "59 分钟前"],
    [60 * 60_000, "1 小时前"],
    [23 * 60 * 60_000 + 59 * 60_000, "23 小时前"],
    [24 * 60 * 60_000, "1 天前"],
  ])("距现在 %i ms → %s", (ms, label) => {
    expect(relativeTimeLabel(minus(ms), NOW)).toBe(label);
  });

  it("past 晚于 now 是调用方错误：抛 RangeError 而不是返回负数", () => {
    expect(() => relativeTimeLabel(new Date(NOW.getTime() + 1), NOW)).toThrow(
      RangeError,
    );
  });
});

describe("时区与过期判断", () => {
  it("UTC 16:00 之后，上海已经是第二天", () => {
    // Asia/Shanghai = UTC+8：2026-03-10T16:30Z 是上海的 03-11 00:30
    expect(formatShanghaiDate(new Date("2026-03-10T15:59:00Z"))).toBe(
      "2026-03-10",
    );
    expect(formatShanghaiDate(new Date("2026-03-10T16:01:00Z"))).toBe(
      "2026-03-11",
    );
  });

  it("isSameUtcDay 只看 UTC 日历日", () => {
    expect(
      isSameUtcDay(
        new Date("2026-03-10T00:00:01Z"),
        new Date("2026-03-10T23:59:59Z"),
      ),
    ).toBe(true);
    expect(
      isSameUtcDay(
        new Date("2026-03-10T23:59:59Z"),
        new Date("2026-03-11T00:00:01Z"),
      ),
    ).toBe(false);
  });

  it("isOverdue：null 截止日永不过期；等于 now 不算过期（严格小于）", () => {
    expect(isOverdue(null, NOW)).toBe(false);
    expect(isOverdue(NOW, NOW)).toBe(false);
    expect(isOverdue(new Date(NOW.getTime() - 1), NOW)).toBe(true);
  });
});

describe("fake timers：验证「依赖真实时钟的代码」也能被测", () => {
  afterEach(() => {
    vi.useRealTimers(); // 必须还原，否则影响同文件后续测试
  });

  it("setSystemTime 冻结 Date，再 advanceTimersByTime 推进", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(new Date().toISOString()).toBe("2026-03-10T12:00:00.000Z");

    const spy = vi.fn();
    setTimeout(spy, 60_000);
    vi.advanceTimersByTime(59_999);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); // 恰好到 60s
    expect(spy).toHaveBeenCalledTimes(1);
    expect(new Date().toISOString()).toBe("2026-03-10T12:01:00.000Z");
  });
});
