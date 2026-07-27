import {useEffect, useState} from "react";
import {Link} from "react-router-dom";
import {api} from "../api";
import type {Keyword, Paper} from "../types";

export default function KeywordsPage({readonly}: {readonly:boolean}) {
  const [keywords,setKeywords]=useState<Keyword[]>([]); const [papers,setPapers]=useState<Paper[]>([]); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  const load=()=>Promise.all([api<Keyword[]>("/keywords"),api<Paper[]>("/papers")]).then(([a,b])=>{setKeywords(a);setPapers(b);}).catch(error=>setError(error.message));
  useEffect(()=>{void load();},[]);
  async function create(event:React.FormEvent<HTMLFormElement>){event.preventDefault();const formElement=event.currentTarget;const form=new FormData(formElement);setBusy(true);setError("");try{await api("/keywords",{method:"POST",body:JSON.stringify(Object.fromEntries(form))});formElement.reset();await load();}catch(cause){setError(cause instanceof Error?cause.message:"作成に失敗しました。");}finally{setBusy(false);}}
  async function edit(value:Keyword){const name=prompt("新しいキーワード名",value.name);if(name===null)return;const color=prompt("色（#RRGGBB）",value.color);if(color===null)return;try{await api(`/keywords/${value.id}`,{method:"PATCH",body:JSON.stringify({name,color})});load();}catch(cause){setError(cause instanceof Error?cause.message:"更新に失敗しました。");}}
  async function merge(value:Keyword){const target=prompt(`統合先のキーワードID\n${keywords.filter(v=>v.id!==value.id).map(v=>`${v.name}: ${v.id}`).join("\n")}`);if(!target)return;try{await api(`/keywords/${value.id}/merge`,{method:"POST",body:JSON.stringify({target_id:target})});load();}catch(cause){setError(cause instanceof Error?cause.message:"統合に失敗しました。");}}
  async function remove(value:Keyword){if(!confirm(`${value.name}を削除しますか？`))return;try{await api(`/keywords/${value.id}`,{method:"DELETE"});load();}catch(cause){setError(cause instanceof Error?cause.message:"削除に失敗しました。");}}
  return <main className="page"><header className="page-header"><div><p className="eyebrow">Keywords</p><h1>キーワード管理</h1><p className="muted">表記を揃え、論文を横断する概念を育てます。</p></div></header>{error&&<div className="error">{error}</div>}
    <form className="toolbar" onSubmit={create}><input required name="name" placeholder="新しいキーワード"/><label>色 <input name="color" type="color" defaultValue="#4f6f64"/></label><button disabled={readonly||busy}>{busy?"作成中…":"作成"}</button></form>
    <div className="table-wrap"><table><thead><tr><th>色</th><th>キーワード</th><th>使用論文</th><th>操作</th></tr></thead><tbody>{keywords.map(value=><tr key={value.id}><td><span style={{display:"block",width:24,height:24,borderRadius:7,background:value.color}}/></td><td><strong>{value.name}</strong></td><td>{papers.filter(p=>value.paper_ids?.includes(p.id)).map(p=><div key={p.id}><Link to={`/papers/${p.id}`}>{p.title}</Link></div>)}{value.usage_count===0&&"未使用"}</td><td><div className="actions" style={{margin:0}}><button className="secondary" disabled={readonly} onClick={()=>edit(value)}>名前・色変更</button><button className="secondary" disabled={readonly} onClick={()=>merge(value)}>統合</button><button className="danger" disabled={readonly||Boolean(value.usage_count)} onClick={()=>remove(value)}>削除</button></div></td></tr>)}</tbody></table>{keywords.length===0&&<div className="empty">キーワードはまだありません。</div>}</div>
  </main>;
}
