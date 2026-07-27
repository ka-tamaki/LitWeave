import {useEffect, useMemo, useRef, useState} from "react";
import {Link, useNavigate} from "react-router-dom";
import {api} from "../api";
import type {Keyword, Paper} from "../types";

const statuses = ["未読", "読書中", "既読", "再確認"] as const;
const statusColors: Record<Paper["status"], {background: string; color: string}> = {
  "未読": {background: "#ecefed", color: "#52625b"},
  "読書中": {background: "#fff0cc", color: "#795b13"},
  "既読": {background: "#dff0e6", color: "#2f6848"},
  "再確認": {background: "#f7e3df", color: "#8a4038"},
};

export default function LibraryPage() {
  const navigate = useNavigate();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [sort, setSort] = useState("updated_at");
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const load = () => {
    const params = new URLSearchParams({q, status, keyword_id: keyword, sort});
    api<Paper[]>(`/papers?${params}`).then(setPapers).catch(error => setError(error.message));
  };
  useEffect(load, [q, status, keyword, sort]);
  useEffect(() => { api<Keyword[]>("/keywords").then(setKeywords); }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.ctrlKey && event.key.toLowerCase() === "f") { event.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, []);
  const counts = useMemo(() => Object.fromEntries(statuses.map(value => [value, papers.filter(paper => paper.status === value).length])), [papers]);
  return <main className="page">
    <header className="page-header"><div><p className="eyebrow">Library</p><h1>ライブラリ</h1><p className="muted">手元の論文と、そのつながりを見渡します。</p></div><Link to="/register"><button>＋ 論文を登録</button></Link></header>
    <section className="summary-grid">{statuses.map(value => <button className="summary-card text-button" key={value} onClick={() => setStatus(status === value ? "" : value)}><strong>{counts[value] ?? 0}</strong><span>{value}</span></button>)}</section>
    {error && <div className="error">{error}</div>}
    <section>
      <div className="toolbar">
        <input ref={searchRef} aria-label="論文を検索" placeholder="タイトル・著者・キーワードを検索（Ctrl+F）" value={q} onChange={e => setQ(e.target.value)} />
        <select aria-label="状態で絞り込み" value={status} onChange={e => setStatus(e.target.value)}><option value="">すべての状態</option>{statuses.map(value => <option key={value}>{value}</option>)}</select>
        <select aria-label="キーワードで絞り込み" value={keyword} onChange={e => setKeyword(e.target.value)}><option value="">すべてのキーワード</option>{keywords.map(value => <option value={value.id} key={value.id}>{value.name}</option>)}</select>
        <select aria-label="並べ替え" value={sort} onChange={e => setSort(e.target.value)}><option value="updated_at">更新日順</option><option value="created_at">登録日順</option><option value="title">タイトル順</option><option value="year">発行年順</option><option value="rating">評価順</option></select>
      </div>
      <div className="table-wrap"><table><thead><tr><th>状態</th><th>タイトル / 著者</th><th>発行年</th><th>ジャーナル</th><th>キーワード</th><th>評価</th><th>メモ</th><th>登録日</th></tr></thead>
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
        ><td className="status"><span className="tag" style={{...statusColors[paper.status], border: "0", fontWeight: 700}}>{paper.status}</span></td><td><span className="title-link">{paper.title}</span><div className="muted" title={paper.authors.join(" / ") || "著者未登録"} style={{whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "28rem"}}>{paper.authors.join(" / ") || "著者未登録"}</div></td><td>{paper.year ?? "—"}</td><td>{paper.journal || "—"}</td><td>{paper.keywords.map(value => <span className="tag" style={{borderLeft: `3px solid ${value.color}`}} key={value.id}>{value.name}</span>)}</td><td>{paper.rating ? "★".repeat(paper.rating) : "—"}</td><td>{paper.has_note ? "あり" : "—"}</td><td>{new Date(paper.created_at).toLocaleDateString("ja-JP")}</td></tr>)}</tbody>
      </table>{papers.length === 0 && <div className="empty">条件に一致する論文はありません。</div>}</div>
    </section>
  </main>;
}
