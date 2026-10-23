// 极简「登录态」模拟。真实项目请使用服务端 session / token。
export type User = { name: string; role: "user" | "admin" };

const KEY = "concert_hub_user";

export function getSession(): User | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as User) : null;
}

export function setSession(user: User | null): void {
  if (typeof localStorage === "undefined") return;
  if (user) localStorage.setItem(KEY, JSON.stringify(user));
  else localStorage.removeItem(KEY);
}
