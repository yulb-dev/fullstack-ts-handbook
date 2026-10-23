import { describe, it, expect } from "vitest";
import { action } from "./login";

// 验证「redirect() 返回真实 Response」：可直接断言状态码与 Location 头（第 9 章）
describe("login action", () => {
  it("登录后 redirect 回来源页（302 + Location）", async () => {
    const request = new Request(
      "http://localhost/login?from=%2Fadmin%2Freport",
      {
        method: "POST",
        body: new URLSearchParams({ role: "admin" }),
      },
    );

    const res = await action({ request } as never);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/report");
  });
});
