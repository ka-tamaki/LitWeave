import ReactMarkdown from "react-markdown";

export default function MarkdownPreview({content}: {content: string}) {
  if (!content.trim()) {
    return <p className="muted">プレビューするメモはまだありません。</p>;
  }

  return (
    <div className="markdown-preview" aria-label="Markdownプレビュー">
      <ReactMarkdown
        skipHtml
        components={{
          a: ({href, children}) => href ? <a href={href}>{children}</a> : <>{children}</>,
          img: ({alt}) => <span>{alt || "画像"}</span>,
          p: ({children}) => <p className="markdown-preserve-breaks">{children}</p>,
          li: ({children}) => <li className="markdown-preserve-breaks">{children}</li>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
