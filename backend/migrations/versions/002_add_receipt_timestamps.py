"""Add delivered_at and read_at timestamps to message_receipts

Revision ID: 002
Revises: 001
Create Date: 2026-10-07 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add delivered_at column (nullable, set when message reaches device)
    op.add_column(
        'message_receipts',
        sa.Column('delivered_at', sa.DateTime, nullable=True)
    )

    # Add read_at column (nullable, set when user opens message)
    op.add_column(
        'message_receipts',
        sa.Column('read_at', sa.DateTime, nullable=True)
    )


def downgrade() -> None:
    op.drop_column('message_receipts', 'read_at')
    op.drop_column('message_receipts', 'delivered_at')
