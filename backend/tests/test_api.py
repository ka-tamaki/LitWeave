from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from backend.app import db, service
from backend.tests.conftest import register


def test_initial_setup_creates_canonical_structure(client):
    http, library = client
    assert {path.name for path in library.iterdir()} == {"items", "citations", "config", "trash", "backups"}
    assert (library / "config" / "keywords.json").exists()
    assert not (library / "litweave.db").exists()
    system = http.get("/api/system").json()
    assert system["configured"] and system["writable"]
    assert system["version"] == "0.2.0"


def test_register_creates_pdf_metadata_and_note(client, pdf_bytes):
    http, library = client
    response = register(http, pdf_bytes, title="Carbonation study", doi="https://doi.org/10.1000/ABC")
    assert response.status_code == 201
    paper = response.json()
    item = library / "items" / "P000001"
    assert (item / "paper.pdf").read_bytes() == pdf_bytes
    assert (item / "note.md").read_text(encoding="utf-8") == """## 要約

## 研究方法・条件

## 主な結果

## 評価・疑問

## 自分の研究への活用

## 関連文献
"""
    metadata = json.loads((item / "metadata.json").read_text(encoding="utf-8"))
    assert metadata["schema_version"] == 1
    assert metadata["doi"] == "10.1000/ABC"
    assert paper["status"] == "未読"


def test_register_treats_blank_year_as_unset(client, pdf_bytes):
    http, _ = client
    response = register(http, pdf_bytes, year="")
    assert response.status_code == 201
    assert response.json()["year"] is None


def test_register_assigns_selected_existing_keywords(client, pdf_bytes):
    http, library = client
    existing = http.post("/api/keywords", json={"name": "Carbon", "color": "#112233"}).json()
    response = register(
        http,
        pdf_bytes,
        keyword_ids=json.dumps([existing["id"]]),
    )
    assert response.status_code == 201
    paper = response.json()
    assert [value["name"] for value in paper["keywords"]] == ["Carbon"]
    metadata = json.loads((library / "items" / paper["display_id"] / "metadata.json").read_text(encoding="utf-8"))
    assert [value["name"] for value in metadata["keywords"]] == ["Carbon"]
    canonical = json.loads((library / "config" / "keywords.json").read_text(encoding="utf-8"))
    assert [value["name"] for value in canonical["keywords"]] == ["Carbon"]


def test_pdf_hash_duplicate_is_rejected(client, pdf_bytes):
    http, _ = client
    assert register(http, pdf_bytes).status_code == 201
    response = register(http, pdf_bytes, title="別タイトル")
    assert response.status_code == 409
    assert "P000001" in response.json()["detail"]["message"]


def test_metadata_duplicate_warns_and_can_register_separately(client, pdf_bytes):
    http, _ = client
    existing = register(
        http,
        pdf_bytes,
        title="Ａｌｐｈａ　Paper",
        year="2025",
        doi="https://doi.org/10.1000/ABC",
    ).json()
    warning = register(
        http,
        pdf_bytes + b"second",
        title="alpha paper",
        year="2025",
        doi="doi:10.1000/abc",
    )
    assert warning.status_code == 409
    detail = warning.json()["detail"]
    assert detail["code"] == "metadata_duplicate"
    assert detail["candidates"][0]["id"] == existing["id"]
    assert set(detail["candidates"][0]["reasons"]) == {"DOI一致", "タイトル・発行年一致"}

    separate = register(
        http,
        pdf_bytes + b"second",
        title="alpha paper",
        year="2025",
        doi="doi:10.1000/abc",
        allow_metadata_duplicate="true",
    )
    assert separate.status_code == 201
    assert separate.json()["id"] != existing["id"]


def test_title_duplicate_warns_when_one_year_is_blank(client, pdf_bytes):
    http, _ = client
    register(http, pdf_bytes, title="Same title", year="2024")
    warning = register(http, pdf_bytes + b"second", title=" same  title ", year="")
    assert warning.status_code == 409
    assert warning.json()["detail"]["candidates"][0]["reasons"] == ["タイトル一致・発行年未入力"]


def test_pdf_replacement_keeps_only_one_previous_version_and_rebuilds(client, pdf_bytes):
    http, library = client
    paper = register(http, pdf_bytes, title="Replace me").json()
    item = library / "items" / paper["display_id"]
    second = pdf_bytes + b"second"
    replaced = http.post(
        f"/api/papers/{paper['id']}/pdf",
        files={"pdf": ("replacement.pdf", second, "application/pdf")},
    )
    assert replaced.status_code == 200
    assert (item / "paper.pdf").read_bytes() == second
    assert (item / "versions" / "paper.pdf").read_bytes() == pdf_bytes
    assert replaced.json()["pdf_hash"] != paper["pdf_hash"]
    assert replaced.json()["pdf_size"] == len(second)
    assert replaced.json()["pdf_replaced_at"]
    metadata = json.loads((item / "metadata.json").read_text(encoding="utf-8"))
    assert metadata["pdf_replaced_at"] == replaced.json()["pdf_replaced_at"]

    third = pdf_bytes + b"third"
    replaced_again = http.post(
        f"/api/papers/{paper['id']}/pdf",
        files={"pdf": ("replacement.pdf", third, "application/pdf")},
    )
    assert replaced_again.status_code == 200
    assert (item / "paper.pdf").read_bytes() == third
    assert (item / "versions" / "paper.pdf").read_bytes() == second
    assert [path.name for path in (item / "versions").iterdir()] == ["paper.pdf"]

    assert http.post("/api/maintenance/rebuild").json()["errors"] == []
    rebuilt = http.get(f"/api/papers/{paper['id']}").json()
    assert rebuilt["pdf_hash"] == replaced_again.json()["pdf_hash"]
    assert rebuilt["pdf_replaced_at"] == replaced_again.json()["pdf_replaced_at"]


