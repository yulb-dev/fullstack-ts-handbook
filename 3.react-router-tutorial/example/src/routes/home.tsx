import { useLoaderData, Link } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { listConcerts } from "../api";
import type { Concert } from "../api";

export async function loader({ request }: LoaderFunctionArgs) {
  const concerts = await listConcerts({ signal: request.signal });
  return { concerts };
}

export default function Home() {
  const { concerts } = useLoaderData() as { concerts: Concert[] };
  return (
    <main>
      <h1>Concert Hub 🎸</h1>
      <p>
        共 {concerts.length} 场演出。<Link to="/concerts">浏览全部演唱会 →</Link>
      </p>
      <ul>
        {concerts.map((c) => (
          <li key={c.id}>
            <Link to={`/concerts/${c.city}/${c.id}`}>{c.title}</Link> — {c.city}（{c.date}）
          </li>
        ))}
      </ul>
    </main>
  );
}
