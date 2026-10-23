// ─────────────────────────────────────────────────────────────
// 极简内存数据层，模拟后端 API。
// 特点：1) 每个请求带人工延迟，方便观察 loading / pending UI；
//       2) 支持 AbortSignal，用于演示 loader 的请求取消。
// ─────────────────────────────────────────────────────────────

export type Concert = {
  id: string;
  city: string;
  title: string;
  date: string; // YYYY-MM-DD
  favorite?: boolean;
};

type Opts = { signal?: AbortSignal };

let concerts: Concert[] = [
  { id: "1", city: "salt-lake-city", title: "The Folklore Sessions", date: "2026-11-02" },
  { id: "2", city: "salt-lake-city", title: "Neon Desert Live", date: "2026-11-18" },
  { id: "3", city: "chicago", title: "Windy City Rockfest", date: "2026-12-05" },
  { id: "4", city: "chicago", title: "Jazz by the Lake", date: "2026-12-20" },
];

export const CITIES = ["salt-lake-city", "chicago"] as const;

// 支持中途取消的 delay：signal abort 时清定时器并抛 AbortError
function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export async function listConcerts({ signal }: Opts = {}): Promise<Concert[]> {
  await delay(300, signal);
  return concerts;
}

export async function getConcert(id: string, { signal }: Opts = {}): Promise<Concert | undefined> {
  await delay(400, signal);
  return concerts.find((c) => c.id === id);
}

export async function getConcertsByCity(city: string, { signal }: Opts = {}): Promise<Concert[]> {
  await delay(300, signal);
  return concerts.filter((c) => c.city === city);
}

export async function createConcert(input: Partial<Concert>): Promise<Concert> {
  await delay(500);
  const concert: Concert = {
    id: String(Date.now()),
    city: input.city ?? "chicago",
    title: input.title ?? "Untitled",
    date: input.date ?? new Date().toISOString().slice(0, 10),
  };
  concerts.push(concert);
  return concert;
}

export async function updateConcert(id: string, patch: Partial<Concert>): Promise<Concert | undefined> {
  await delay(500);
  concerts = concerts.map((c) => (c.id === id ? { ...c, ...patch } : c));
  return concerts.find((c) => c.id === id);
}
