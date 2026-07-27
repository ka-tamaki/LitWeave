from __future__ import annotations

import csv
import io
import json
import shutil
import uuid
from datetime import date
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import Citation, Keyword, Paper, PaperKeyword, SessionLocal, Task, reset_database
from .storage import (
    SCHEMA_VERSION,
    atomic_write,
    copy_pdf_atomic,
    create_lightweight_backup,
    effective_note_template,
    hash_stream,
    library_path,
    normalize_doi,
    now_iso,
    read_json,
    remove_tree,
    safe_item_dir,
    write_json,
)


def keyword_dict(keyword: Keyword) -> dict[str, Any]:
    return {
        "id": keyword.id,
        "name": keyword.name,
        "color": keyword.color,
        "usage_count": len([paper for paper in keyword.papers if not paper.trashed]),
        "paper_ids": [paper.id for paper in keyword.papers if not paper.trashed],
    }


def task_dict(task: Task) -> dict[str, Any]:
    return {
        "id": task.id,
        "paper_id": task.paper_id,
        "title": task.title,
        "description": task.description,
        "completed": task.completed,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
    }


def paper_dict(paper: Paper) -> dict[str, Any]:
    return {
        "id": paper.id,
        "display_id": paper.display_id,
        "title": paper.title,
        "authors": paper.authors,
        "year": paper.year,
        "journal": paper.journal,
        "volume": paper.volume,
        "issue": paper.issue,
        "pages": paper.pages,
        "doi": paper.doi,
        "url": paper.url,
        "language": paper.language,
        "abstract": paper.abstract,
        "rating": paper.rating,
        "completed_date": paper.completed_date,
        "remarks": paper.remarks,
        "status": paper.status,
        "status_history": paper.status_history,
        "pdf_hash": paper.pdf_hash,
        "pdf_size": paper.pdf_size,
        "created_at": paper.created_at,
        "updated_at": paper.updated_at,
        "has_note": paper.has_note,
        "trashed": paper.trashed,
        "deleted_at": paper.deleted_at,
        "keywords": [{"id": value.id, "name": value.name, "color": value.color} for value in paper.keywords],
        "tasks": [task_dict(value) for value in paper.tasks],
    }


def metadata_for(paper: Paper) -> dict[str, Any]:
    result = paper_dict(paper)
    result["schema_version"] = SCHEMA_VERSION
    result["pdf_filename"] = "paper.pdf"
    return result


def persist_paper(paper: Paper) -> None:
    directory = safe_item_dir(paper.display_id, paper.trashed)
    write_json(directory / "metadata.json", metadata_for(paper))


def persist_keywords(session: Session) -> None:
    values = session.scalars(select(Keyword).order_by(Keyword.created_at)).all()
    write_json(
        library_path(require_writable=True) / "config" / "keywords.json",
        {
            "schema_version": SCHEMA_VERSION,
            "keywords": [
                {
                    "id": value.id,
                    "name": value.name,
                    "normalized_name": value.normalized_name,
                    "color": value.color,
                    "created_at": value.created_at,
                    "updated_at": value.updated_at,
                }
                for value in values
            ],
        },
    )


def next_display_id(session: Session) -> str:
    values = session.scalars(select(Paper.display_id)).all()
    highest = max((int(value[1:]) for value in values), default=0)
    return f"P{highest + 1:06d}"


def create_paper(stream, filename: str, fields: dict[str, Any]) -> dict[str, Any]:
    if not filename.lower().endswith(".pdf"):
        raise ValueError("PDFファイルを選択してください。")
    prefix = stream.read(5)
    stream.seek(0)
    if prefix != b"%PDF-":
        raise ValueError("有効なPDF形式ではありません。")
    digest, size = hash_stream(stream)
    with SessionLocal() as session:
        duplicate = session.scalar(select(Paper).where(Paper.pdf_hash == digest))
        if duplicate:
            raise ConflictError(f"同一PDFは{duplicate.display_id}として登録済みです。", duplicate.id)
        display_id = next_display_id(session)
        item_id = str(uuid.uuid4())
        created = now_iso()
        keyword_ids = list(dict.fromkeys(fields.get("keyword_ids", [])))
        selected_keywords = list(session.scalars(select(Keyword).where(Keyword.id.in_(keyword_ids))).unique()) if keyword_ids else []
        if len(selected_keywords) != len(keyword_ids):
            raise ValueError("存在しないキーワードが含まれています。")
        paper = Paper(
            id=item_id,
            display_id=display_id,
            title=str(fields["title"]).strip(),
            authors=fields.get("authors", []),
            year=fields.get("year"),
            journal=fields.get("journal", ""),
            doi=normalize_doi(fields.get("doi", "")),
            url=fields.get("url", ""),
            language=fields.get("language", "日本語"),
            abstract=fields.get("abstract", ""),
            remarks=fields.get("remarks", ""),
            status="未読",
            status_history=[{"status": "未読", "changed_at": created}],
            pdf_hash=digest,
            pdf_size=size,
            created_at=created,
            updated_at=created,
            has_note=False,
        )
        paper.keywords = selected_keywords
        directory = safe_item_dir(display_id)
        try:
            directory.mkdir(parents=False)
            copy_pdf_atomic(stream, directory / "paper.pdf", digest)
            settings = read_json(library_path() / "config" / "settings.json")
            atomic_write(directory / "note.md", effective_note_template(settings).encode("utf-8"))
            session.add(paper)
            session.flush()
            persist_paper(paper)
            session.commit()
        except Exception:
            session.rollback()
            if directory.exists():
                shutil.rmtree(directory)
            raise
        return paper_dict(paper)


