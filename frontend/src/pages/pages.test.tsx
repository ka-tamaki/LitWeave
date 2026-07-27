import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {MemoryRouter, Route, Routes} from "react-router-dom";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import HomePage from "./HomePage";
import RegisterPage from "./RegisterPage";
import GraphPage from "./GraphPage";
import TrashPage from "./TrashPage";
import KeywordsPage from "./KeywordsPage";

const paper = {id:"1",display_id:"P000001",title:"Alpha paper",authors:["A. Author"],year:2025,journal:"Journal",volume:"",issue:"",pages:"",doi:"",url:"",language:"英語",abstract:"",rating:4,completed_date:null,remarks:"",status:"未読",status_history:[],created_at:"2026-01-01",updated_at:"2026-01-01",has_note:false,trashed:false,deleted_at:null,keywords:[],tasks:[{id:"task-1",paper_id:"1",title:"関連論文を読む",description:"方法と結果を比較する",completed:false,created_at:"2026-01-01",updated_at:"2026-01-01"}]};
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

  it("ホームに論文を表形式で表示し検索と状態絞り込みができる",async()=>{
    render(<MemoryRouter initialEntries={["/home"]}><Routes><Route path="/home" element={<HomePage/>}/><Route path="/papers/:id" element={<div>論文詳細画面</div>}/></Routes></MemoryRouter>);
    expect(await screen.findByText("Alpha paper")).toBeInTheDocument();
    expect(screen.getByRole("heading",{name:"ホーム"})).toBeInTheDocument();
    expect(screen.queryByRole("columnheader",{name:"ジャーナル"})).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader",{name:"メモ"})).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Alpha paperの状態")).not.toBeInTheDocument();
    const row=screen.getByRole("row",{name:"Alpha paperの詳細を開く"});
    expect(screen.getByText("Alpha paper")).toHaveClass("title-link");
    expect(screen.getByText("Alpha paper")).toHaveAttribute("title","Alpha paper");
    expect(screen.getByText("A. Author")).toHaveStyle({whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"});
    expect(screen.getByLabelText("評価 4 / 5")).toHaveTextContent("★★★★☆");
    expect(screen.queryByLabelText("並べ替え")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("論文を検索"),{target:{value:"alpha"}});
    fireEvent.change(screen.getByLabelText("状態で絞り込み"),{target:{value:"未読"}});
    await waitFor(()=>expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/q=alpha.*sort=updated_at/),expect.any(Object)));
    fireEvent.click(row);
    expect(await screen.findByText("論文詳細画面")).toBeInTheDocument();
  });

  it("ホーム内のタスク表にタイトルと詳細を表示する",async()=>{
    render(<MemoryRouter><HomePage readonly={false}/></MemoryRouter>);
    expect(await screen.findByText("Alpha paper")).toBeInTheDocument();
    expect(await screen.findByText("関連論文を読む")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader",{name:"タスク"})).not.toBeInTheDocument();
    expect(screen.queryByText("論文ごとの次のアクションをまとめて確認します。")).not.toBeInTheDocument();
    expect(screen.queryByText("未完了 1件")).not.toBeInTheDocument();
    expect(screen.getByText("方法と結果を比較する")).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"P000001 Alpha paper"})).toHaveAttribute("href","/papers/1");
    fireEvent.click(screen.getByLabelText("関連論文を読むを完了"));
    await waitFor(()=>expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/papers/1/tasks/task-1"),expect.objectContaining({method:"PATCH"})));
  });

  it("登録フォームはタイトルとPDFを必須にする",()=>{
    render(<MemoryRouter><RegisterPage readonly={false}/></MemoryRouter>);
    expect(screen.getByText("未読として登録")).toBeInTheDocument();
    const title=screen.getByLabelText("タイトル *");
    expect(title).toBeRequired();
    expect(screen.queryByLabelText("要旨")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("備考")).not.toBeInTheDocument();
    fireEvent.change(title,{target:{value:"Test paper"}});
    fireEvent.click(screen.getByText("未読として登録"));
    expect(screen.getByRole("alert")).toHaveTextContent("PDFファイル");
  });

  it("PDF確認の待機後も登録フォームを送信できる",async()=>{
    render(<MemoryRouter><RegisterPage readonly={false}/></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("タイトル *"),{target:{value:"Test paper"}});
    expect(await screen.findByText("Carbon")).toBeInTheDocument();
    const carbon=screen.getByLabelText("Carbon");
    fireEvent.click(carbon);
    expect(carbon).toBeChecked();
    expect(carbon.closest("label")).toHaveClass("selected");
    expect(screen.getByText("1件選択")).toBeInTheDocument();
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

  it("書誌情報の重複候補から別論文として登録できる",async()=>{
    vi.mocked(fetch).mockImplementation((input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.includes("/keywords"))return response([]);
      if(url.includes("/papers")&&init?.method==="POST"){
        const form=init.body as FormData;
        if(form.get("allow_metadata_duplicate")==="true")return response(paper,201);
        return response({detail:{message:"既存論文と書誌情報が一致しています。",code:"metadata_duplicate",candidates:[{id:"1",display_id:"P000001",title:"Alpha paper",authors:["A. Author"],year:2025,doi:"10.1000/test",reasons:["DOI一致"],trashed:false}]}},409);
      }
      return response([]);
    });
    render(<MemoryRouter><RegisterPage readonly={false}/></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("タイトル *"),{target:{value:"Alpha paper"}});
    const pdf=new File(["%PDF-new"],"new.pdf",{type:"application/pdf"});
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!,{target:{files:[pdf]}});
    fireEvent.click(screen.getByText("未読として登録"));
    expect(await screen.findByText("重複の可能性があります")).toBeInTheDocument();
    expect(screen.getByText("DOI一致")).toBeInTheDocument();
    fireEvent.click(screen.getByText("別論文として登録する"));
    await waitFor(()=>{
      const posts=vi.mocked(fetch).mock.calls.filter(([,init])=>init?.method==="POST");
      expect(posts).toHaveLength(2);
      expect((posts[1][1]?.body as FormData).get("allow_metadata_duplicate")).toBe("true");
    });
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
