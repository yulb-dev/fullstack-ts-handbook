import { data, useLoaderData, useFetcher, Link } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { getConcert, updateConcert } from "../../api";
import type { Concert } from "../../api";

// 第 3、6 章：找不到数据时 throw 404，交给最近的错误边界
export async function loader({ params, request }: LoaderFunctionArgs) {
  const concert = await getConcert(params.concertId!, { signal: request.signal });
  if (!concert) throw data("找不到这场演唱会", { status: 404 });
  return { concert };
}

// 第 5 章：收藏 = 局部提交（由 fetcher.Form 触发），不改 URL
export async function action({ request, params }: ActionFunctionArgs) {
  const fd = await request.formData();
  const favorite = fd.get("favorite") === "true";
  await updateConcert(params.concertId!, { favorite });
  return { ok: true, favorite };
}

export default function ConcertDetail() {
  const { concert } = useLoaderData() as { concert: Concert };
  const fetcher = useFetcher<typeof action>();

  // 乐观更新：提交中先用 fetcher.formData 猜出「下一状态」
  const favorite = fetcher.formData
    ? fetcher.formData.get("favorite") === "true"
    : !!concert.favorite;

  return (
    <article>
      <h1>{concert.title}</h1>
      <p>
        {concert.city} · {concert.date}
      </p>

      <fetcher.Form method="post">
        <input type="hidden" name="favorite" value={favorite ? "false" : "true"} />
        <button type="submit" disabled={fetcher.state !== "idle"}>
          {favorite ? "★ 已收藏" : "☆ 收藏"}
        </button>
      </fetcher.Form>

      <p>
        <Link to={`/concerts/${concert.city}/${concert.id}/edit`}>编辑</Link> ·{" "}
        <Link to={`/concerts/${concert.city}`}>返回列表</Link>
      </p>
    </article>
  );
}