class ConflictError(ValueError):
    def __init__(self, message: str, existing_id: str | None = None):
        super().__init__(message)
        self.existing_id = existing_id


def list_papers(
    query: str = "",
    status: str = "",
    year: int | None = None,
    journal: str = "",
    keyword_id: str = "",
    rating: int | None = None,
    sort: str = "updated_at",
    direction: str = "desc",
    trashed: bool = False,
) -> list[dict[str, Any]]:
    with SessionLocal() as session:
        papers = list(session.scalars(select(Paper).where(Paper.trashed == trashed)).unique())
        terms = [term.casefold() for term in query.split() if term]

        def searchable(paper: Paper) -> str:
            return " ".join([paper.title, *paper.authors, *(keyword.name for keyword in paper.keywords)]).casefold()

        papers = [
            paper
            for paper in papers
            if (not terms or all(term in searchable(paper) for term in terms))
            and (not status or paper.status == status)
            and (year is None or paper.year == year)
            and (not journal or paper.journal == journal)
            and (not keyword_id or any(keyword.id == keyword_id for keyword in paper.keywords))
            and (rating is None or paper.rating == rating)
        ]
        allowed = {"title", "year", "created_at", "updated_at", "rating"}
        key = sort if sort in allowed else "updated_at"
        papers.sort(
            key=lambda paper: (
                getattr(paper, key) is None,
                str(getattr(paper, key) or "").casefold(),
            ),
            reverse=direction == "desc",
        )
        return [paper_dict(paper) for paper in papers]


def get_paper(session: Session, paper_id: str, include_trashed: bool = False) -> Paper:
    paper = session.get(Paper, paper_id)
    if paper is None or (paper.trashed and not include_trashed):
        raise LookupError("論文が見つかりません。")
    return paper


def update_paper(paper_id: str, values: dict[str, Any]) -> dict[str, Any]:
    with SessionLocal() as session:
        paper = get_paper(session, paper_id)
        keyword_ids = values.pop("keyword_ids", None)
        old_status = paper.status
        for key, value in values.items():
            if key == "doi":
                value = normalize_doi(value or "")
            setattr(paper, key, value if value is not None else None)
        if keyword_ids is not None:
            keywords = list(session.scalars(select(Keyword).where(Keyword.id.in_(keyword_ids))).unique())
            if len(keywords) != len(set(keyword_ids)):
                raise ValueError("存在しないキーワードが含まれています。")
            paper.keywords = keywords
        if paper.status != old_status:
            history = list(paper.status_history)
            history.append({"status": paper.status, "changed_at": now_iso()})
            paper.status_history = history
            if paper.status == "既読" and not paper.completed_date:
                paper.completed_date = date.today().isoformat()
        paper.updated_at = now_iso()
        persist_paper(paper)
        session.commit()
        return paper_dict(paper)


def get_note(paper_id: str) -> str:
    with SessionLocal() as session:
        paper = get_paper(session, paper_id)
        return (safe_item_dir(paper.display_id) / "note.md").read_text(encoding="utf-8")


def save_note(paper_id: str, content: str) -> dict[str, Any]:
    with SessionLocal() as session:
        paper = get_paper(session, paper_id)
        atomic_write(safe_item_dir(paper.display_id) / "note.md", content.encode("utf-8"))
        paper.has_note = bool(content.strip())
        paper.updated_at = now_iso()
        persist_paper(paper)
        session.commit()
        return {"saved_at": paper.updated_at}


