"""Add PDF replacement timestamp for LitWeave 0.0.2."""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("papers")}
    if "pdf_replaced_at" not in columns:
        op.add_column("papers", sa.Column("pdf_replaced_at", sa.String(length=40), nullable=True))


def downgrade():
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("papers")}
    if "pdf_replaced_at" in columns:
        op.drop_column("papers", "pdf_replaced_at")
