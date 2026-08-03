import {act, createRef} from "react";
import {fireEvent, render, screen} from "@testing-library/react";
import {describe, expect, it, vi} from "vitest";
import MarkdownEditor, {type MarkdownEditorRef} from "./MarkdownEditor";

describe("MarkdownEditor", () => {
  it("Markdownの初期値を編集可能なCodeMirrorへ表示する", () => {
    render(<MarkdownEditor value={"## 要約\n本文"} onChange={() => undefined} onSave={() => undefined} readonly={false} />);

    const editor = screen.getByRole("textbox", {name: "Markdownメモ"});
    expect(editor).toHaveAttribute("contenteditable", "true");
    expect(document.querySelector(".cm-editor")).toBeInTheDocument();
    expect(document.querySelector(".cm-gutters")).not.toBeInTheDocument();
    expect(document.querySelector(".cm-activeLine")).not.toBeInTheDocument();
    expect(document.querySelector(".lw-md-heading")).toBeInTheDocument();
    expect(document.querySelectorAll(".cm-line")).toHaveLength(2);
  });

  it("編集内容を親へ通知する", () => {
    const ref = createRef<MarkdownEditorRef>();
    const onChange = vi.fn();
    render(<MarkdownEditor ref={ref} value="変更前" onChange={onChange} onSave={() => undefined} readonly={false} />);

    act(() => {
      const view = ref.current?.view;
      expect(view).toBeDefined();
      view!.dispatch({changes: {from: 0, to: view!.state.doc.length, insert: "変更後"}});
    });

    expect(onChange).toHaveBeenLastCalledWith("変更後", expect.anything());
  });

  it("読み取り専用状態では編集できない", () => {
    render(<MarkdownEditor value="本文" onChange={() => undefined} onSave={() => undefined} readonly />);

    expect(screen.getByRole("textbox", {name: "Markdownメモ"})).toHaveAttribute("contenteditable", "false");
  });

  it("Ctrl+Sで保存処理を呼び出す", () => {
    const onSave = vi.fn();
    render(<MarkdownEditor value="本文" onChange={() => undefined} onSave={onSave} readonly={false} />);

    fireEvent.keyDown(screen.getByRole("textbox", {name: "Markdownメモ"}), {key: "s", code: "KeyS", ctrlKey: true});

    expect(onSave).toHaveBeenCalledOnce();
  });

  it.each([
    {key: "b", code: "KeyB", source: "太字", expected: "**太字**"},
    {key: "i", code: "KeyI", source: "斜体", expected: "*斜体*"},
    {key: "k", code: "KeyK", source: "リンク", expected: "[リンク](https://)"},
  ])("Ctrl+$codeで選択範囲へMarkdown記法を追加する", ({key, code, source, expected}) => {
    const ref = createRef<MarkdownEditorRef>();
    const onChange = vi.fn();
    render(<MarkdownEditor ref={ref} value={source} onChange={onChange} onSave={() => undefined} readonly={false} />);
    act(() => ref.current?.view?.dispatch({selection: {anchor: 0, head: source.length}}));

    fireEvent.keyDown(screen.getByRole("textbox", {name: "Markdownメモ"}), {key, code, ctrlKey: true});

    expect(onChange.mock.calls.at(-1)?.[0]).toBe(expected);
  });

  it("未選択のCtrl+Bでは記号の中央へカーソルを置く", () => {
    const ref = createRef<MarkdownEditorRef>();
    const onChange = vi.fn();
    render(<MarkdownEditor ref={ref} value="" onChange={onChange} onSave={() => undefined} readonly={false} />);

    fireEvent.keyDown(screen.getByRole("textbox", {name: "Markdownメモ"}), {key: "b", code: "KeyB", ctrlKey: true});

    expect(onChange.mock.calls.at(-1)?.[0]).toBe("****");
    expect(ref.current?.view?.state.selection.main.anchor).toBe(2);
  });
});
