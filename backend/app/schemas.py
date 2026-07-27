from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

ReadingStatus = Literal["未読", "読書中", "既読", "再確認"]


class SetupRequest(BaseModel):
    path: str = Field(min_length=1)


class PaperUpdate(BaseModel):
    title: str | None = None
    authors: list[str] | None = None
    year: int | None = Field(default=None, ge=1000, le=9999)
    journal: str | None = None
    volume: str | None = None
    issue: str | None = None
    pages: str | None = None
    doi: str | None = None
    url: str | None = None
    language: str | None = None
    abstract: str | None = None
    rating: int | None = Field(default=None, ge=1, le=5)
    completed_date: str | None = None
    remarks: str | None = None
    status: ReadingStatus | None = None
    keyword_ids: list[str] | None = None

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("タイトルは空欄にできません。")
        return value.strip() if value is not None else None


class NoteUpdate(BaseModel):
    content: str


class KeywordCreate(BaseModel):
    name: str = Field(min_length=1)
    color: str = "#4f6f64"


class KeywordUpdate(BaseModel):
    name: str | None = None
    color: str | None = None


class KeywordMerge(BaseModel):
    target_id: str


class CitationCreate(BaseModel):
    source_id: str
    target_id: str
    note: str = ""


class TemplateUpdate(BaseModel):
    sections: list[str]

    @field_validator("sections")
    @classmethod
    def sections_valid(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values if value.strip()]
        if not cleaned:
            raise ValueError("メモテンプレートには1つ以上のセクションが必要です。")
        return cleaned
