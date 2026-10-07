"""Add is_verified column to users for OTP verification gating

Revision ID: 003
Revises: 002
Create Date: 2026-10-07 15:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add is_verified column, defaulting to False for new registrations.
    op.add_column(
        'users',
        sa.Column(
            'is_verified',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        )
    )

    # Existing users predate the OTP requirement — mark them verified so
    # pre-existing dev/test accounts aren't locked out by this new gate.
    op.execute("UPDATE users SET is_verified = 1 WHERE created_at < CURRENT_TIMESTAMP")


def downgrade() -> None:
    op.drop_column('users', 'is_verified')
