from __future__ import annotations

import json
from pathlib import Path

from backend.app import service
from backend.tests.conftest import register


def test_initial_setup_creates_canonical_structure(client):
    http, library = client
    assert {path.name for path in library.iterdir()} == {"items", "citations", "config", "trash", "backups"}
    assert (library / "config" / "keywords.json").exists()
    assert not (library / "litweave.db").exists()
    system = http.get("/api/system").json()
    assert system["configured"] and system["writable"]


def test_register_creates_pdf_metadata_and_note(client, pdf_bytes):
    http, library = client
    response = register(http, pdf_bytes, title="Carbonation study", doi="https://doi.org/10.1000/ABC")
    assert response.status_code == 201
    paper = response.json()
    item = library / "items" / "P000001"
    assert (item / "paper.pdf").read_bytes() == pdf_bytes
    assert (item / "note.md").read_text(encoding="utf-8").count("## ") == 9
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


def test_status_change_records_history_and_completed_date(client, pdf_bytes):
    http, _ = client
    paper = register(http, pdf_bytes).json()
    changed = http.patch(f"/api/papers/{paper['id']}", json={"status": "既読"}).json()
    assert changed["status"] == "既読"
    assert changed["completed_date"]
    assert [item["status"] for item in changed["status_history"]] == ["未読", "既読"]


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
