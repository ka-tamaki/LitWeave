import {forwardRef, useEffect, useMemo, useRef} from "react";
import CodeMirror, {type ReactCodeMirrorRef} from "@uiw/react-codemirror";
import {markdown} from "@codemirror/lang-markdown";
import {EditorView, keymap} from "@codemirror/view";

export type MarkdownEditorRef = ReactCodeMirrorRef;

type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  readonly: boolean;
};

const MarkdownEditor = forwardRef<MarkdownEditorRef, MarkdownEditorProps>(function MarkdownEditor(
  {value, onChange, onSave, readonly},
  ref,
) {
  const saveRef = useRef(onSave);
  useEffect(() => { saveRef.current = onSave; }, [onSave]);

  const extensions = useMemo(() => [
    markdown({completeHTMLTags: false}),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({"aria-label": "Markdownメモ"}),
    keymap.of([{
      key: "Mod-s",
      preventDefault: true,
      run: () => { saveRef.current(); return true; },
    }]),
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
