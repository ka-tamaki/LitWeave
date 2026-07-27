export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

const API_BASE = import.meta.env.DEV ? "http://127.0.0.1:8000/api" : "/api";

function formatDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (detail && !Array.isArray(detail) && typeof detail === "object" && "message" in detail) {
    return String(detail.message);
  }
  if (Array.isArray(detail)) {
    const labels: Record<string, string> = {year: "発行年", title: "タイトル", url: "URL"};
    const messages = detail.map(item => {
      if (!item || typeof item !== "object") return "入力形式が不正です。";
      const value = item as {loc?: unknown[]; msg?: string; type?: string};
      const field = String(value.loc?.at(-1) || "");
      const label = labels[field] || field || "入力項目";
      if (value.type === "int_parsing") return `${label}は整数で入力してください。`;
      return `${label}: ${value.msg || "入力形式が不正です。"}`;
    });
    return `入力内容を確認してください。${messages.join(" ")}`;
  }
  return "処理に失敗しました。";
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {...init, headers});
  } catch {
    throw new ApiError(
      "バックエンドとの接続が切れました。LitWeaveを終了せず、Box Driveとバックエンドの起動状態を確認してから再試行してください。",
      0,
    );
  }
  if (!response.ok) {
    const value = await response.json().catch(() => ({detail: "処理に失敗しました。"}));
    throw new ApiError(formatDetail(value.detail), response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
