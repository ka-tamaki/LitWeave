import {render, screen} from "@testing-library/react";
import {describe, expect, it} from "vitest";
import MarkdownPreview from "./MarkdownPreview";

describe("MarkdownPreview", () => {
  it("未保存のMarkdownを見出しや一覧として表示する", () => {
    render(<MarkdownPreview content={"## 主な結果\n\n- 結果A\n- **結果B**"} />);

    expect(screen.getByRole("heading", {name: "主な結果", level: 2})).toBeInTheDocument();
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText("結果B").tagName).toBe("STRONG");
  });

  it("段落内の1回の改行を入力どおり保持する", () => {
    render(<MarkdownPreview content={"1行目\n2行目"} />);

    const paragraph = screen.getByText((_, element) => element?.tagName === "P");
    expect(paragraph).toHaveTextContent("1行目 2行目");
    expect(paragraph.textContent).toBe("1行目\n2行目");
    expect(paragraph).toHaveClass("markdown-preserve-breaks");
  });

  it("生HTML、危険なリンク、外部画像を有効化しない", () => {
    render(<MarkdownPreview content={'<script>alert("危険")</script>\n\n[危険なリンク](javascript:alert("x"))\n\n![外部画像](https://example.com/image.png)'} />);

    expect(document.querySelector("script")).not.toBeInTheDocument();
    expect(screen.queryByText('alert("危険")')).not.toBeInTheDocument();
    expect(screen.getByText("危険なリンク").closest("a")).toBeNull();
    expect(screen.getByText("外部画像").closest("img")).toBeNull();
  });

  it("空のメモでは案内を表示する", () => {
    render(<MarkdownPreview content={"  \n"} />);

    expect(screen.getByText("プレビューするメモはまだありません。")).toBeInTheDocument();
  });
});
