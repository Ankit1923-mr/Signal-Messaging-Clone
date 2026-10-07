"""
Initial schema creation with all CHECK constraints.

Revision ID: 001
Create Date: 2026-10-07
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = '001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    """Create all tables with constraints and indexes."""

    # Users
    op.create_table(
        'users',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('username', sa.String(50), nullable=False, unique=True),
        sa.Column('email', sa.String(100), unique=True),
        sa.Column('phone_number', sa.String(15), unique=True),
        sa.Column('password_hash', sa.String(255), nullable=False),
        sa.Column('display_name', sa.String(100), nullable=False),
        sa.Column('avatar_url', sa.String(255)),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.current_timestamp()),
    )
    op.create_index('idx_users_username', 'users', ['username'])
    op.create_index('idx_users_email', 'users', ['email'])
    op.create_index('idx_users_phone', 'users', ['phone_number'])

    # Sessions
    op.create_table(
        'sessions',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.Column('expires_at', sa.DateTime, nullable=False),
        sa.CheckConstraint('expires_at > created_at', name='ck_sessions_expiry'),
    )
    op.create_index('idx_sessions_expires', 'sessions', ['expires_at'])

    # CSRF Bootstrap
    op.create_table(
        'csrf_bootstrap',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('session_id', sa.String(64), nullable=False, unique=True),
        sa.Column('token_hash', sa.String(64), nullable=False, unique=True),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.Column('expires_at', sa.DateTime, nullable=False),
        sa.Column('used', sa.Boolean, default=False),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='CASCADE'),
        sa.CheckConstraint('expires_at > created_at', name='ck_csrf_bootstrap_expiry'),
    )
    op.create_index('idx_csrf_session', 'csrf_bootstrap', ['session_id'])
    op.create_index('idx_csrf_expires', 'csrf_bootstrap', ['expires_at'])

    # Conversations
    op.create_table(
        'conversations',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('type', sa.String(10), nullable=False),
        sa.Column('name', sa.String(255)),
        sa.Column('created_by', sa.Integer),
        sa.Column('direct_pair_key', sa.String(20), unique=True),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.CheckConstraint("type IN ('direct', 'group')", name='ck_conversation_type'),
        sa.CheckConstraint(
            "(type = 'direct' AND direct_pair_key IS NOT NULL AND name IS NULL) "
            "OR (type = 'group' AND direct_pair_key IS NULL AND name IS NOT NULL)",
            name='ck_conversation_type_rules'
        ),
    )
    op.create_index('idx_conversations_type', 'conversations', ['type'])
    op.create_index('idx_conversations_pair_key', 'conversations', ['direct_pair_key'])

    # Conversation Members
    op.create_table(
        'conversation_members',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('conversation_id', sa.Integer, nullable=False),
        sa.Column('user_id', sa.Integer, nullable=False),
        sa.Column('joined_at', sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.UniqueConstraint('conversation_id', 'user_id'),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    )
    op.create_index('idx_conv_members_conversation', 'conversation_members', ['conversation_id'])
    op.create_index('idx_conv_members_user', 'conversation_members', ['user_id'])

    # Groups
    op.create_table(
        'groups',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('conversation_id', sa.Integer, nullable=False, unique=True),
        sa.Column('admin_id', sa.Integer, nullable=False),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['admin_id'], ['users.id'], ondelete='RESTRICT'),
    )
    op.create_index('idx_groups_admin', 'groups', ['admin_id'])

    # Messages
    op.create_table(
        'messages',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('conversation_id', sa.Integer, nullable=False),
        sa.Column('sender_id', sa.Integer),
        sa.Column('client_id', sa.String(64), nullable=False),
        sa.Column('content', sa.Text, nullable=False),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.UniqueConstraint('sender_id', 'client_id'),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['sender_id'], ['users.id'], ondelete='SET NULL'),
    )
    op.create_index('idx_messages_conversation', 'messages', ['conversation_id'])
    op.create_index('idx_messages_sender', 'messages', ['sender_id'])
    op.create_index('idx_messages_created', 'messages', ['created_at'])

    # Message Receipts
    op.create_table(
        'message_receipts',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('message_id', sa.Integer, nullable=False),
        sa.Column('recipient_id', sa.Integer, nullable=False),
        sa.Column('status', sa.String(20), default='pending', nullable=False),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.UniqueConstraint('message_id', 'recipient_id'),
        sa.ForeignKeyConstraint(['message_id'], ['messages.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['recipient_id'], ['users.id'], ondelete='CASCADE'),
        sa.CheckConstraint("status IN ('pending', 'delivered', 'read')", name='ck_receipt_status'),
    )
    op.create_index('idx_receipts_message', 'message_receipts', ['message_id'])
    op.create_index('idx_receipts_recipient', 'message_receipts', ['recipient_id'])
    op.create_index('idx_receipts_status', 'message_receipts', ['status'])

    # Read Cursors
    op.create_table(
        'conversation_read_cursors',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('conversation_id', sa.Integer, nullable=False),
        sa.Column('user_id', sa.Integer, nullable=False),
        sa.Column('last_read_message_id', sa.Integer),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.UniqueConstraint('conversation_id', 'user_id'),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['last_read_message_id'], ['messages.id'], ondelete='SET NULL'),
    )
    op.create_index('idx_read_cursors_conversation', 'conversation_read_cursors', ['conversation_id'])

    # Contacts
    op.create_table(
        'contacts',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer, nullable=False),
        sa.Column('contact_id', sa.Integer, nullable=False),
        sa.Column('added_at', sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.UniqueConstraint('user_id', 'contact_id'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['contact_id'], ['users.id'], ondelete='CASCADE'),
        sa.CheckConstraint('user_id != contact_id', name='ck_contacts_self_ref'),
    )
    op.create_index('idx_contacts_user', 'contacts', ['user_id'])

    # Refresh Tokens
    op.create_table(
        'refresh_tokens',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer, nullable=False),
        sa.Column('token_hash', sa.String(64), nullable=False, unique=True),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.current_timestamp()),
        sa.Column('expires_at', sa.DateTime, nullable=False),
        sa.Column('revoked', sa.Boolean, default=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.CheckConstraint('expires_at > created_at', name='ck_refresh_tokens_expiry'),
    )
    op.create_index('idx_refresh_tokens_user', 'refresh_tokens', ['user_id'])
    op.create_index('idx_refresh_tokens_expires', 'refresh_tokens', ['expires_at'])


def downgrade():
    """Drop all tables."""
    op.drop_table('refresh_tokens')
    op.drop_table('contacts')
    op.drop_table('conversation_read_cursors')
    op.drop_table('message_receipts')
    op.drop_table('messages')
    op.drop_table('groups')
    op.drop_table('conversation_members')
    op.drop_table('conversations')
    op.drop_table('csrf_bootstrap')
    op.drop_table('sessions')
    op.drop_table('users')
