import {useEffect,useState} from "react";
import {api} from "../api";
import type {Paper} from "../types";

export default function TrashPage({readonly}:{readonly:boolean}){
  const [papers,setPapers]=useState<Paper[]>([]);const [error,setError]=useState("");
  const load=()=>api<Paper[]>("/papers?trashed=true").then(setPapers).catch(error=>setError(error.message));useEffect(()=>{void load();},[]);
  async function restore(value:Paper){try{await api(`/papers/${value.id}/restore`,{method:"POST"});load();}catch(cause){setError(cause instanceof Error?cause.message:"復元に失敗しました。");}}
  async function remove(value:Paper){if(!confirm(`${value.display_id} ${value.title}を完全削除します。PDF、メモ、この論文を含む引用関係は元に戻せません。続行しますか？`))return;try{await api(`/papers/${value.id}`,{method:"DELETE"});load();}catch(cause){setError(cause instanceof Error?cause.message:"完全削除に失敗しました。");}}
  return <main className="page"><header className="page-header"><div><p className="eyebrow">Trash</p><h1>ごみ箱</h1><p className="muted">移動した論文を復元するか、内容を確認して完全削除します。</p></div></header>{error&&<div className="error">{error}</div>}<div className="table-wrap" style={{borderTop:"1px solid #dde2dd"}}><table><thead><tr><th>論文</th><th>削除日時</th><th>操作</th></tr></thead><tbody>{papers.map(value=><tr key={value.id}><td><strong>{value.display_id} {value.title}</strong></td><td>{value.deleted_at?new Date(value.deleted_at).toLocaleString("ja-JP"):"—"}</td><td><div className="actions" style={{margin:0}}><button disabled={readonly} onClick={()=>restore(value)}>元に戻す</button><button className="danger" disabled={readonly} onClick={()=>remove(value)}>完全削除</button></div></td></tr>)}</tbody></table>{papers.length===0&&<div className="empty">ごみ箱は空です。</div>}</div></main>;
}
