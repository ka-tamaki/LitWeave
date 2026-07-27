import {useEffect, useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import {api, ApiError} from "../api";
import {readPdfSignature} from "../pdf";
import type {Keyword} from "../types";
import KeywordSelector from "../components/KeywordSelector";

type DuplicateCandidate = {
  id: string;
  display_id: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string;
  reasons: string[];
  trashed: boolean;
};
type DuplicateWarning = {
  message: string;
  code: "identical_pdf" | "metadata_duplicate";
  candidates: DuplicateCandidate[];
};

export default function RegisterPage({readonly}: {readonly: boolean}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [error, setError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateWarning | null>(null);
  useEffect(() => {
    api<Keyword[]>("/keywords")
      .then(setKeywords)
      .catch(cause => setError(cause instanceof Error ? cause.message : "キーワード一覧を読み込めませんでした。"));
  }, []);
  function duplicateFrom(cause: unknown): DuplicateWarning | null {
    if (!(cause instanceof ApiError) || cause.status !== 409 || !cause.detail || typeof cause.detail !== "object") return null;
    const detail = cause.detail as Partial<DuplicateWarning>;
    if ((detail.code !== "identical_pdf" && detail.code !== "metadata_duplicate") || !Array.isArray(detail.candidates)) return null;
    return {message: String(detail.message || cause.message), code: detail.code, candidates: detail.candidates};
  }
  async function upload(allowMetadataDuplicate: boolean) {
    const formElement = formRef.current;
    if (!formElement || !file) return;
    setBusy(true);
    setError("");
    setDuplicateWarning(null);
    setProgressMessage("Box Driveへ保存中…");
    try {
      const form = new FormData(formElement);
      form.set("pdf", file);
      form.set("authors", JSON.stringify(String(form.get("author_text") || "").split(/\r?\n|;/).map(value => value.trim()).filter(Boolean)));
      form.set("keyword_ids", JSON.stringify(form.getAll("keyword_ids").map(String)));
      form.set("allow_metadata_duplicate", String(allowMetadataDuplicate));
      if (!String(form.get("year") || "").trim()) form.delete("year");
      form.delete("author_text");
      const paper = await api<{id: string}>("/papers", {method: "POST", body: form});
      navigate(`/papers/${paper.id}`);
    } catch (cause) {
      const duplicate = duplicateFrom(cause);
      if (duplicate) setDuplicateWarning(duplicate);
      else setError(cause instanceof Error ? cause.message : "登録に失敗しました。");
    } finally {
      setBusy(false);
      setProgressMessage("");
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError("");
    setDuplicateWarning(null);
    if (!formElement.checkValidity()) {
      setError("必須項目または入力形式を確認してください。");
      formElement.reportValidity();
      return;
    }
    if (!file) { setError("PDFファイルを選択してください。"); return; }
    setBusy(true);
    setProgressMessage("PDFを確認中…");
    try {
      const signature = await readPdfSignature(file);
      if (signature !== "%PDF-") {
        setError("有効なPDF形式ではありません。");
        return;
      }
    } catch (cause) {
      if (cause instanceof DOMException) {
        setError(`PDFを読み出せません（${cause.name}）。PDFを開いているアプリを閉じ、Box外のローカルフォルダーへコピーして、そのコピーを選び直してください。`);
      } else {
        setError(cause instanceof Error ? cause.message : "PDFの確認に失敗しました。");
      }
      return;
    } finally {
      setBusy(false);
      setProgressMessage("");
    }
    await upload(false);
  }
  async function replaceExisting(candidate: DuplicateCandidate) {
    if (!file || !confirm(`${candidate.display_id}「${candidate.title}」の現在のPDFを差し替えますか？\n現在のPDFは旧版として1世代保持されます。`)) return;
    setBusy(true); setError(""); setDuplicateWarning(null); setProgressMessage("現在のPDFを退避して差し替え中…");
    try {
      const form = new FormData();
      form.set("pdf", file);
      const paper = await api<{id: string}>(`/papers/${candidate.id}/pdf`, {method: "POST", body: form});
      navigate(`/papers/${paper.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PDFの差し替えに失敗しました。");
    } finally {
      setBusy(false); setProgressMessage("");
    }
  }
  function accept(value?: File) { if (value) { setFile(value); setError(""); setDuplicateWarning(null); } }
  const errorHelp = error.startsWith("PDFを読み出せません")
    ? "Box上の元ファイルを使う場合は「常にこのデバイスに保持」が完了してから、ファイルを選択し直してください。"
    : error.startsWith("必須項目")
      ? "タイトルを入力し、発行年やURLを入力した場合は形式が正しいか確認してください。"
      : error.startsWith("入力内容を確認") || error.includes("発行年")
        ? "発行年を入力する場合は、1000～9999の整数にしてください。空欄でも登録できます。"
      : error.includes("PDF")
        ? "PDFファイルを選び直してから再試行してください。"
        : "接続切断の場合はLitWeaveとBox Driveが起動中か確認してください。";
  return <main className="page">
    <header className="page-header"><div><p className="eyebrow">Add paper</p><h1>論文登録</h1><p className="muted">PDFを確認してから、書誌情報とともに安全に保存します。</p></div></header>
    <form ref={formRef} className="panel" onSubmit={submit} noValidate>
      <div className={`dropzone ${dragging ? "active" : ""}`} onDragOver={e => {e.preventDefault(); setDragging(true);}} onDragLeave={() => setDragging(false)} onDrop={e => {e.preventDefault(); setDragging(false); accept(e.dataTransfer.files[0]);}}>
        <input ref={inputRef} hidden type="file" accept="application/pdf,.pdf" onChange={e => accept(e.target.files?.[0])} />
        <strong>{file ? file.name : "PDFをここへドロップ"}</strong>{file && <p className="muted">{(file.size / 1024 / 1024).toFixed(1)} MB</p>}<p className="muted">または</p><button type="button" className="secondary" onClick={() => inputRef.current?.click()}>PDFファイルを選択</button>
      </div>
      <div className="form-grid" style={{marginTop: "1.5rem"}}>
        <label className="full">タイトル *<input name="title" required /></label>
        <label className="full">著者（1行に1名、またはセミコロン区切り）<textarea name="author_text" /></label>
        <label>発行年<input name="year" type="number" min="1000" max="9999" /></label>
        <label>ジャーナル<input name="journal" /></label>
        <label>DOI<input name="doi" placeholder="10.xxxx/..." /></label>
        <label>URL<input name="url" type="url" /></label>
        <label>言語<select name="language"><option>日本語</option><option>英語</option><option>その他</option></select></label>
        <KeywordSelector keywords={keywords} />
      </div>
      {duplicateWarning && <section className="duplicate-warning" role="alert">
        <strong>{duplicateWarning.code === "identical_pdf" ? "同一PDFは登録できません" : "重複の可能性があります"}</strong>
        <p>{duplicateWarning.message}</p>
        <div className="duplicate-list">{duplicateWarning.candidates.map(candidate => <article key={candidate.id}>
          <div><strong>{candidate.display_id} {candidate.title}</strong><small>{candidate.authors.join(" / ") || "著者未登録"}{candidate.year ? `・${candidate.year}年` : ""}</small><small>{candidate.reasons.join("、")}</small></div>
          <div className="actions">
            <button type="button" className="secondary" onClick={() => navigate(candidate.trashed ? "/trash" : `/papers/${candidate.id}`)}>{candidate.trashed ? "ごみ箱を確認" : "既存論文を開く"}</button>
            {duplicateWarning.code === "metadata_duplicate" && <button type="button" onClick={() => replaceExisting(candidate)} disabled={readonly || busy}>この論文のPDFを差し替える</button>}
          </div>
        </article>)}</div>
        <div className="actions">
          {duplicateWarning.code === "metadata_duplicate" && <button type="button" onClick={() => upload(true)} disabled={readonly || busy}>別論文として登録する</button>}
          <button type="button" className="secondary" onClick={() => setDuplicateWarning(null)}>登録を中止する</button>
        </div>
      </section>}
      {error && <div className="error" role="alert">{error}<small>{errorHelp}</small></div>}
      {busy && <div role="status" aria-live="polite"><p className="muted">{progressMessage}</p><div className="progress" aria-label="登録処理中"><span /></div></div>}
      <div className="actions"><button disabled={readonly || busy}>{busy ? "登録中…" : "未読として登録"}</button><button type="button" className="secondary" onClick={() => navigate("/library")}>キャンセル</button></div>
    </form>
  </main>;
}