def create_task(paper_id: str, title: str, description: str = "") -> dict[str, Any]:
    cleaned = title.strip()
    if not cleaned:
        raise ValueError("タスクは空欄にできません。")
    with SessionLocal() as session:
        paper = get_paper(session, paper_id)
        created = now_iso()
        task = Task(
            id=str(uuid.uuid4()),
            paper_id=paper.id,
            title=cleaned,
            description=description.strip(),
            completed=False,
            created_at=created,
            updated_at=created,
        )
        paper.tasks.append(task)
        paper.updated_at = created
        session.flush()
        persist_paper(paper)
        session.commit()
        return task_dict(task)


def update_task(paper_id: str, task_id: str, values: dict[str, Any]) -> dict[str, Any]:
    with SessionLocal() as session:
        paper = get_paper(session, paper_id)
        task = session.get(Task, task_id)
        if task is None or task.paper_id != paper.id:
            raise LookupError("タスクが見つかりません。")
        if "title" in values:
            cleaned = str(values["title"]).strip()
            if not cleaned:
                raise ValueError("タスクは空欄にできません。")
            task.title = cleaned
        if "description" in values:
            task.description = str(values["description"]).strip()
        if "completed" in values:
            task.completed = bool(values["completed"])
        task.updated_at = now_iso()
        paper.updated_at = task.updated_at
        session.flush()
        persist_paper(paper)
        session.commit()
        return task_dict(task)


def delete_task(paper_id: str, task_id: str) -> None:
    with SessionLocal() as session:
        paper = get_paper(session, paper_id)
        task = session.get(Task, task_id)
        if task is None or task.paper_id != paper.id:
            raise LookupError("タスクが見つかりません。")
        paper.tasks.remove(task)
        paper.updated_at = now_iso()
        session.flush()
        persist_paper(paper)
        session.commit()


def create_keyword(name: str, color: str) -> dict[str, Any]:
    cleaned = name.strip()
    if not cleaned:
        raise ValueError("キーワード名は空欄にできません。")
    now = now_iso()
    with SessionLocal() as session:
        keyword = Keyword(
            id=str(uuid.uuid4()),
            name=cleaned,
            normalized_name=cleaned.casefold(),
            color=color,
            created_at=now,
            updated_at=now,
        )
        session.add(keyword)
        try:
            session.flush()
        except IntegrityError as exc:
            raise ConflictError("同じ名前のキーワードが既にあります。") from exc
        persist_keywords(session)
        session.commit()
        return keyword_dict(keyword)


def list_keywords() -> list[dict[str, Any]]:
    with SessionLocal() as session:
        return [keyword_dict(value) for value in session.scalars(select(Keyword).order_by(Keyword.name)).unique()]


def update_keyword(keyword_id: str, values: dict[str, Any]) -> dict[str, Any]:
    with SessionLocal() as session:
        keyword = session.get(Keyword, keyword_id)
        if not keyword:
            raise LookupError("キーワードが見つかりません。")
        if values.get("name") is not None:
            cleaned = values["name"].strip()
            if not cleaned:
                raise ValueError("キーワード名は空欄にできません。")
            keyword.name = cleaned
            keyword.normalized_name = cleaned.casefold()
        if values.get("color") is not None:
            keyword.color = values["color"]
        keyword.updated_at = now_iso()
        try:
            session.flush()
        except IntegrityError as exc:
            raise ConflictError("同じ名前のキーワードが既にあります。") from exc
        for paper in keyword.papers:
            persist_paper(paper)
        persist_keywords(session)
        session.commit()
        return keyword_dict(keyword)


def merge_keyword(source_id: str, target_id: str) -> dict[str, Any]:
    if source_id == target_id:
        raise ValueError("同じキーワードへは統合できません。")
    with SessionLocal() as session:
        source = session.get(Keyword, source_id)
        target = session.get(Keyword, target_id)
        if not source or not target:
            raise LookupError("キーワードが見つかりません。")
        affected = list(source.papers)
        for paper in affected:
            paper.keywords = [value for value in paper.keywords if value.id != source_id]
            if not any(value.id == target_id for value in paper.keywords):
                paper.keywords.append(target)
            persist_paper(paper)
        session.delete(source)
        session.flush()
        persist_keywords(session)
        session.commit()
        return keyword_dict(target)


def delete_keyword(keyword_id: str) -> None:
    with SessionLocal() as session:
        keyword = session.get(Keyword, keyword_id)
        if not keyword:
            raise LookupError("キーワードが見つかりません。")
        if keyword.papers:
            raise ConflictError("使用中のキーワードは削除できません。先に統合または付与解除してください。")
        session.delete(keyword)
        session.flush()
        persist_keywords(session)
        session.commit()


