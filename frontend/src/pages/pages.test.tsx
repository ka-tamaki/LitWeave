import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {MemoryRouter, Route, Routes} from "react-router-dom";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import LibraryPage from "./LibraryPage";
import RegisterPage from "./RegisterPage";
import GraphPage from "./GraphPage";
import TrashPage from "./TrashPage";
import KeywordsPage from "./KeywordsPage";

const paper = {id:"1",display_id:"P000001",title:"Alpha paper",authors:["A. Author"],year:2025,journal:"Journal",volume:"",issue:"",pages:"",doi:"",url:"",language:"英語",abstract:"",rating:4,completed_date:null,remarks:"",status:"未読",status_history:[],created_at:"2026-01-01",updated_at:"2026-01-01",has_note:false,trashed:false,deleted_at:null,keywords:[]};
const keyword = {id:"keyword-1",name:"Carbon",color:"#112233"};

function response(value: unknown, status=200){return Promise.resolve(new Response(status===204?null:JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}}));}

describe("主要画面",()=>{
  beforeEach(()=>vi.stubGlobal("fetch",vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);
    if(url.includes("/keywords")&&init?.method==="POST")return response({id:"keyword-2",name:"New keyword",color:"#4f6f64"},201);
    if(url.includes("/keywords"))return response([keyword]);
    if(url.includes("/papers")&&init?.method==="POST")return response(paper,201);
    if(url.includes("/graph"))return response({nodes:[],edges:[],node_count:0,edge_count:0});
    if(url.includes("trashed=true"))return response([]);
    return response([paper]);
  })));
  afterEach(()=>vi.unstubAllGlobals());

  it("ライブラリを表形式で表示し検索と状態絞り込みができる",async()=>{
    render(<MemoryRouter initialEntries={["/library"]}><Routes><Route path="/library" element={<LibraryPage/>}/><Route path="/papers/:id" element={<div>論文詳細画面</div>}/></Routes></MemoryRouter>);
    expect(await screen.findByText("Alpha paper")).toBeInTheDocument();
    expect(screen.queryByLabelText("Alpha paperの状態")).not.toBeInTheDocument();
    const row=screen.getByRole("row",{name:"Alpha paperの詳細を開く"});
    expect(screen.getByText("A. Author")).toHaveStyle({whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"});
    fireEvent.change(screen.getByLabelText("論文を検索"),{target:{value:"alpha"}});
    fireEvent.change(screen.getByLabelText("状態で絞り込み"),{target:{value:"未読"}});
    await waitFor(()=>expect(fetch).toHaveBeenCalledWith(expect.stringContaining("q=alpha"),expect.any(Object)));
    fireEvent.click(row);
    expect(await screen.findByText("論文詳細画面")).toBeInTheDocument();
  });

  it("登録フォームはタイトルとPDFを必須にする",()=>{
    render(<MemoryRouter><RegisterPage readonly={false}/></MemoryRouter>);
    expect(screen.getByText("未読として登録")).toBeInTheDocument();
    const title=screen.getByLabelText("タイトル *");
    expect(title).toBeRequired();
    fireEvent.change(title,{target:{value:"Test paper"}});
    fireEvent.click(screen.getByText("未読として登録"));
    expect(screen.getByRole("alert")).toHaveTextContent("PDFファイル");
  });

  it("PDF確認の待機後も登録フォームを送信できる",async()=>{
    render(<MemoryRouter><RegisterPage readonly={false}/></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("タイトル *"),{target:{value:"Test paper"}});
    expect(await screen.findByText("Carbon")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Carbon"));
    const pdf=new File(["%PDF-test"],"test.pdf",{type:"application/pdf"});
    const input=document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!,{target:{files:[pdf]}});
    fireEvent.click(screen.getByText("未読として登録"));
    await waitFor(()=>expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/papers"),expect.objectContaining({method:"POST"})));
    const postCall=vi.mocked(fetch).mock.calls.find(([,init])=>init?.method==="POST");
    const body=postCall?.[1]?.body as FormData;
    expect(JSON.parse(String(body.get("keyword_ids")))).toEqual(["keyword-1"]);
    expect(body.has("keyword_names")).toBe(false);
    expect(body.has("year")).toBe(false);
  });

  it("グラフモードを切り替えられる",async()=>{
    render(<MemoryRouter><GraphPage/></MemoryRouter>);
    const select=screen.getByLabelText("グラフモード");
    fireEvent.change(select,{target:{value:"citation"}});
    await waitFor(()=>expect(fetch).toHaveBeenCalledWith(expect.stringContaining("mode=citation"),expect.any(Object)));
  });

  it("キーワード作成後に入力欄を初期化して一覧を再読込する",async()=>{
    render(<MemoryRouter><KeywordsPage readonly={false}/></MemoryRouter>);
    expect(await screen.findByText("Carbon")).toBeInTheDocument();
    const input=screen.getByPlaceholderText("新しいキーワード");
    fireEvent.change(input,{target:{value:"New keyword"}});
    fireEvent.click(screen.getByText("作成"));
    await waitFor(()=>expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/keywords"),expect.objectContaining({method:"POST"})));
    await waitFor(()=>expect(input).toHaveValue(""));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ごみ箱の空状態を表示する",async()=>{
    render(<MemoryRouter><TrashPage readonly={false}/></MemoryRouter>);
    expect(await screen.findByText("ごみ箱は空です。")).toBeInTheDocument();
  });
});
