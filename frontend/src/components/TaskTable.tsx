import {useMemo, useState} from "react";
import {Link} from "react-router-dom";
import {api} from "../api";
import type {Paper, Task} from "../types";

type ListedTask = Task & {paperTitle: string; displayId: string};

export default function TaskTable({papers, readonly, reload}: {papers: Paper[]; readonly: boolean; reload: () => void}) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [error, setError] = useState("");
  const tasks = useMemo(
    () => papers.flatMap(paper => (paper.tasks ?? []).map(task => ({...task, paperTitle: paper.title, displayId: paper.display_id}))).filter(task => showCompleted || !task.completed),
    [papers, showCompleted],
  );
  async function setCompleted(task: ListedTask, completed: boolean) {
    try {
      await api(`/papers/${task.paper_id}/tasks/${task.id}`, {method: "PATCH", body: JSON.stringify({completed})});
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "タスクを更新できませんでした。");
    }
  }
  return <section className="task-pane">
    <div className="home-subheader"><h2>タスク</h2></div>
    {error && <div className="error">{error}</div>}
    <div className="task-filter"><label className="inline-check"><input type="checkbox" checked={showCompleted} onChange={event => setShowCompleted(event.target.checked)} />完了済みも表示</label></div>
    <div className="table-wrap task-table-wrap"><table><tbody>
      {tasks.map(task => <tr key={task.id}><td><input aria-label={`${task.title}を完了`} type="checkbox" checked={task.completed} disabled={readonly} onChange={event => setCompleted(task, event.target.checked)} /></td><td><div className={`task-compact-content ${task.completed ? "completed-text" : ""}`}><strong>{task.title}</strong>{task.description && <small>{task.description}</small>}<Link to={`/papers/${task.paper_id}`}>{task.displayId} {task.paperTitle}</Link><time>{new Date(task.updated_at).toLocaleDateString("ja-JP")}</time></div></td></tr>)}
    </tbody></table>{tasks.length === 0 && <div className="empty">{showCompleted ? "タスクはありません。" : "未完了のタスクはありません。"}</div>}</div>
  </section>;
}