def create_citation(source_id: str, target_id: str, note: str) -> dict[str, Any]:
    if source_id == target_id:
        raise ValueError("自己引用は登録できません。")
    with SessionLocal() as session:
        get_paper(session, source_id)
        get_paper(session, target_id)
        existing = session.scalar(
            select(Citation).where(Citation.source_id == source_id, Citation.target_id == target_id)
        )
        if existing:
            raise ConflictError("同じ引用関係が既にあります。")
        citation = Citation(id=str(uuid.uuid4()), source_id=source_id, target_id=target_id, note=note, created_at=now_iso())
        session.add(citation)
        write_json(
            library_path(require_writable=True) / "citations" / f"{citation.id}.json",
            {"schema_version": SCHEMA_VERSION, **citation_dict(citation)},
        )
        session.commit()
        return citation_dict(citation)


def citation_dict(value: Citation) -> dict[str, Any]:
    return {
        "id": value.id,
        "source_id": value.source_id,
        "target_id": value.target_id,
        "note": value.note,
        "created_at": value.created_at,
    }


def list_citations() -> list[dict[str, Any]]:
    with SessionLocal() as session:
        return [citation_dict(value) for value in session.scalars(select(Citation)).all()]


def delete_citation(citation_id: str) -> None:
    with SessionLocal() as session:
        citation = session.get(Citation, citation_id)
        if not citation:
            raise LookupError("引用関係が見つかりません。")
        (library_path(require_writable=True) / "citations" / f"{citation.id}.json").unlink(missing_ok=True)
        session.delete(citation)
        session.commit()


def trash_paper(paper_id: str) -> dict[str, Any]:
    with SessionLocal() as session:
        paper = get_paper(session, paper_id)
        source = safe_item_dir(paper.display_id)
        target = safe_item_dir(paper.display_id, True)
        if target.exists():
            raise ConflictError("ごみ箱に同じ論文IDが存在します。")
        shutil.move(str(source), str(target))
        paper.trashed = True
        paper.deleted_at = now_iso()
        persist_paper(paper)
        session.commit()
        return paper_dict(paper)


def restore_paper(paper_id: str) -> dict[str, Any]:
    with SessionLocal() as session:
        paper = get_paper(session, paper_id, True)
        if not paper.trashed:
            raise ValueError("この論文はごみ箱にありません。")
        source = safe_item_dir(paper.display_id, True)
        target = safe_item_dir(paper.display_id)
        shutil.move(str(source), str(target))
        paper.trashed = False
        paper.deleted_at = None
        persist_paper(paper)
        session.commit()
        return paper_dict(paper)


def permanently_delete_paper(paper_id: str) -> None:
    with SessionLocal() as session:
        paper = get_paper(session, paper_id, True)
        if not paper.trashed:
            raise ValueError("完全削除はごみ箱内の論文にだけ実行できます。")
        citations = session.scalars(
            select(Citation).where((Citation.source_id == paper_id) | (Citation.target_id == paper_id))
        ).all()
        for citation in citations:
            (library_path() / "citations" / f"{citation.id}.json").unlink(missing_ok=True)
            session.delete(citation)
        remove_tree(safe_item_dir(paper.display_id, True))
        session.delete(paper)
        session.commit()


