import { useLoaderData, useSearchParams, Link } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { getConcertsByCity, listConcerts } from "../../api";
import type { Concert } from "../../api";

type LoaderData = {
  city: string;
  concerts: Concert[];
  q: string;
  sort: string;
  page: number;
  totalPages: number;
};

const PAGE_SIZE = 2;

// 第 3、7 章：loader 从 params + searchParams 读取「城市 / 搜索 / 排序 / 分页」
export async function loader({ request, params }: LoaderFunctionArgs): Promise<LoaderData> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const sort = url.searchParams.get("sort") ?? "date";
  const page = Number(url.searchParams.get("page") ?? "1");

  // index 路由（/concerts）没有 :city，展示全部
  const city = params.city;
  let list = city
    ? await getConcertsByCity(city, { signal: request.signal })
    : await listConcerts({ signal: request.signal });

  if (q) list = list.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));
  list = [...list].sort((a, b) =>
    sort === "title" ? a.title.localeCompare(b.title) : a.date.localeCompare(b.date),
  );

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const concerts = list.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return { city: city ?? "全部城市", concerts, q, sort, page: safePage, totalPages };
}

export default function ConcertsCity() {
  const { city, concerts, page, totalPages } = useLoaderData() as LoaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const sort = searchParams.get("sort") ?? "date";

  // 基于当前参数生成新参数（一次性改，避免多次 set 丢更新）
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === "" || v == null) next.delete(k);
      else next.set(k, v);
    }
    // 筛选类高频更新用 replace，避免污染历史栈
    setSearchParams(next, { replace: true });
  };

  return (
    <div>
      <h1>{city} 的演唱会</h1>

      <p>
        <input
          value={q}
          placeholder="搜索标题…"
          onChange={(e) => update({ q: e.target.value, page: "1" })}
        />{" "}
        <button onClick={() => update({ sort: sort === "date" ? "title" : "date", page: "1" })}>
          排序：{sort === "date" ? "按日期" : "按标题"}
        </button>
      </p>

      <ul>
        {concerts.map((c) => (
          <li key={c.id}>
            <Link to={`/concerts/${c.city}/${c.id}`}>{c.title}</Link>（{c.date}）
            {c.favorite ? " ★" : ""}
          </li>
        ))}
        {concerts.length === 0 && <li>没有匹配的演出。</li>}
      </ul>

      <p>
        <button disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
          上一页
        </button>
        <span>
          {" "}
          第 {page} / {totalPages} 页{" "}
        </span>
        <button disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })}>
          下一页
        </button>
      </p>
    </div>
  );
}