def test_pdf_replacement_failure_restores_current_pdf(client, pdf_bytes, monkeypatch):
    http, library = client
    paper = register(http, pdf_bytes, title="Keep current").json()
    item = library / "items" / paper["display_id"]

    def fail_persist(_paper):
        raise OSError("simulated")

    monkeypatch.setattr(service, "persist_paper", fail_persist)
    response = http.post(
        f"/api/papers/{paper['id']}/pdf",
        files={"pdf": ("replacement.pdf", pdf_bytes + b"new", "application/pdf")},
    )
    assert response.status_code == 503
    assert (item / "paper.pdf").read_bytes() == pdf_bytes
    assert not (item / "versions" / "paper.pdf").exists()
    assert http.get(f"/api/papers/{paper['id']}").json()["pdf_hash"] == paper["pdf_hash"]


def test_registration_failure_removes_partial_directory(client, pdf_bytes, monkeypatch):
    http, library = client
    def fail_copy(*_args, **_kwargs):
        raise OSError("simulated")
    monkeypatch.setattr(service, "copy_pdf_atomic", fail_copy)
    response = register(http, pdf_bytes)
    assert response.status_code == 503
    assert "OSエラー" in response.json()["detail"]
    assert list((library / "items").iterdir()) == []
    assert http.get("/api/papers").json() == []


def test_doi_normalization_variants(client, pdf_bytes):
    http, _ = client
    paper = register(http, pdf_bytes, doi=" doi: 10.5555/Test ").json()
    assert paper["doi"] == "10.5555/Test"


def test_previous_default_note_templates_use_current_default(client, pdf_bytes):
    http, library = client
    from backend.app.storage import (
        LEGACY_NOTE_TEMPLATE,
        NOTE_TEMPLATE,
        PREVIOUS_NOTE_TEMPLATE,
        effective_note_template,
    )

    settings_path = library / "config" / "settings.json"
    settings = json.loads(settings_path.read_text(encoding="utf-8"))
    assert effective_note_template({"note_template": LEGACY_NOTE_TEMPLATE}) == NOTE_TEMPLATE
    settings["note_template"] = PREVIOUS_NOTE_TEMPLATE
    settings_path.write_text(json.dumps(settings, ensure_ascii=False), encoding="utf-8")

    assert http.get("/api/settings/template").json()["content"] == NOTE_TEMPLATE
    paper = register(http, pdf_bytes).json()
    assert (library / "items" / paper["display_id"] / "note.md").read_text(encoding="utf-8") == NOTE_TEMPLATE


def test_status_change_records_history_and_completed_date(client, pdf_bytes):
    http, _ = client
    paper = register(http, pdf_bytes).json()
    changed = http.patch(f"/api/papers/{paper['id']}", json={"status": "既読"}).json()
    assert changed["status"] == "既読"
    assert changed["completed_date"]
    assert [item["status"] for item in changed["status_history"]] == ["未読", "既読"]


def test_tasks_are_persisted_completed_deleted_and_rebuilt(client, pdf_bytes):
    http, library = client
    paper = register(http, pdf_bytes).json()
    created = http.post(
        f"/api/papers/{paper['id']}/tasks",
        json={"title": "  関連論文を読む  ", "description": "  参考文献の3番を確認する  "},
    )
    assert created.status_code == 201
    task = created.json()
    assert task["title"] == "関連論文を読む"
    assert task["description"] == "参考文献の3番を確認する"
    assert task["completed"] is False

    listed = http.get("/api/papers").json()[0]
    assert listed["tasks"] == [task]
    metadata_path = library / "items" / paper["display_id"] / "metadata.json"
    assert json.loads(metadata_path.read_text(encoding="utf-8"))["tasks"] == [task]

    completed = http.patch(
        f"/api/papers/{paper['id']}/tasks/{task['id']}",
        json={"title": "関連研究を読む", "description": "方法を比較する", "completed": True},
    )
    assert completed.status_code == 200
    assert completed.json()["title"] == "関連研究を読む"
    assert completed.json()["description"] == "方法を比較する"
    assert completed.json()["completed"] is True
    assert http.post("/api/maintenance/rebuild").json()["errors"] == []
    rebuilt = http.get(f"/api/papers/{paper['id']}").json()
    assert rebuilt["tasks"][0]["completed"] is True

    deleted = http.delete(f"/api/papers/{paper['id']}/tasks/{task['id']}")
    assert deleted.status_code == 204
    assert http.get(f"/api/papers/{paper['id']}").json()["tasks"] == []
    assert json.loads(metadata_path.read_text(encoding="utf-8"))["tasks"] == []


