"""add tilt rule thresholds to accounts

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-28
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("tilt_revenge_minutes", sa.SmallInteger(), nullable=False, server_default="5"),
    )
    op.add_column(
        "accounts",
        sa.Column("tilt_size_up_multiplier", sa.Numeric(5, 2), nullable=False, server_default="1.50"),
    )
    op.add_column(
        "accounts",
        sa.Column("tilt_max_loss_streak", sa.SmallInteger(), nullable=False, server_default="3"),
    )


def downgrade() -> None:
    op.drop_column("accounts", "tilt_max_loss_streak")
    op.drop_column("accounts", "tilt_size_up_multiplier")
    op.drop_column("accounts", "tilt_revenge_minutes")
