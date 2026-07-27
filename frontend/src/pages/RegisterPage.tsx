import {useEffect, useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import {api} from "../api";
import type {Keyword} from "../types";

async function readPdfSignature(file: File) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      file.slice(0, 5).arrayBuffer().then(value => new TextDecoder("ascii").decode(value)),
      new Promise<string>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new DOMException("PDFの読み出しがタイムアウトしました。", "TimeoutError")),
          15_000,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export default function RegisterPage({readonly}: {readonly: boolean}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api<Keyword[]>("/keywords")
      .then(setKeywords)
      .catch(cause => setError(cause instanceof Error ? cause.message : "キーワード一覧を読み込めませんでした。"));
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError("");
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
      const form = new FormData(formElement);
      form.set("pdf", file);
      form.set("authors", JSON.stringify(String(form.get("author_text") || "").split(/\r?\n|;/).map(value => value.trim()).filter(Boolean)));
      form.set("keyword_ids", JSON.stringify(form.getAll("keyword_ids").map(String)));
      if (!String(form.get("year") || "").trim()) form.delete("year");
      form.delete("author_text");
      setProgressMessage("Box Driveへ保存中…");
      const paper = await api<{id: string}>("/papers", {method: "POST", body: form});
      navigate(`/papers/${paper.id}`);
    } catch (cause) {
      if (cause instanceof DOMException) {
        setError(`PDFを読み出せません（${cause.name}）。PDFを開いているアプリを閉じ、Box外のローカルフォルダーへコピーして、そのコピーを選び直してください。`);
      } else {
        setError(cause instanceof Error ? cause.message : "登録に失敗しました。");
      }
    } finally {
      setBusy(false);
      setProgressMessage("");
    }
  }
  function accept(value?: File) { if (value) { setFile(value); setError(""); } }
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
    <form className="panel" onSubmit={submit} noValidate>
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
        <fieldset className="full keyword-field">
          <legend>キーワード</legend>
          {keywords.length > 0
            ? <div className="keyword-options">{keywords.map(value => <label className="tag" key={value.id}><input type="checkbox" name="keyword_ids" value={value.id} /> {value.name}</label>)}</div>
            : <p className="muted">登録済みのキーワードはありません。先に「キーワード管理」で作成してください。</p>}
          <small className="muted">「キーワード管理」で登録したキーワードから選択します。複数選択できます。</small>
        </fieldset>
        <label className="full">要旨<textarea name="abstract" /></label>
        <label className="full">備考<textarea name="remarks" /></label>
      </div>
      {error && <div className="error" role="alert">{error}<small>{errorHelp}</small></div>}
      {busy && <div role="status" aria-live="polite"><p className="muted">{progressMessage}</p><div className="progress" aria-label="登録処理中"><span /></div></div>}
      <div className="actions"><button disabled={readonly || busy}>{busy ? "登録中…" : "未読として登録"}</button><button type="button" className="secondary" onClick={() => navigate("/library")}>キャンセル</button></div>
    </form>
  </main>;
}
