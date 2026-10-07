"""Add reply_to_message_id to messages for Signal-style reply-to-message

Revision ID: 004
Revises: 003
Create Date: 2026-10-08 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable, self-referential FK: most messages are not replies. SET
    # NULL on delete means a reply never blocks deleting the message it
    # quoted -- it just becomes an "original message unavailable" reply,
    # which the API/frontend already handle gracefully (see
    # MessagingService.send_message and MessageItem.tsx).
    #
    # SQLite can't ALTER TABLE ADD CONSTRAINT directly, so this goes
    # through Alembic's batch mode, which recreates the table under the
    # hood (same approach SQLite migrations always need).
    with op.batch_alter_table('messages') as batch_op:
        batch_op.add_column(sa.Column('reply_to_message_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            'fk_messages_reply_to_message_id',
            'messages',
            ['reply_to_message_id'], ['id'],
            ondelete='SET NULL'
        )
        batch_op.create_index('idx_messages_reply_to', ['reply_to_message_id'])


def downgrade() -> None:
    with op.batch_alter_table('messages') as batch_op:
        batch_op.drop_index('idx_messages_reply_to')
        batch_op.drop_constraint('fk_messages_reply_to_message_id', type_='foreignkey')
        batch_op.drop_column('reply_to_message_id')
