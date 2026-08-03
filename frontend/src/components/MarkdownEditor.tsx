import {forwardRef, useEffect, useMemo, useRef} from "react";
import CodeMirror, {type ReactCodeMirrorRef} from "@uiw/react-codemirror";
import {markdown} from "@codemirror/lang-markdown";
import {syntaxHighlighting} from "@codemirror/language";
import {EditorView, keymap} from "@codemirror/view";
import {tagHighlighter, tags} from "@lezer/highlight";

export type MarkdownEditorRef = ReactCodeMirrorRef;

type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  readonly: boolean;
};

const markdownHighlighter = tagHighlighter([
  {tag: tags.heading, class: "lw-md-heading"},
  {tag: [tags.meta, tags.punctuation, tags.contentSeparator], class: "lw-md-mark"},
  {tag: tags.strong, class: "lw-md-strong"},
  {tag: tags.emphasis, class: "lw-md-emphasis"},
  {tag: tags.strikethrough, class: "lw-md-strikethrough"},
  {tag: tags.link, class: "lw-md-link"},
  {tag: tags.url, class: "lw-md-url"},
  {tag: tags.monospace, class: "lw-md-code"},
  {tag: tags.quote, class: "lw-md-quote"},
  {tag: tags.list, class: "lw-md-list"},
]);

function wrapSelection(view: EditorView, before: string, after = before) {
  if (view.state.readOnly) return false;
  const {from, to} = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: {from, to, insert: `${before}${selected}${after}`},
    selection: {anchor: from + before.length, head: from + before.length + selected.length},
  });
  return true;
}

function insertLink(view: EditorView) {
  if (view.state.readOnly) return false;
  const {from, to} = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const url = "https://";
  view.dispatch({
    changes: {from, to, insert: `[${selected}](${url})`},
    selection: selected
      ? {anchor: from + selected.length + 3, head: from + selected.length + 3 + url.length}
      : {anchor: from + 1},
  });
  return true;
}

const MarkdownEditor = forwardRef<MarkdownEditorRef, MarkdownEditorProps>(function MarkdownEditor(
  {value, onChange, onSave, readonly},
  ref,
) {
  const saveRef = useRef(onSave);
  useEffect(() => { saveRef.current = onSave; }, [onSave]);

  const extensions = useMemo(() => [
    markdown({completeHTMLTags: false}),
    syntaxHighlighting(markdownHighlighter),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({"aria-label": "Markdownメモ"}),
    keymap.of([
      {key: "Mod-b", preventDefault: true, run: view => wrapSelection(view, "**")},
      {key: "Mod-i", preventDefault: true, run: view => wrapSelection(view, "*")},
      {key: "Mod-k", preventDefault: true, run: insertLink},
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => { saveRef.current(); return true; },
      },
    ]),
  ], []);

  return (
    <CodeMirror
      ref={ref}
      className="markdown-editor"
      value={value}
      minHeight="30rem"
      theme="light"
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        syntaxHighlighting: false,
      }}
      extensions={extensions}
      editable={!readonly}
      readOnly={readonly}
      indentWithTab
      onChange={onChange}
    />
  );
});

export default MarkdownEditor;