def rebuild_index() -> dict[str, Any]:
    root = library_path()
    entries: list[tuple[Path, bool]] = [
        *((path, False) for path in (root / "items").iterdir() if path.is_dir()),
        *((path, True) for path in (root / "trash").iterdir() if path.is_dir()),
    ]
    keyword_file = read_json(root / "config" / "keywords.json")
    reset_database()
    errors: list[dict[str, str]] = []
    count = 0
    with SessionLocal() as session:
        keyword_map: dict[str, Keyword] = {}
        for item in keyword_file.get("keywords", []):
            try:
                keyword = Keyword(**{key: item[key] for key in ("id", "name", "normalized_name", "color", "created_at", "updated_at")})
                session.add(keyword)
                keyword_map[keyword.id] = keyword
            except (KeyError, TypeError) as exc:
                errors.append({"id": item.get("id", "unknown"), "reason": f"キーワード形式エラー: {exc}"})
        session.commit()
        for directory, trashed in entries:
            try:
                item = read_json(directory / "metadata.json")
                required = ("id", "display_id", "title", "pdf_hash", "pdf_size", "created_at", "updated_at")
                missing = [key for key in required if key not in item]
                if missing or not (directory / "paper.pdf").exists():
                    raise ValueError(f"必須データ不足: {', '.join(missing) or 'paper.pdf'}")
                paper = Paper(
                    **{
                        key: item.get(key)
                        for key in (
                            "id", "display_id", "title", "authors", "year", "journal", "volume", "issue", "pages",
                            "doi", "url", "language", "abstract", "rating", "completed_date", "remarks", "status",
                            "status_history", "pdf_hash", "pdf_size", "created_at", "updated_at", "has_note",
                            "deleted_at",
                        )
                    },
                    trashed=trashed,
                )
                paper.keywords = [keyword_map[value["id"]] for value in item.get("keywords", []) if value["id"] in keyword_map]
                paper.tasks = [
                    Task(
                        id=value["id"],
                        paper_id=paper.id,
                        title=value["title"],
                        description=value.get("description", ""),
                        completed=bool(value.get("completed", False)),
                        created_at=value.get("created_at", paper.created_at),
                        updated_at=value.get("updated_at", paper.updated_at),
                    )
                    for value in item.get("tasks", [])
                ]
                session.add(paper)
                session.commit()
                count += 1
            except Exception as exc:
                session.rollback()
                errors.append({"id": directory.name, "reason": str(exc)})
        for path in (root / "citations").glob("*.json"):
            try:
                item = read_json(path)
                session.add(Citation(**{key: item[key] for key in ("id", "source_id", "target_id", "note", "created_at")}))
                session.commit()
            except Exception as exc:
                session.rollback()
                errors.append({"id": path.stem, "reason": f"引用形式エラー: {exc}"})
    return {"indexed": count, "errors": errors}


def graph_data(mode: str, status: str = "", year: int | None = None, keyword_id: str = "", center_id: str = "", depth: int = 1) -> dict[str, Any]:
    papers = list_papers(status=status, year=year, keyword_id=keyword_id)
    allowed = {paper["id"] for paper in papers}
    citations = [value for value in list_citations() if value["source_id"] in allowed and value["target_id"] in allowed]
    if center_id:
        visible = {center_id}
        for _ in range(max(1, min(depth, 3))):
            visible |= {
                endpoint
                for value in citations
                if value["source_id"] in visible or value["target_id"] in visible
                for endpoint in (value["source_id"], value["target_id"])
            }
        papers = [paper for paper in papers if paper["id"] in visible]
        allowed = visible
        citations = [value for value in citations if value["source_id"] in allowed and value["target_id"] in allowed]
    nodes = [{"data": {"id": paper["id"], "label": paper["title"], "kind": "paper", **paper}} for paper in papers]
    edges: list[dict[str, Any]] = []
    if mode == "keyword":
        used: dict[str, dict[str, Any]] = {}
        for paper in papers:
            for keyword in paper["keywords"]:
                used[keyword["id"]] = keyword
                edges.append({"data": {"id": f"pk-{paper['id']}-{keyword['id']}", "source": paper["id"], "target": keyword["id"]}})
        nodes += [{"data": {"id": value["id"], "label": value["name"], "kind": "keyword", **value}} for value in used.values()]
    else:
        edges = [{"data": {"id": value["id"], "source": value["source_id"], "target": value["target_id"], "directed": True}} for value in citations]
    return {"nodes": nodes, "edges": edges, "node_count": len(nodes), "edge_count": len(edges)}


def create_export(kind: str) -> Path:
    root = library_path(require_writable=True)
    target_dir = root / "backups"
    papers = list_papers()
    timestamp = now_iso().replace(":", "").replace("+", "-")
    if kind == "json":
        path = target_dir / f"papers-{timestamp}.json"
        write_json(path, {"schema_version": SCHEMA_VERSION, "papers": papers, "citations": list_citations()})
    elif kind == "csv":
        path = target_dir / f"papers-{timestamp}.csv"
        output = io.StringIO()
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(["表示ID", "タイトル", "著者", "発行年", "ジャーナル", "状態", "キーワード", "評価"])
        for paper in papers:
            writer.writerow([paper["display_id"], paper["title"], "; ".join(paper["authors"]), paper["year"] or "", paper["journal"], paper["status"], "; ".join(value["name"] for value in paper["keywords"]), paper["rating"] or ""])
        atomic_write(path, ("\ufeff" + output.getvalue()).encode("utf-8"))
    elif kind == "markdown":
        path = target_dir / f"notes-{timestamp}.md"
        chunks = []
        for paper in papers:
            chunks.append(f"# {paper['display_id']} {paper['title']}\n\n{get_note(paper['id'])}\n")
        atomic_write(path, "\n---\n\n".join(chunks).encode("utf-8"))
    else:
        raise ValueError("未対応の出力形式です。")
    return path
