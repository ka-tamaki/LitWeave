from __future__ import annotations

import json
import logging
import os
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import service
from .db import SessionLocal, configure_database
from .logging_config import configure_logging
from .schemas import (
    CitationCreate,
    KeywordCreate,
    KeywordMerge,
    KeywordUpdate,
    NoteUpdate,
    PaperUpdate,
    SetupRequest,
    TemplateUpdate,
)
from .storage import (
    NOTE_TEMPLATE,
    create_lightweight_backup,
    get_local_settings,
    initialize_library,
    library_path,
    now_iso,
    read_json,
    safe_item_dir,
    write_json,
)
from .version import VERSION


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_logging()
    configure_database()
    logging.getLogger("litweave").info("application_started version=%s", VERSION)
    yield


app = FastAPI(title="LitWeave", version=VERSION, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def fail(exc: Exception) -> HTTPException:
    logger = logging.getLogger("litweave")
    logger.error(
        "operation_failed exception=%s errno=%s winerror=%s",
        type(exc).__name__,
        getattr(exc, "errno", None),
        getattr(exc, "winerror", None),
    )
    if isinstance(exc, service.ConflictError):
        return HTTPException(409, {"message": str(exc), "existing_id": exc.existing_id})
    if isinstance(exc, LookupError):
        return HTTPException(404, str(exc))
    if isinstance(exc, (ValueError, RuntimeError)):
        return HTTPException(400, str(exc))
    if isinstance(exc, PermissionError):
        return HTTPException(
            503,
            "Box Driveへ書き込めません。Box Driveを起動し、保存先と元PDFを「常にこのデバイスに保持」にしてから再試行してください。",
        )
    if isinstance(exc, OSError):
        code = getattr(exc, "winerror", None) or getattr(exc, "errno", None) or "unknown"
        return HTTPException(
            503,
            f"PDFのローカル保存中にOSエラーが発生しました（コード: {code}）。Box Driveと空き容量を確認してください。",
        )
    return HTTPException(500, "処理に失敗しました。ログを確認してください。")


@app.get("/api/system")
def system_info():
    settings = get_local_settings()
    raw = settings.get("library_path")
    path = Path(raw) if raw else None
    return {
        "version": VERSION,
        "configured": bool(raw),
        "library_path": raw,
        "available": bool(path and path.exists()),
        "writable": bool(path and path.exists() and os.access(path, os.W_OK)),
        "message": "Box Driveフォルダーへの保存状態です。Boxクラウドの同期完了は判定しません。",
    }


@app.post("/api/setup")
def setup(request: SetupRequest):
    try:
        path = initialize_library(request.path)
        service.rebuild_index()
        return {"library_path": str(path)}
    except Exception as exc:
        raise fail(exc) from exc


@app.get("/api/papers")
def papers(
    q: str = "",
    status: str = "",
    year: int | None = None,
    journal: str = "",
    keyword_id: str = "",
    rating: int | None = None,
    sort: str = "updated_at",
    direction: str = "desc",
    trashed: bool = False,
):
    try:
        return service.list_papers(q, status, year, journal, keyword_id, rating, sort, direction, trashed)
    except Exception as exc:
        raise fail(exc) from exc


@app.post("/api/papers", status_code=201)
async def register_paper(
    pdf: UploadFile = File(...),
    title: str = Form(...),
    authors: str = Form("[]"),
    year: str = Form(""),
    journal: str = Form(""),
    doi: str = Form(""),
    url: str = Form(""),
    language: str = Form("日本語"),
    abstract: str = Form(""),
    remarks: str = Form(""),
    keyword_ids: str = Form("[]"),
):
    if not title.strip():
        raise HTTPException(422, "タイトルは必須です。")
    try:
        author_values = json.loads(authors)
        if not isinstance(author_values, list):
            raise ValueError("著者形式が不正です。")
        keyword_id_values = json.loads(keyword_ids)
        if not isinstance(keyword_id_values, list) or not all(isinstance(value, str) for value in keyword_id_values):
            raise ValueError("キーワードID形式が不正です。")
        year_value = None
        if year.strip():
            try:
                year_value = int(year)
            except ValueError as exc:
                raise ValueError("発行年は整数で入力してください。") from exc
            if not 1000 <= year_value <= 9999:
                raise ValueError("発行年は1000～9999で入力してください。")
        return service.create_paper(
            pdf.file,
            pdf.filename or "",
            {
                "title": title,
                "authors": [str(value).strip() for value in author_values if str(value).strip()],
                "year": year_value,
                "journal": journal,
                "doi": doi,
                "url": url,
                "language": language,
                "abstract": abstract,
                "remarks": remarks,
                "keyword_ids": keyword_id_values,
            },
        )
    except Exception as exc:
        raise fail(exc) from exc
    finally:
        await pdf.close()


@app.get("/api/papers/{paper_id}")
def paper_detail(paper_id: str):
    try:
        with SessionLocal() as session:
            return service.paper_dict(service.get_paper(session, paper_id))
    except Exception as exc:
        raise fail(exc) from exc


@app.patch("/api/papers/{paper_id}")
def paper_update(paper_id: str, request: PaperUpdate):
    try:
        return service.update_paper(paper_id, request.model_dump(exclude_unset=True))
    except Exception as exc:
        raise fail(exc) from exc


@app.get("/api/papers/{paper_id}/note")
def note_get(paper_id: str):
    try:
        return {"content": service.get_note(paper_id)}
    except Exception as exc:
        raise fail(exc) from exc


@app.put("/api/papers/{paper_id}/note")
def note_save(paper_id: str, request: NoteUpdate):
    try:
        return service.save_note(paper_id, request.content)
    except Exception as exc:
        raise fail(exc) from exc


@app.post("/api/papers/{paper_id}/open")
def open_pdf(paper_id: str):
    try:
        with SessionLocal() as session:
            paper = service.get_paper(session, paper_id)
            pdf = safe_item_dir(paper.display_id) / "paper.pdf"
        if os.name != "nt":
            raise RuntimeError("PDFを既定アプリで開く操作はWindowsでのみ利用できます。")
        os.startfile(pdf)  # type: ignore[attr-defined]
        return {"opened": True}
    except Exception as exc:
        raise fail(exc) from exc


@app.post("/api/papers/{paper_id}/trash")
def paper_trash(paper_id: str):
    try:
        return service.trash_paper(paper_id)
    except Exception as exc:
        raise fail(exc) from exc


@app.post("/api/papers/{paper_id}/restore")
def paper_restore(paper_id: str):
    try:
        return service.restore_paper(paper_id)
    except Exception as exc:
        raise fail(exc) from exc


@app.delete("/api/papers/{paper_id}", status_code=204)
def paper_delete(paper_id: str):
    try:
        service.permanently_delete_paper(paper_id)
    except Exception as exc:
        raise fail(exc) from exc


@app.get("/api/keywords")
def keywords():
    return service.list_keywords()


@app.post("/api/keywords", status_code=201)
def keyword_create(request: KeywordCreate):
    try:
        return service.create_keyword(request.name, request.color)
    except Exception as exc:
        raise fail(exc) from exc


@app.patch("/api/keywords/{keyword_id}")
def keyword_update(keyword_id: str, request: KeywordUpdate):
    try:
        return service.update_keyword(keyword_id, request.model_dump(exclude_unset=True))
    except Exception as exc:
        raise fail(exc) from exc


@app.post("/api/keywords/{keyword_id}/merge")
def keyword_merge(keyword_id: str, request: KeywordMerge):
    try:
        return service.merge_keyword(keyword_id, request.target_id)
    except Exception as exc:
        raise fail(exc) from exc


@app.delete("/api/keywords/{keyword_id}", status_code=204)
def keyword_delete(keyword_id: str):
    try:
        service.delete_keyword(keyword_id)
    except Exception as exc:
        raise fail(exc) from exc


@app.get("/api/citations")
def citations():
    return service.list_citations()


@app.post("/api/citations", status_code=201)
def citation_create(request: CitationCreate):
    try:
        return service.create_citation(request.source_id, request.target_id, request.note)
    except Exception as exc:
        raise fail(exc) from exc


@app.delete("/api/citations/{citation_id}", status_code=204)
def citation_delete(citation_id: str):
    try:
        service.delete_citation(citation_id)
    except Exception as exc:
        raise fail(exc) from exc


@app.get("/api/graph")
def graph(
    mode: str = Query(pattern="^(keyword|citation)$"),
    status: str = "",
    year: int | None = None,
    keyword_id: str = "",
    center_id: str = "",
    depth: int = Query(1, ge=1, le=3),
):
    return service.graph_data(mode, status, year, keyword_id, center_id, depth)


@app.post("/api/maintenance/rebuild")
def rebuild():
    try:
        return service.rebuild_index()
    except Exception as exc:
        raise fail(exc) from exc


@app.post("/api/maintenance/backup")
def backup():
    try:
        path = create_lightweight_backup()
        return {"path": str(path), "message": "Box Driveフォルダーへ保存しました。クラウド同期完了は確認していません。"}
    except Exception as exc:
        raise fail(exc) from exc


@app.post("/api/maintenance/export/{kind}")
def export(kind: str):
    try:
        return {"path": str(service.create_export(kind))}
    except Exception as exc:
        raise fail(exc) from exc


@app.get("/api/settings/template")
def get_template():
    try:
        settings = read_json(library_path() / "config" / "settings.json")
        return {"content": settings.get("note_template", NOTE_TEMPLATE)}
    except Exception as exc:
        raise fail(exc) from exc


@app.put("/api/settings/template")
def update_template(request: TemplateUpdate):
    try:
        path = library_path(require_writable=True) / "config" / "settings.json"
        settings = read_json(path)
        settings["note_template"] = "\n".join(f"## {section}\n" for section in request.sections)
        settings["updated_at"] = now_iso()
        write_json(path, settings)
        return {"content": settings["note_template"]}
    except Exception as exc:
        raise fail(exc) from exc
