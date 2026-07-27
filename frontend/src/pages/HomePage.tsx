import {useEffect, useMemo, useRef, useState} from "react";
import {Link, useNavigate} from "react-router-dom";
import {api} from "../api";
import type {Keyword, Paper} from "../types";
import TaskTable from "../components/TaskTable";

const statuses = ["未読", "読書中", "既読", "再確認"] as const;
const statusColors: Record<Paper["status"], {background: string; color: string}> = {
  "未読": {background: "#ecefed", color: "#52625b"},
  "読書中": {background: "#fff0cc", color: "#795b13"},
  "既読": {background: "#dff0e6", color: "#2f6848"},
  "再確認": {background: "#f7e3df", color: "#8a4038"},
};

function RatingStars({rating}: {rating: number | null}) {
  const value = Math.max(0, Math.min(5, rating ?? 0));
  return <span className={`rating-stars ${value === 0 ? "unrated" : ""}`} aria-label={value === 0 ? "未評価" : `評価 ${value} / 5`}>{"★".repeat(value)}{"☆".repeat(5 - value)}</span>;
}

export default function HomePage({readonly = false}: {readonly?: boolean}) {
  const navigate = useNavigate();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [taskPapers, setTaskPapers] = useState<Paper[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const load = () => {
    const params = new URLSearchParams({q, status, keyword_id: keyword, sort: "updated_at"});
    api<Paper[]>(`/papers?${params}`).then(setPapers).catch(error => setError(error.message));
  };
  const loadTasks = () => api<Paper[]>("/papers").then(setTaskPapers).catch(error => setError(error.message));
  useEffect(load, [q, status, keyword]);
  useEffect(() => { void loadTasks(); }, []);
  useEffect(() => { api<Keyword[]>("/keywords").then(setKeywords); }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.ctrlKey && event.key.toLowerCase() === "f") { event.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, []);
  const counts = useMemo(() => Object.fromEntries(statuses.map(value => [value, papers.filter(paper => paper.status === value).length])), [papers]);
  return <main className="page">
    <header className="page-header"><div><p className="eyebrow">Home</p><h1>ホーム</h1><p className="muted">手元の論文と、そのつながりを見渡します。</p></div><Link to="/register"><button>＋ 論文を登録</button></Link></header>
    {error && <div className="error">{error}</div>}
    <div className="home-layout"><div className="home-papers">
      <section className="summary-grid">{statuses.map(value => <button className="summary-card text-button" key={value} onClick={() => setStatus(status === value ? "" : value)}><strong>{counts[value] ?? 0}</strong><span>{value}</span></button>)}</section>
      <section>
        <div className="toolbar">
          <input ref={searchRef} aria-label="論文を検索" placeholder="タイトル・著者・キーワードを検索（Ctrl+F）" value={q} onChange={e => setQ(e.target.value)} />
          <select aria-label="状態で絞り込み" value={status} onChange={e => setStatus(e.target.value)}><option value="">すべての状態</option>{statuses.map(value => <option key={value}>{value}</option>)}</select>
          <select aria-label="キーワードで絞り込み" value={keyword} onChange={e => setKeyword(e.target.value)}><option value="">すべてのキーワード</option>{keywords.map(value => <option value={value.id} key={value.id}>{value.name}</option>)}</select>
        </div>
        <div className="table-wrap"><table className="home-paper-table"><thead><tr><th>状態</th><th>タイトル / 著者</th><th>発行年</th><th>キーワード</th><th>評価</th><th>登録日</th></tr></thead>
          <tbody>{papers.map(paper => <tr
            key={paper.id}
            aria-label={`${paper.title}の詳細を開く`}
            tabIndex={0}
            style={{cursor: "pointer"}}
            onClick={() => navigate(`/papers/${paper.id}`)}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                navigate(`/papers/${paper.id}`);
              }
            }}
          ><td className="status"><span className="tag" style={{...statusColors[paper.status], border: "0", fontWeight: 700}}>{paper.status}</span></td><td className="paper-title-cell"><span className="title-link" title={paper.title}>{paper.title}</span><div className="muted" title={paper.authors.join(" / ") || "著者未登録"} style={{whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{paper.authors.join(" / ") || "著者未登録"}</div></td><td>{paper.year ?? "—"}</td><td>{paper.keywords.map(value => <span className="tag" style={{borderLeft: `3px solid ${value.color}`}} key={value.id}>{value.name}</span>)}</td><td><RatingStars rating={paper.rating} /></td><td>{new Date(paper.created_at).toLocaleDateString("ja-JP")}</td></tr>)}</tbody>
        </table>{papers.length === 0 && <div className="empty">条件に一致する論文はありません。</div>}</div>
      </section>
    </div><TaskTable papers={taskPapers} readonly={readonly} reload={() => {load(); void loadTasks();}} /></div>
  </main>;
}
