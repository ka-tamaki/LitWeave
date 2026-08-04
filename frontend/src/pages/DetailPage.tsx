import {useEffect, useRef, useState} from "react";
import {Link, useNavigate, useParams} from "react-router-dom";
import {api} from "../api";
import {readPdfSignature} from "../pdf";
import type {Citation, Keyword, Paper} from "../types";
import KeywordSelector from "../components/KeywordSelector";
import MarkdownEditor from "../components/MarkdownEditor";
import MarkdownPreview from "../components/MarkdownPreview";

type Tab = "基本情報" | "メモ" | "タスク" | "引用" | "履歴";
type NoteView = "edit" | "preview";
const statuses = ["未読", "読書中", "既読", "再確認"];

export default function DetailPage({readonly}: {readonly: boolean}) {
  const {id = ""} = useParams(); const navigate = useNavigate();
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [tab, setTab] = useState<Tab>("基本情報");
  const [editingTaskId, setEditingTaskId] = useState("");
  const [note, setNote] = useState(""); const [savedNote, setSavedNote] = useState("");
  const [noteView, setNoteView] = useState<NoteView>("edit");
  const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
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
  async function addTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    try { await api(`/papers/${id}/tasks`, {method: "POST", body: JSON.stringify({title: data.get("title"), description: data.get("description")})}); form.reset(); setMessage("タスクを追加しました。"); load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "タスクの追加に失敗しました。"); }
  }
  async function saveTask(event: React.FormEvent<HTMLFormElement>, taskId: string) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try { await api(`/papers/${id}/tasks/${taskId}`, {method: "PATCH", body: JSON.stringify({title: data.get("title"), description: data.get("description")})}); setEditingTaskId(""); setMessage("タスクを保存しました。"); load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "タスクの保存に失敗しました。"); }
  }
  async function setTaskCompleted(taskId: string, completed: boolean) {
    try { await api(`/papers/${id}/tasks/${taskId}`, {method: "PATCH", body: JSON.stringify({completed})}); load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "タスクの更新に失敗しました。"); }
  }
  async function deleteTask(taskId: string, title: string) {
    if (!confirm(`タスク「${title}」を削除しますか？`)) return;
    try { await api(`/papers/${id}/tasks/${taskId}`, {method: "DELETE"}); setMessage("タスクを削除しました。"); load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "タスクの削除に失敗しました。"); }
  }
  function switchTab(value: Tab) { if (dirty && !confirm("メモが未保存です。保存せずに移動しますか？")) return; setTab(value); }
  async function addCitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const formElement = event.currentTarget;
    try { await api("/citations", {method: "POST", body: JSON.stringify({source_id: id, target_id: form.get("target_id"), note: form.get("note")})}); formElement.reset(); load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "引用関係の追加に失敗しました。"); }
  }
  async function moveToTrash() { if (!confirm(`${paper?.title}をごみ箱へ移動しますか？`)) return; try { await api(`/papers/${id}/trash`, {method: "POST"}); navigate("/library"); } catch (cause) { setError(cause instanceof Error ? cause.message : "移動に失敗しました。"); } }
  async function replacePdf(file?: File) {
    if (!file || !paper) return;
    setError(""); setMessage(""); setPdfBusy(true);
    try {
      if (await readPdfSignature(file) !== "%PDF-") throw new Error("有効なPDF形式ではありません。");
      if (!confirm(`「${paper.title}」のPDFを差し替えますか？\n現在のPDFは旧版として1世代保持されます。`)) return;
      const form = new FormData();
      form.set("pdf", file);
      const updated = await api<Paper>(`/papers/${id}/pdf`, {method: "POST", body: form});
      setPaper(updated);
      setMessage("PDFを差し替え、以前のPDFを1世代保存しました。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PDFの差し替えに失敗しました。");
    } finally {
      setPdfBusy(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  }
  if (!paper) return <main className="page">{error || "読み込み中…"}</main>;
  const related = citations.filter(value => value.source_id === id || value.target_id === id);
  return <main className="page">
    <header className="page-header"><div><p className="eyebrow">{paper.display_id}</p><h1>{paper.title}</h1><p className="muted">{paper.authors.join(" / ") || "著者未登録"}</p></div><div className="actions"><select value={paper.status} onChange={async e => {await api(`/papers/${id}`, {method: "PATCH", body: JSON.stringify({status: e.target.value})}); load();}} disabled={readonly}>{statuses.map(value => <option key={value}>{value}</option>)}</select><button onClick={() => api(`/papers/${id}/open`, {method: "POST"}).catch(error => setError(error.message))}>PDFを開く</button><input ref={pdfInputRef} hidden type="file" accept="application/pdf,.pdf" onChange={event => replacePdf(event.target.files?.[0])}/><button className="secondary" onClick={() => pdfInputRef.current?.click()} disabled={readonly || pdfBusy}>{pdfBusy ? "差し替え中…" : "PDFを差し替え"}</button></div></header>
    {error && <div className="error">{error}</div>}{message && <div className="success">{message}</div>}
    <div className="tabs" aria-label="論文詳細の表示項目">{(["基本情報","メモ","タスク","引用","履歴"] as Tab[]).map(value => <button type="button" className={tab === value ? "active" : ""} aria-pressed={tab === value} onClick={() => switchTab(value)} key={value}>{value}{value === "メモ" && dirty ? " ●" : ""}{value === "タスク" && (paper.tasks ?? []).some(task => !task.completed) ? ` (${(paper.tasks ?? []).filter(task => !task.completed).length})` : ""}</button>)}</div>
    {tab === "基本情報" && <form className="panel form-grid" onSubmit={saveBasic}>
      <label className="full">タイトル<input name="title" required defaultValue={paper.title} /></label><label className="full">著者<textarea name="authors" defaultValue={paper.authors.join("\n")} /></label>
      <label>発行年<input name="year" type="number" defaultValue={paper.year ?? ""} /></label><label>ジャーナル<input name="journal" defaultValue={paper.journal} /></label><label>巻<input name="volume" defaultValue={paper.volume} /></label><label>号<input name="issue" defaultValue={paper.issue} /></label><label>ページ<input name="pages" defaultValue={paper.pages} /></label><label>DOI<input name="doi" defaultValue={paper.doi} /></label><label>URL<input name="url" defaultValue={paper.url} /></label><label>言語<select name="language" defaultValue={paper.language}><option>日本語</option><option>英語</option><option>その他</option></select></label><label>評価<select name="rating" defaultValue={paper.rating ?? ""}><option value="">未評価</option>{[1,2,3,4,5].map(value => <option key={value}>{value}</option>)}</select></label><label>読了日<input name="completed_date" type="date" defaultValue={paper.completed_date ?? ""} /></label>
      <KeywordSelector key={paper.id} keywords={keywords} selectedIds={paper.keywords.map(value => value.id)} />
      <div className="full actions"><button disabled={readonly}>保存</button><button type="button" className="danger" disabled={readonly} onClick={moveToTrash}>ごみ箱へ移動</button></div>
    </form>}
    {tab === "メモ" && <section className="panel"><div className="page-header"><div><strong>定型Markdownメモ</strong><p className="muted">Markdownの色分け、箇条書き継続、Tabインデント、検索、元に戻す／やり直しを利用できます。Ctrl+B: 太字、Ctrl+I: 斜体、Ctrl+K: リンク。</p></div><span className={dirty ? "unsaved" : "muted"}>{dirty ? "未保存" : "保存済み"}</span></div><div className="note-view-switch" aria-label="メモ表示"><button type="button" className={noteView === "edit" ? "active" : ""} aria-pressed={noteView === "edit"} onClick={() => setNoteView("edit")}>編集</button><button type="button" className={noteView === "preview" ? "active" : ""} aria-pressed={noteView === "preview"} onClick={() => setNoteView("preview")}>プレビュー</button></div>{noteView === "edit" ? <MarkdownEditor value={note} onChange={setNote} onSave={() => {if (!readonly && dirty) void saveNote();}} readonly={readonly} /> : <MarkdownPreview content={note} />}<div className="actions"><button onClick={saveNote} disabled={readonly || !dirty}>保存（Ctrl+S）</button></div></section>}
    {tab === "タスク" && <section className="panel stack"><form className="task-form" onSubmit={addTask}><label>タイトル<input name="title" required maxLength={200} placeholder="例: 関連論文を確認する" /></label><label>詳細<textarea name="description" maxLength={4000} placeholder="確認する箇所や目的を記入" /></label><button disabled={readonly}>追加</button></form><div className="task-list">{(paper.tasks ?? []).map(task => editingTaskId === task.id ? <form className="task-edit-form" key={task.id} onSubmit={event => saveTask(event, task.id)}><label>タイトル<input name="title" required maxLength={200} defaultValue={task.title} /></label><label>詳細<textarea name="description" maxLength={4000} defaultValue={task.description} /></label><div className="actions"><button disabled={readonly}>保存</button><button type="button" className="secondary" onClick={() => setEditingTaskId("")}>キャンセル</button></div></form> : <div className={`task-item ${task.completed ? "completed" : ""}`} key={task.id}><label><input type="checkbox" checked={task.completed} disabled={readonly} onChange={event => setTaskCompleted(task.id, event.target.checked)} /><span><strong>{task.title}</strong>{task.description && <small>{task.description}</small>}</span></label><div className="task-actions"><button type="button" className="text-button" disabled={readonly} onClick={() => setEditingTaskId(task.id)}>編集</button><button type="button" className="text-button" disabled={readonly} onClick={() => deleteTask(task.id, task.title)}>削除</button></div></div>)}{(paper.tasks ?? []).length === 0 && <p className="muted">タスクはありません。</p>}</div></section>}
    {tab === "引用" && <div className="detail-grid"><form className="panel stack" onSubmit={addCitation}><strong>引用先を追加</strong><label>この論文が引用する論文<select required name="target_id" defaultValue=""><option value="" disabled>選択してください</option>{papers.filter(value => value.id !== id).map(value => <option value={value.id} key={value.id}>{value.display_id} {value.title}</option>)}</select></label><label>補足メモ<textarea name="note" /></label><button disabled={readonly}>引用関係を追加</button></form><section className="panel"><strong>登録済みの引用関係</strong>{related.map(value => {const other = papers.find(p => p.id === (value.source_id === id ? value.target_id : value.source_id)); return <div key={value.id} style={{padding: ".8rem 0", borderBottom: "1px solid #ddd"}}><small>{value.source_id === id ? "引用先 →" : "← 引用元"}</small><br/><Link to={`/papers/${other?.id}`}>{other?.title}</Link><p>{value.note}</p><button className="text-button" disabled={readonly} onClick={async () => {await api(`/citations/${value.id}`, {method:"DELETE"}); load();}}>削除</button></div>;})}{related.length === 0 && <p className="muted">引用関係はまだありません。</p>}</section></div>}
    {tab === "履歴" && <section className="panel"><table><thead><tr><th>内容</th><th>変更日時</th></tr></thead><tbody>{paper.pdf_replaced_at && <tr><td>PDF差し替え</td><td>{new Date(paper.pdf_replaced_at).toLocaleString("ja-JP")}</td></tr>}{paper.status_history.map((value,index) => <tr key={index}><td>読書状態: {value.status}</td><td>{new Date(value.changed_at).toLocaleString("ja-JP")}</td></tr>)}</tbody></table></section>}
  </main>;
}
