"""initial: users, instruments, watchlist_items

Revision ID: 0001
Revises:
Create Date: 2026-10-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

ASSET_CLASSES = ("stock", "etf", "forex", "metal", "crypto", "index")


def upgrade() -> None:
    asset_class = postgresql.ENUM(*ASSET_CLASSES, name="asset_class", create_type=False)
    asset_class.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("email", sa.Text(), unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_table(
        "instruments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("symbol", sa.Text(), nullable=False, unique=True),
        sa.Column("name", sa.Text()),
        sa.Column("asset_class", asset_class, nullable=False),
        sa.Column("exchange", sa.Text()),
        sa.Column("currency", sa.CHAR(3)),
        sa.Column("provider_ref", postgresql.JSONB()),
    )
    op.create_table(
        "watchlist_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("instrument_id", sa.Integer(), sa.ForeignKey("instruments.id"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text()),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("user_id", "instrument_id"),
    )


def downgrade() -> None:
    op.drop_table("watchlist_items")
    op.drop_table("instruments")
    op.drop_table("users")
    postgresql.ENUM(name="asset_class").drop(op.get_bind(), checkfirst=True)
