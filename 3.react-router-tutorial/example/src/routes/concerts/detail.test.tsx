import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  createRoutesStub,
  isRouteErrorResponse,
  useRouteError,
  data,
} from "react-router";

// mock 数据层：把「后端」替换成可控的假实现（第 9 章）
vi.mock("../../api", () => ({
  getConcert: vi.fn(),
  updateConcert: vi.fn(),
}));

import { loader, action } from "./detail";
import ConcertDetail from "./detail";
import * as api from "../../api";

// 构造标准 Request，并手传 params/context（模拟路由解析结果）
const makeArgs = (url: string, params: Record<string, string>, init?: RequestInit) =>
  ({ request: new Request(url, init), params, context: {} }) as never;

describe("detail.loader（纯函数层）", () => {
  beforeEach(() => vi.clearAllMocks());

  it("找到数据时返回 concert", async () => {
    vi.mocked(api.getConcert).mockResolvedValue({
      id: "3",
      city: "chicago",
      title: "Jazz Night",
      date: "2026-12-05",
    });
    const result = await loader(
      makeArgs("http://localhost/concerts/chicago/3", { city: "chicago", concertId: "3" }),
    );
    expect(api.getConcert).toHaveBeenCalled();
    expect(result).toEqual({ concert: expect.objectContaining({ title: "Jazz Night" }) });
  });

  it("数据不存在时抛出（404）", async () => {
    vi.mocked(api.getConcert).mockResolvedValue(undefined);
    await expect(
      loader(makeArgs("http://localhost/concerts/chicago/999", { concertId: "999" })),
    ).rejects.toBeDefined();
  });
});

describe("detail.action（纯函数层）", () => {
  beforeEach(() => vi.clearAllMocks());

  it("切换收藏后写库并返回结果", async () => {
    vi.mocked(api.updateConcert).mockResolvedValue(undefined);
    const res = await action(
      makeArgs(
        "http://localhost/concerts/chicago/3",
        { city: "chicago", concertId: "3" },
        { method: "POST", body: new URLSearchParams({ favorite: "true" }) },
      ),
    );
    expect(api.updateConcert).toHaveBeenCalledWith("3", { favorite: true });
    expect(res).toEqual({ ok: true, favorite: true });
  });
});

describe("ConcertDetail 组件（createRoutesStub）", () => {
  it("loader 抛 404 时渲染错误边界", async () => {
    const Stub = createRoutesStub([
      {
        path: "/concerts/:city/:concertId",
        Component: ConcertDetail,
        // 提供 HydrateFallback 可消除测试环境下的「hydration」告警
        HydrateFallback: () => null,
        loader: () => {
          throw data("找不到这场演唱会", { status: 404 });
        },
        ErrorBoundary: () => {
          const error = useRouteError();
          return isRouteErrorResponse(error) ? (
            <div>
              {error.status} {error.data}
            </div>
          ) : (
            <div>未知错误</div>
          );
        },
      },
    ]);

    render(<Stub initialEntries={["/concerts/chicago/999"]} />);
    expect(await screen.findByText(/404/)).toBeInTheDocument();
    expect(await screen.findByText(/找不到这场演唱会/)).toBeInTheDocument();
  });
});
