from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, BinaryIO

from .db import local_data_dir

SCHEMA_VERSION = 1
LIBRARY_DIRS = ("items", "citations", "config", "trash", "backups")
LEGACY_NOTE_TEMPLATE = """## 要点

## 研究の背景・目的

## 対象・条件

## 方法

## 主な結果

## 結論・著者の主張

## 限界・適用範囲

## 重要な図表・ページ

## 自分のメモ
"""
PREVIOUS_NOTE_TEMPLATE = """## 要約

## 研究方法・条件

## 主な結果

## 評価・疑問

## 自分の研究への活用

## 関連文献・次のアクション
"""
NOTE_TEMPLATE = """## 要約

## 研究方法・条件

## 主な結果

## 評価・疑問

## 自分の研究への活用

## 関連文献
"""


def effective_note_template(settings: dict[str, Any]) -> str:
    template = settings.get("note_template")
    if not template or template in {LEGACY_NOTE_TEMPLATE, PREVIOUS_NOTE_TEMPLATE}:
        return NOTE_TEMPLATE
    return str(template)


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def settings_path() -> Path:
    return local_data_dir() / "settings.json"


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, path)
    except Exception:
        try:
            Path(temp_name).unlink(missing_ok=True)
        finally:
            raise


def write_json(path: Path, value: Any) -> None:
    atomic_write(path, json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8"))


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def get_local_settings() -> dict[str, Any]:
    path = settings_path()
    if not path.exists():
        return {}
    return read_json(path)


def validate_library_path(raw_path: str) -> Path:
    if "\x00" in raw_path:
        raise ValueError("保存先パスが不正です。")
    path = Path(raw_path).expanduser().resolve()
    allow_non_box = os.getenv("LITWEAVE_ALLOW_NON_BOX") == "1"
    if not allow_non_box and not any(part.casefold() == "box" for part in path.parts):
        raise ValueError("Box Drive配下のフォルダーを指定してください。")
    path.mkdir(parents=True, exist_ok=True)
    probe = path / ".litweave-write-test"
    try:
        atomic_write(probe, b"ok")
        probe.unlink()
    except OSError as exc:
        raise ValueError(f"保存先へ書き込めません: {exc}") from exc
    return path


def initialize_library(raw_path: str) -> Path:
    path = validate_library_path(raw_path)
    for name in LIBRARY_DIRS:
        (path / name).mkdir(exist_ok=True)
    created = now_iso()
    settings = {
        "schema_version": SCHEMA_VERSION,
        "library_path": str(path),
        "created_at": created,
        "note_template": NOTE_TEMPLATE,
        "default_language": "日本語",
    }
    canonical_settings = path / "config" / "settings.json"
    canonical_keywords = path / "config" / "keywords.json"
    if not canonical_settings.exists():
        write_json(canonical_settings, settings)
    if not canonical_keywords.exists():
        write_json(canonical_keywords, {"schema_version": SCHEMA_VERSION, "keywords": []})
    write_json(settings_path(), {"schema_version": SCHEMA_VERSION, "library_path": str(path)})
    return path


def library_path(require_writable: bool = False) -> Path:
    raw = get_local_settings().get("library_path")
    if not raw:
        raise RuntimeError("初回セットアップが必要です。")
    path = Path(raw).resolve()
    if not path.exists():
        raise RuntimeError("ライブラリ保存先が見つかりません。Box Driveを確認してください。")
    if require_writable and not os.access(path, os.W_OK):
        raise RuntimeError("ライブラリは読み取り専用です。Box Driveの状態と権限を確認してください。")
    return path


def safe_item_dir(display_id: str, trashed: bool = False) -> Path:
    if not re.fullmatch(r"P\d{6}", display_id):
        raise ValueError("論文IDが不正です。")
    root = library_path() / ("trash" if trashed else "items")
    candidate = (root / display_id).resolve()
    if candidate.parent != root.resolve():
        raise ValueError("管理対象外のパスです。")
    return candidate


def hash_stream(stream: BinaryIO) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    while chunk := stream.read(1024 * 1024):
        digest.update(chunk)
        size += len(chunk)
    stream.seek(0)
    return digest.hexdigest(), size


def copy_pdf_atomic(source: BinaryIO, destination: Path, expected_hash: str) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=".paper.", suffix=".pdf.tmp", dir=destination.parent)
    try:
        digest = hashlib.sha256()
        with os.fdopen(fd, "wb") as target:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
                target.write(chunk)
            target.flush()
            os.fsync(target.fileno())
        if digest.hexdigest() != expected_hash:
            raise OSError("PDFコピー後のハッシュが一致しません。")
        os.replace(temp_name, destination)
    except Exception:
        Path(temp_name).unlink(missing_ok=True)
        raise


def normalize_doi(value: str) -> str:
    cleaned = value.strip()
    cleaned = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^doi:\s*", "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def create_lightweight_backup() -> Path:
    root = library_path(require_writable=True)
    name = f"litweave-{datetime.now().strftime('%Y%m%d-%H%M%S')}.zip"
    destination = root / "backups" / name
    fd, temp_name = tempfile.mkstemp(prefix=".backup.", suffix=".zip.tmp", dir=destination.parent)
    os.close(fd)
    try:
        with zipfile.ZipFile(temp_name, "w", zipfile.ZIP_DEFLATED) as archive:
            for folder in ("items", "citations", "config"):
                for file in (root / folder).rglob("*"):
                    if file.is_file() and file.name.lower() != "paper.pdf":
                        archive.write(file, file.relative_to(root))
        os.replace(temp_name, destination)
    except Exception:
        Path(temp_name).unlink(missing_ok=True)
        raise
    backups = sorted((root / "backups").glob("litweave-*.zip"), reverse=True)
    for old in backups[5:]:
        old.unlink()
    return destination


def remove_tree(path: Path) -> None:
    if path.parent not in {(library_path() / "items").resolve(), (library_path() / "trash").resolve()}:
        raise ValueError("管理対象外の削除は拒否されました。")
    shutil.rmtree(path)
