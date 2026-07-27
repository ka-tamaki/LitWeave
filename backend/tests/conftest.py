from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_root = Path(tempfile.mkdtemp(prefix="litweave-tests-"))
os.environ["LITWEAVE_LOCAL_DATA_DIR"] = str(_root / "local")
os.environ["LITWEAVE_ALLOW_NON_BOX"] = "1"

from backend.app.db import configure_database, reset_database  # noqa: E402
from backend.app.main import app  # noqa: E402


@pytest.fixture()
def client(tmp_path: Path):
    os.environ["LITWEAVE_LOCAL_DATA_DIR"] = str(tmp_path / "local")
    reset_database()
    with TestClient(app) as value:
        library = tmp_path / "fake-box-library"
        response = value.post("/api/setup", json={"path": str(library)})
        assert response.status_code == 200
        yield value, library


@pytest.fixture()
def pdf_bytes() -> bytes:
    return b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n"


def register(client: TestClient, pdf: bytes, title: str = "Testing Paper", **fields):
    data = {"title": title, "authors": '["Alice Example", "Bob Example"]', **fields}
    return client.post("/api/papers", data=data, files={"pdf": ("paper.pdf", pdf, "application/pdf")})
