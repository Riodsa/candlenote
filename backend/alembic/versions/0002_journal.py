"""accounts, imports, trades, deals

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    trade_side = postgresql.ENUM("buy", "sell", name="trade_side", create_type=False)
    trade_side.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False, server_default="Main Trading Account"),
        sa.Column("broker", sa.Text()),
        sa.Column("mt5_login", sa.Text()),
        sa.Column("currency", sa.CHAR(3), nullable=False, server_default="USD"),
        sa.Column("server_utc_offset", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("display_timezone", sa.Text(), nullable=False, server_default="Asia/Bangkok"),
        sa.Column("initial_balance", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("user_id", "mt5_login"),
    )

    op.create_table(
        "imports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("file_sha256", sa.CHAR(64), nullable=False),
        sa.Column("format", sa.Text(), nullable=False),
        sa.Column("rows_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rows_inserted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rows_duplicate", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rows_skipped", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("deals_inserted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reported_net_pnl", sa.Numeric(18, 2)),
        sa.Column("parsed_net_pnl", sa.Numeric(18, 2)),
        sa.Column("errors", postgresql.JSONB()),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("account_id", "file_sha256"),
        sa.CheckConstraint("format IN ('html', 'xlsx')", name="imports_format_check"),
    )

    op.create_table(
        "trades",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("import_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("imports.id", ondelete="SET NULL")),
        sa.Column("ticket", sa.BigInteger(), nullable=False),
        sa.Column("symbol", sa.Text(), nullable=False),
        sa.Column("normalized_symbol", sa.Text(), nullable=False),
        sa.Column("instrument_id", sa.Integer(), sa.ForeignKey("instruments.id")),
        sa.Column("side", trade_side, nullable=False),
        sa.Column("volume", sa.Numeric(18, 4), nullable=False),
        sa.Column("open_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("close_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("open_price", sa.Numeric(18, 6), nullable=False),
        sa.Column("close_price", sa.Numeric(18, 6), nullable=False),
        sa.Column("stop_loss", sa.Numeric(18, 6)),
        sa.Column("take_profit", sa.Numeric(18, 6)),
        sa.Column("commission", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("swap", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("fee", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("profit", sa.Numeric(18, 2), nullable=False),
        sa.Column("net_pnl", sa.Numeric(18, 2), sa.Computed("profit + commission + swap + fee", persisted=True)),
        sa.Column("close_reason", sa.Text()),
        sa.Column("comment", sa.Text()),
        sa.Column("setup_tag", sa.Text()),
        sa.Column("notes", sa.Text()),
        sa.Column("rating", sa.SmallInteger()),
        sa.UniqueConstraint("account_id", "ticket"),
        sa.CheckConstraint("rating IS NULL OR (rating BETWEEN 1 AND 5)", name="trades_rating_check"),
    )
    op.create_index("trades_acct_close", "trades", ["account_id", "close_time"])
    op.create_index("trades_acct_symbol", "trades", ["account_id", "symbol"])

    op.create_table(
        "deals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("import_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("imports.id", ondelete="SET NULL")),
        sa.Column("deal_id", sa.BigInteger(), nullable=False),
        sa.Column("order_id", sa.BigInteger()),
        sa.Column("position_id", sa.BigInteger()),
        sa.Column("time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("symbol", sa.Text()),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("direction", sa.Text()),
        sa.Column("volume", sa.Numeric(18, 4)),
        sa.Column("price", sa.Numeric(18, 6)),
        sa.Column("commission", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("fee", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("swap", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("profit", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("balance", sa.Numeric(18, 2)),
        sa.Column("comment", sa.Text()),
        sa.UniqueConstraint("account_id", "deal_id"),
    )


def downgrade() -> None:
    op.drop_table("deals")
    op.drop_index("trades_acct_symbol", table_name="trades")
    op.drop_index("trades_acct_close", table_name="trades")
    op.drop_table("trades")
    op.drop_table("imports")
    op.drop_table("accounts")
    postgresql.ENUM(name="trade_side").drop(op.get_bind(), checkfirst=True)