def test_existing_task_index_gets_description_column(tmp_path, monkeypatch):
    local = tmp_path / "local"
    local.mkdir()
    monkeypatch.setenv("LITWEAVE_LOCAL_DATA_DIR", str(local))
    with sqlite3.connect(local / "litweave.db") as connection:
        connection.execute("CREATE TABLE papers (id TEXT PRIMARY KEY)")
        connection.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY)")
    db.configure_database()
    with sqlite3.connect(local / "litweave.db") as connection:
        task_columns = {value[1] for value in connection.execute("PRAGMA table_info(tasks)")}
        paper_columns = {value[1] for value in connection.execute("PRAGMA table_info(papers)")}
    assert "description" in task_columns
    assert "pdf_replaced_at" in paper_columns


def test_search_only_title_authors_keywords_and_all_terms(client, pdf_bytes):
    http, _ = client
    first = register(http, pdf_bytes, title="Alpha mechanics", journal="Secret Journal", abstract="hiddenword").json()
    second_pdf = pdf_bytes + b"2"
    second = register(http, second_pdf, title="Beta paper", remarks="hiddenremark").json()
    keyword = http.post("/api/keywords", json={"name": "Carbon", "color": "#112233"}).json()
    http.patch(f"/api/papers/{first['id']}", json={"keyword_ids": [keyword["id"]]})
    assert [value["id"] for value in http.get("/api/papers?q=alpha+carbon").json()] == [first["id"]]
    assert http.get("/api/papers?q=alice").json()
    assert http.get("/api/papers?q=hiddenword").json() == []
    assert http.get("/api/papers?q=secret").json() == []
    assert http.get("/api/papers?q=hiddenremark").json() == []
    assert second["id"] not in [value["id"] for value in http.get("/api/papers?q=carbon").json()]


def test_keyword_casefold_duplicate_merge_and_delete_rules(client, pdf_bytes):
    http, _ = client
    paper = register(http, pdf_bytes).json()
    source = http.post("/api/keywords", json={"name": "Concrete"}).json()
    assert http.post("/api/keywords", json={"name": "concrete"}).status_code == 409
    target = http.post("/api/keywords", json={"name": "CO2"}).json()
    http.patch(f"/api/papers/{paper['id']}", json={"keyword_ids": [source["id"]]})
    assert http.delete(f"/api/keywords/{source['id']}").status_code == 409
    assert http.post(f"/api/keywords/{source['id']}/merge", json={"target_id": target["id"]}).status_code == 200
    detail = http.get(f"/api/papers/{paper['id']}").json()
    assert [value["name"] for value in detail["keywords"]] == ["CO2"]


def test_citation_rejects_self_and_duplicate(client, pdf_bytes):
    http, _ = client
    one = register(http, pdf_bytes, title="One").json()
    two = register(http, pdf_bytes + b"two", title="Two").json()
    assert http.post("/api/citations", json={"source_id": one["id"], "target_id": one["id"]}).status_code == 400
    body = {"source_id": one["id"], "target_id": two["id"], "note": "p. 2"}
    assert http.post("/api/citations", json=body).status_code == 201
    assert http.post("/api/citations", json=body).status_code == 409


def test_trash_restore_and_permanent_delete_citations(client, pdf_bytes):
    http, library = client
    one = register(http, pdf_bytes, title="One").json()
    two = register(http, pdf_bytes + b"two", title="Two").json()
    http.post("/api/citations", json={"source_id": one["id"], "target_id": two["id"]})
    assert http.post(f"/api/papers/{one['id']}/trash").status_code == 200
    assert not (library / "items" / one["display_id"]).exists()
    assert (library / "trash" / one["display_id"]).exists()
    assert len(http.get("/api/citations").json()) == 1
    assert http.post(f"/api/papers/{one['id']}/restore").status_code == 200
    http.post(f"/api/papers/{one['id']}/trash")
    assert http.delete(f"/api/papers/{one['id']}").status_code == 204
    assert http.get("/api/citations").json() == []


def test_rebuild_continues_after_bad_metadata(client, pdf_bytes):
    http, library = client
    paper = register(http, pdf_bytes).json()
    bad = library / "items" / "P999999"
    bad.mkdir()
    (bad / "metadata.json").write_text("{bad json", encoding="utf-8")
    result = http.post("/api/maintenance/rebuild").json()
    assert result["indexed"] == 1
    assert result["errors"][0]["id"] == "P999999"
    assert http.get(f"/api/papers/{paper['id']}").status_code == 200


def test_path_traversal_is_rejected(client):
    http, _ = client
    response = http.get("/api/papers/../../outside")
    assert response.status_code in {404, 405}
    from backend.app.storage import safe_item_dir
    try:
        safe_item_dir("../../outside")
        assert False, "traversal should fail"
    except ValueError:
        pass
