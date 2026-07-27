import {useEffect, useState} from "react";
import {Link, useNavigate, useParams} from "react-router-dom";
import {api} from "../api";
import type {Citation, Keyword, Paper} from "../types";

type Tab = "基本情報" | "メモ" | "引用" | "履歴";
const statuses = ["未読", "読書中", "既読", "再確認"];

export default function DetailPage({readonly}: {readonly: boolean}) {
  const {id = ""} = useParams(); const navigate = useNavigate();
  const [paper, setPaper] = useState<Paper | null>(null);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [tab, setTab] = useState<Tab>("基本情報");
  const [note, setNote] = useState(""); const [savedNote, setSavedNote] = useState("");
  const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const dirty = note !== savedNote;
  const load = async () => {
    try {
      const [value, allKeywords, allPapers, allCitations] = await Promise.all([api<Paper>(`/papers/${id}`), api<Keyword[]>("/keywords"), api<Paper[]>("/papers"), api<Citation[]>("/citations")]);
      setPaper(value); setKeywords(allKeywords); setPapers(allPapers); setCitations(allCitations);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "読み込みに失敗しました。"); }
  };
  useEffect(() => { load(); api<{content: string}>(`/papers/${id}/note`).then(value => {setNote(value.content); setSavedNote(value.content);}); }, [id]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    const keys = (event: KeyboardEvent) => { if (event.ctrlKey && event.key.toLowerCase() === "s") { event.preventDefault(); if (tab === "メモ") saveNote(); } };
    window.addEventListener("beforeunload", before); window.addEventListener("keydown", keys);
    return () => {window.removeEventListener("beforeunload", before); window.removeEventListener("keydown", keys);};
  }, [dirty, tab, note]);
  async function saveBasic(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form);
    const body = {...values, authors: String(values.authors).split(/\r?\n|;/).map(value => value.trim()).filter(Boolean), year: values.year ? Number(values.year) : null, rating: values.rating ? Number(values.rating) : null, keyword_ids: form.getAll("keyword_ids")};
    try { await api(`/papers/${id}`, {method: "PATCH", body: JSON.stringify(body)}); setMessage("書誌情報を保存しました。"); load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "保存に失敗しました。"); }
  }
  async function saveNote() { try { await api(`/papers/${id}/note`, {method: "PUT", body: JSON.stringify({content: note})}); setSavedNote(note); setMessage("メモを保存しました。"); load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "保存に失敗しました。"); } }
  function switchTab(value: Tab) { if (dirty && !confirm("メモが未保存です。保存せずに移動しますか？")) return; setTab(value); }
  async function addCitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const formElement = event.currentTarget;
    try { await api("/citations", {method: "POST", body: JSON.stringify({source_id: id, target_id: form.get("target_id"), note: form.get("note")})}); formElement.reset(); load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "引用関係の追加に失敗しました。"); }
  }
  async function moveToTrash() { if (!confirm(`${paper?.title}をごみ箱へ移動しますか？`)) return; try { await api(`/papers/${id}/trash`, {method: "POST"}); navigate("/library"); } catch (cause) { setError(cause instanceof Error ? cause.message : "移動に失敗しました。"); } }
  if (!paper) return <main className="page">{error || "読み込み中…"}</main>;
  const related = citations.filter(value => value.source_id === id || value.target_id === id);
  return <main className="page">
    <header className="page-header"><div><p className="eyebrow">{paper.display_id}</p><h1>{paper.title}</h1><p className="muted">{paper.authors.join(" / ") || "著者未登録"}</p></div><div className="actions"><select value={paper.status} onChange={async e => {await api(`/papers/${id}`, {method: "PATCH", body: JSON.stringify({status: e.target.value})}); load();}} disabled={readonly}>{statuses.map(value => <option key={value}>{value}</option>)}</select><button onClick={() => api(`/papers/${id}/open`, {method: "POST"}).catch(error => setError(error.message))}>PDFを開く</button></div></header>
    {error && <div className="error">{error}</div>}{message && <div className="success">{message}</div>}
    <div className="tabs">{(["基本情報","メモ","引用","履歴"] as Tab[]).map(value => <button className={tab === value ? "active" : ""} onClick={() => switchTab(value)} key={value}>{value}{value === "メモ" && dirty ? " ●" : ""}</button>)}</div>
    {tab === "基本情報" && <form className="panel form-grid" onSubmit={saveBasic}>
      <label className="full">タイトル<input name="title" required defaultValue={paper.title} /></label><label className="full">著者<textarea name="authors" defaultValue={paper.authors.join("\n")} /></label>
      <label>発行年<input name="year" type="number" defaultValue={paper.year ?? ""} /></label><label>ジャーナル<input name="journal" defaultValue={paper.journal} /></label><label>巻<input name="volume" defaultValue={paper.volume} /></label><label>号<input name="issue" defaultValue={paper.issue} /></label><label>ページ<input name="pages" defaultValue={paper.pages} /></label><label>DOI<input name="doi" defaultValue={paper.doi} /></label><label>URL<input name="url" defaultValue={paper.url} /></label><label>言語<select name="language" defaultValue={paper.language}><option>日本語</option><option>英語</option><option>その他</option></select></label><label>評価<select name="rating" defaultValue={paper.rating ?? ""}><option value="">未評価</option>{[1,2,3,4,5].map(value => <option key={value}>{value}</option>)}</select></label><label>読了日<input name="completed_date" type="date" defaultValue={paper.completed_date ?? ""} /></label>
      <label className="full">キーワード<div>{keywords.map(value => <label className="tag" key={value.id}><input type="checkbox" name="keyword_ids" value={value.id} defaultChecked={paper.keywords.some(item => item.id === value.id)} /> {value.name}</label>)}</div></label>
      <label className="full">要旨<textarea name="abstract" defaultValue={paper.abstract} /></label><label className="full">備考<textarea name="remarks" defaultValue={paper.remarks} /></label><div className="full actions"><button disabled={readonly}>保存</button><button type="button" className="danger" disabled={readonly} onClick={moveToTrash}>ごみ箱へ移動</button></div>
    </form>}
    {tab === "メモ" && <section className="panel"><div className="page-header"><div><strong>定型Markdownメモ</strong><p className="muted">各見出しは折りたたみの目印として維持できます。Markdown中のHTMLは画面上で実行しません。</p></div><span className={dirty ? "unsaved" : "muted"}>{dirty ? "未保存" : "保存済み"}</span></div><textarea aria-label="Markdownメモ" className="note-editor" value={note} onChange={e => setNote(e.target.value)} /><div className="actions"><button onClick={saveNote} disabled={readonly || !dirty}>保存（Ctrl+S）</button></div></section>}
    {tab === "引用" && <div className="detail-grid"><form className="panel stack" onSubmit={addCitation}><strong>引用先を追加</strong><label>この論文が引用する論文<select required name="target_id" defaultValue=""><option value="" disabled>選択してください</option>{papers.filter(value => value.id !== id).map(value => <option value={value.id} key={value.id}>{value.display_id} {value.title}</option>)}</select></label><label>補足メモ<textarea name="note" /></label><button disabled={readonly}>引用関係を追加</button></form><section className="panel"><strong>登録済みの引用関係</strong>{related.map(value => {const other = papers.find(p => p.id === (value.source_id === id ? value.target_id : value.source_id)); return <div key={value.id} style={{padding: ".8rem 0", borderBottom: "1px solid #ddd"}}><small>{value.source_id === id ? "引用先 →" : "← 引用元"}</small><br/><Link to={`/papers/${other?.id}`}>{other?.title}</Link><p>{value.note}</p><button className="text-button" disabled={readonly} onClick={async () => {await api(`/citations/${value.id}`, {method:"DELETE"}); load();}}>削除</button></div>;})}{related.length === 0 && <p className="muted">引用関係はまだありません。</p>}</section></div>}
    {tab === "履歴" && <section className="panel"><table><thead><tr><th>状態</th><th>変更日時</th></tr></thead><tbody>{paper.status_history.map((value,index) => <tr key={index}><td>{value.status}</td><td>{new Date(value.changed_at).toLocaleString("ja-JP")}</td></tr>)}</tbody></table></section>}
  </main>;
}
