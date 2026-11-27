"""add base_currency to accounts

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-17
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("base_currency", sa.CHAR(3), nullable=False, server_default="USD"),
    )
    op.execute(
        "UPDATE accounts SET base_currency = 'USC' WHERE currency = 'USC' OR name ILIKE '%cent%'"
    )


def downgrade() -> None:
    op.drop_column("accounts", "base_currency")
