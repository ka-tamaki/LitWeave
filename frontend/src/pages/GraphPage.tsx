import cytoscape, {type Core} from "cytoscape";
import {useEffect, useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import {api} from "../api";
import type {Keyword, Paper} from "../types";
import {useTheme} from "../theme";

type GraphData = {nodes: cytoscape.ElementDefinition[]; edges: cytoscape.ElementDefinition[]; node_count: number; edge_count: number};

export default function GraphPage() {
  const {theme} = useTheme();
  const container = useRef<HTMLDivElement>(null); const instance = useRef<Core | null>(null); const navigate = useNavigate();
  const [mode, setMode] = useState("keyword"); const [status, setStatus] = useState(""); const [year, setYear] = useState(""); const [keyword, setKeyword] = useState(""); const [center, setCenter] = useState(""); const [depth, setDepth] = useState(1);
  const [keywords, setKeywords] = useState<Keyword[]>([]); const [papers, setPapers] = useState<Paper[]>([]); const [data, setData] = useState<GraphData>({nodes:[],edges:[],node_count:0,edge_count:0}); const [selected, setSelected] = useState<Record<string, unknown> | null>(null); const [error,setError]=useState("");
  useEffect(() => { Promise.all([api<Keyword[]>("/keywords"), api<Paper[]>("/papers")]).then(([a,b]) => {setKeywords(a);setPapers(b);}); }, []);
  useEffect(() => {
    const params = new URLSearchParams({mode,status,keyword_id:keyword,center_id:center,depth:String(depth)});
    if (year) params.set("year", year);
    api<GraphData>(`/graph?${params}`).then(setData).catch(error => setError(error.message));
  }, [mode,status,year,keyword,center,depth]);
  useEffect(() => {
    if (!container.current) return;
    instance.current?.destroy();
    const testing = import.meta.env.MODE === "test";
    const cy = cytoscape({
      container: testing ? undefined : container.current, headless: testing, elements: [...data.nodes,...data.edges],
      style: [
        {selector:'node[kind="paper"]',style:{label:"data(label)","background-color":theme === "dark" ? "#78a6df" : "#3f6c5d",color:theme === "dark" ? "#e7edf7" : "#26322d","font-size":"10px","text-wrap":"ellipsis","text-max-width":"130px","text-valign":"bottom","text-margin-y":8}},
        {selector:'node[kind="keyword"]',style:{label:"data(label)","background-color":"data(color)",color:theme === "dark" ? "#e7edf7" : "#26322d",shape:"round-rectangle",width:22,height:22,"font-size":"9px","text-valign":"bottom","text-margin-y":6}},
        {selector:"edge",style:{width:1.5,"line-color":theme === "dark" ? "#71829a" : "#a5b4ad","target-arrow-color":theme === "dark" ? "#71829a" : "#a5b4ad","target-arrow-shape":mode==="citation"?"triangle":"none","curve-style":"bezier"}},
        {selector:"node:selected",style:{"border-width":4,"border-color":"#d4a649"}},
      ],
      layout:{name:"cose",animate:false,padding:30},
    });
    cy.on("tap","node",event => setSelected(event.target.data()));
    instance.current = cy; return () => cy.destroy();
  }, [data,mode,theme]);
  return <main className="page">
    <header className="page-header"><div><p className="eyebrow">Knowledge graph</p><h1>ナレッジグラフ</h1><p className="muted">論文と概念のつながりを、間引かずに表示します。</p></div><div><strong>{data.node_count}</strong> ノード　<strong>{data.edge_count}</strong> 接続</div></header>
    {data.node_count > 1000 && <div className="readonly">ノード数が多いため表示に時間がかかる可能性があります。データは省略していません。</div>}{error && <div className="error">{error}</div>}
    <div className="toolbar">
      <select aria-label="グラフモード" value={mode} onChange={e=>setMode(e.target.value)}><option value="keyword">キーワードグラフ</option><option value="citation">引用グラフ</option></select>
      <select value={status} onChange={e=>setStatus(e.target.value)}><option value="">すべての状態</option>{["未読","読書中","既読","再確認"].map(value=><option key={value}>{value}</option>)}</select>
      <input type="number" placeholder="発行年" value={year} onChange={e=>setYear(e.target.value)} />
      <select value={keyword} onChange={e=>setKeyword(e.target.value)}><option value="">すべてのキーワード</option>{keywords.map(value=><option key={value.id} value={value.id}>{value.name}</option>)}</select>
      <select value={center} onChange={e=>setCenter(e.target.value)}><option value="">全体グラフ</option>{papers.map(value=><option key={value.id} value={value.id}>{value.title}</option>)}</select>
      {center && <select value={depth} onChange={e=>setDepth(Number(e.target.value))}>{[1,2,3].map(value=><option key={value} value={value}>深さ {value}</option>)}</select>}
      <button className="secondary" onClick={()=>instance.current?.fit(undefined,40)}>レイアウトを表示範囲へ</button>
    </div>
    <div className="graph-layout"><div ref={container} className="graph-canvas" aria-label="ナレッジグラフ"/><aside className="panel graph-info">{selected ? <><p className="eyebrow">{String(selected.kind)}</p><h2>{String(selected.label)}</h2>{selected.kind==="paper"&&<><p>{String(selected.status)}・{String(selected.year||"発行年未登録")}</p><button onClick={()=>navigate(`/papers/${String(selected.id)}`)}>論文詳細を開く</button></>}</>:<p className="muted">ノードを選ぶと概要を表示します。マウスホイールで拡大・縮小、ドラッグで移動できます。</p>}</aside></div>
  </main>;
}
