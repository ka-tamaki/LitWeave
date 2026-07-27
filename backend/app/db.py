from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text, create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker


def local_data_dir() -> Path:
    override = os.getenv("LITWEAVE_LOCAL_DATA_DIR")
    if override:
        return Path(override).resolve()
    root = os.getenv("LOCALAPPDATA")
    if not root:
        raise RuntimeError("LOCALAPPDATAが見つかりません。Windowsのユーザーデータ領域を確認してください。")
    return (Path(root) / "LitWeave").resolve()


class Base(DeclarativeBase):
    pass


class PaperKeyword(Base):
    __tablename__ = "paper_keywords"
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), primary_key=True)
    keyword_id: Mapped[str] = mapped_column(ForeignKey("keywords.id", ondelete="CASCADE"), primary_key=True)


class Paper(Base):
    __tablename__ = "papers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    display_id: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    title: Mapped[str] = mapped_column(Text)
    authors: Mapped[list[str]] = mapped_column(JSON, default=list)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    journal: Mapped[str] = mapped_column(Text, default="")
    volume: Mapped[str] = mapped_column(Text, default="")
    issue: Mapped[str] = mapped_column(Text, default="")
    pages: Mapped[str] = mapped_column(Text, default="")
    doi: Mapped[str] = mapped_column(Text, default="")
    url: Mapped[str] = mapped_column(Text, default="")
    language: Mapped[str] = mapped_column(String(16), default="日本語")
    abstract: Mapped[str] = mapped_column(Text, default="")
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completed_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    remarks: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="未読", index=True)
    status_history: Mapped[list[dict]] = mapped_column(JSON, default=list)
    pdf_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    pdf_size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(String(40))
    updated_at: Mapped[str] = mapped_column(String(40))
    has_note: Mapped[bool] = mapped_column(Boolean, default=False)
    trashed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    deleted_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    keywords: Mapped[list["Keyword"]] = relationship(
        secondary="paper_keywords", back_populates="papers", lazy="selectin"
    )
    tasks: Mapped[list["Task"]] = relationship(
        back_populates="paper", cascade="all, delete-orphan", lazy="selectin", order_by="Task.created_at"
    )


class Keyword(Base):
    __tablename__ = "keywords"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    normalized_name: Mapped[str] = mapped_column(Text, unique=True, index=True)
    color: Mapped[str] = mapped_column(String(7), default="#4f6f64")
    created_at: Mapped[str] = mapped_column(String(40))
    updated_at: Mapped[str] = mapped_column(String(40))
    papers: Mapped[list[Paper]] = relationship(
        secondary="paper_keywords", back_populates="keywords", lazy="selectin"
    )


class Citation(Base):
    __tablename__ = "citations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("papers.id"))
    target_id: Mapped[str] = mapped_column(ForeignKey("papers.id"))
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[str] = mapped_column(String(40))


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text, default="")
    completed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[str] = mapped_column(String(40))
    updated_at: Mapped[str] = mapped_column(String(40))
    paper: Mapped[Paper] = relationship(back_populates="tasks")


_engine = None
SessionLocal = sessionmaker(expire_on_commit=False)


def configure_database() -> None:
    global _engine
    if _engine is not None:
        _engine.dispose()
    data_dir = local_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    _engine = create_engine(f"sqlite:///{data_dir / 'litweave.db'}", connect_args={"check_same_thread": False})
    SessionLocal.configure(bind=_engine)
    Base.metadata.create_all(_engine)
    if "description" not in {column["name"] for column in inspect(_engine).get_columns("tasks")}:
        with _engine.begin() as connection:
            connection.execute(text("ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''"))


def reset_database() -> None:
    global _engine
    if _engine is not None:
        _engine.dispose()
    db_path = local_data_dir() / "litweave.db"
    if db_path.exists():
        db_path.unlink()
    configure_database()
