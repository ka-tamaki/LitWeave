import {useState} from "react";
import type {Keyword} from "../types";

type Props = {
  keywords: Keyword[];
  selectedIds?: string[];
};

export default function KeywordSelector({keywords, selectedIds = []}: Props) {
  const [selected, setSelected] = useState(() => new Set(selectedIds));

  function toggle(keywordId: string, checked: boolean) {
    setSelected(current => {
      const next = new Set(current);
      if (checked) next.add(keywordId);
      else next.delete(keywordId);
      return next;
    });
  }

  return <fieldset className="full keyword-field">
    <legend>キーワード <span>{selected.size}件選択</span></legend>
    {keywords.length > 0
      ? <div className="keyword-options">{keywords.map(keyword => {
        const checked = selected.has(keyword.id);
        return <label className={`keyword-chip ${checked ? "selected" : ""}`} key={keyword.id}>
          <input
            type="checkbox"
            name="keyword_ids"
            value={keyword.id}
            checked={checked}
            onChange={event => toggle(keyword.id, event.target.checked)}
          />
          <i style={{background: keyword.color}} />
          <span>{keyword.name}</span>
          {checked && <b aria-hidden="true">✓</b>}
        </label>;
      })}</div>
      : <p className="muted">登録済みのキーワードはありません。先に「キーワード管理」で作成してください。</p>}
    <small className="muted">登録済みキーワードから選択します。タグをクリックすると選択／解除できます。</small>
  </fieldset>;
}
