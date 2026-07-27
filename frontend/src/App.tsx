import {useEffect, useState} from "react";
import {NavLink, Navigate, Route, Routes} from "react-router-dom";
import {api} from "./api";
import HomePage from "./pages/HomePage";
import RegisterPage from "./pages/RegisterPage";
import DetailPage from "./pages/DetailPage";
import GraphPage from "./pages/GraphPage";
import KeywordsPage from "./pages/KeywordsPage";
import TrashPage from "./pages/TrashPage";
import SettingsPage from "./pages/SettingsPage";

type SystemInfo = {version: string; configured: boolean; library_path?: string; available: boolean; writable: boolean; message: string};
type MenuIconName = "home" | "register" | "graph" | "keywords" | "trash" | "settings";

function MenuIcon({name}: {name: MenuIconName}) {
  const common = {width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true};
  if (name === "home") return <svg {...common}><path d="m3 11 9-8 9 8"/><path d="M5 10v11h14V10M9 21v-7h6v7"/></svg>;
  if (name === "register") return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 12v6M9 15h6"/></svg>;
  if (name === "graph") return <svg {...common}><circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="m7.2 7.2 3.5 8.3m6.1-8.3-3.5 8.3M7.5 6h9"/></svg>;
  if (name === "keywords") return <svg {...common}><path d="M20 13 13 20a2 2 0 0 1-2.8 0L4 13.8V4h9.8L20 10.2a2 2 0 0 1 0 2.8Z"/><circle cx="9" cy="9" r="1.2"/></svg>;
  if (name === "trash") return <svg {...common}><path d="M3 6h18M8 6V3h8v3m3 0-1 15H6L5 6m5 4v7m4-7v7"/></svg>;
  return <svg {...common}><path d="M4 6h10m4 0h2M4 12h3m4 0h9M4 18h7m4 0h5"/><circle cx="16" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="13" cy="18" r="2"/></svg>;
}

function Setup({refresh}: {refresh: () => void}) {
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/setup", {method: "POST", body: JSON.stringify({path})}); refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "設定に失敗しました。"); }
    finally { setBusy(false); }
  }
  return <main className="setup-shell">
    <section className="setup-card">
      <p className="eyebrow">最初の一歩</p>
      <h1>論文を編み、知識をつなぐ。</h1>
      <p>Box Drive配下にLitWeaveのライブラリを作成します。対象フォルダーはBox Driveで「常にこのデバイスに保持」に設定してください。</p>
      <form onSubmit={submit}>
        <label>ライブラリ保存先<input required value={path} onChange={e => setPath(e.target.value)} placeholder={"C:\\Users\\ユーザー名\\Box\\LitWeave Library"} /></label>
        {error && <div className="error" role="alert">{error}<small>Box Driveが起動していることと、書き込み権限を確認してください。</small></div>}
        <button disabled={busy}>{busy ? "確認中…" : "保存先を確認して開始"}</button>
      </form>
    </section>
  </main>;
}

export default function App() {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const refresh = () => api<SystemInfo>("/system").then(setSystem).catch(error => setLoadError(error.message));
  useEffect(() => { void refresh(); }, []);
  if (loadError) return <main className="setup-shell"><div className="error">{loadError}<small>バックエンドが起動しているか確認してください。</small></div></main>;
  if (!system) return <main className="setup-shell">読み込み中…</main>;
  if (!system.configured) return <Setup refresh={refresh} />;
  return <div className="app-shell">
    <aside>
      <div className="brand"><span>LW</span><div><strong>LitWeave</strong><small>論文を編み、知識をつなぐ</small></div></div>
      <nav>
        <NavLink to="/home" style={{display: "flex", alignItems: "center", gap: ".75rem"}}><MenuIcon name="home"/>ホーム</NavLink>
        <NavLink to="/register" style={{display: "flex", alignItems: "center", gap: ".75rem"}}><MenuIcon name="register"/>論文登録</NavLink>
        <NavLink to="/graph" style={{display: "flex", alignItems: "center", gap: ".75rem"}}><MenuIcon name="graph"/>ナレッジグラフ</NavLink>
        <NavLink to="/keywords" style={{display: "flex", alignItems: "center", gap: ".75rem"}}><MenuIcon name="keywords"/>キーワード管理</NavLink>
        <NavLink to="/trash" style={{display: "flex", alignItems: "center", gap: ".75rem"}}><MenuIcon name="trash"/>ごみ箱</NavLink>
        <NavLink to="/settings" style={{display: "flex", alignItems: "center", gap: ".75rem"}}><MenuIcon name="settings"/>設定</NavLink>
      </nav>
      <div className={`storage ${system.available ? "" : "offline"}`}><i />{system.available ? "Box Drive 利用可能" : "Box Drive 利用不可"}<small>{system.writable ? "ローカル保存可能" : "読み取り専用"}</small></div>
    </aside>
    <div className="main-area">
      {!system.available && <div className="readonly">保存先を利用できないため、編集操作を停止しています。Box Driveを確認してください。</div>}
      <Routes>
        <Route path="/home" element={<HomePage readonly={!system.writable} />} />
        <Route path="/library" element={<Navigate to="/home" replace />} />
        <Route path="/register" element={<RegisterPage readonly={!system.writable} />} />
        <Route path="/papers/:id" element={<DetailPage readonly={!system.writable} />} />
        <Route path="/graph" element={<GraphPage />} />
        <Route path="/keywords" element={<KeywordsPage readonly={!system.writable} />} />
        <Route path="/trash" element={<TrashPage readonly={!system.writable} />} />
        <Route path="/settings" element={<SettingsPage system={system} readonly={!system.writable} refresh={refresh} />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </div>
  </div>;
}
