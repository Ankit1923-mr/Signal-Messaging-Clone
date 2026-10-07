"""
Schema verification tests.
Ensure all tables, constraints, and indexes are created correctly.
"""

import pytest
from sqlalchemy import inspect, MetaData,text
from app.database import engine, SessionLocal
from app.models import Base

def test_all_tables_exist():
    """Verify all 11 application tables are created."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    expected_tables = {
        'users', 'sessions', 'csrf_bootstrap', 'conversations',
        'conversation_members', 'groups', 'messages', 'message_receipts',
        'conversation_read_cursors', 'contacts', 'refresh_tokens'
    }

    tables.discard("alembic_version")

    assert tables == expected_tables
def test_all_tables_exist():
    """Verify all 11 tables are created."""
    inspector = inspect(engine)
    tables = inspector.get_table_names()

    expected_tables = {
        'users', 'sessions', 'csrf_bootstrap', 'conversations',
        'conversation_members', 'groups', 'messages', 'message_receipts',
        'conversation_read_cursors', 'contacts', 'refresh_tokens'
    }
    app_tables = set(tables) - {"alembic_version"}
    assert app_tables == expected_tables, f"Tables mismatch. Found: {set(tables)}, Expected: {expected_tables}"


def get_unique_columns(inspector, table_name):
    """Return unique column sets from both indexes and constraints."""
    unique_columns = {
        tuple(idx["column_names"])
        for idx in inspector.get_indexes(table_name)
        if idx.get("unique")
    }

    unique_columns.update(
        tuple(constraint["column_names"])
        for constraint in inspector.get_unique_constraints(table_name)
    )

    return unique_columns
def test_users_table_structure():
    """Verify users table has correct columns and constraints."""
    inspector = inspect(engine)
    columns = inspector.get_columns('users')
    column_names = {col['name'] for col in columns}

    expected = {'id', 'username', 'email', 'phone_number', 'password_hash', 'display_name', 'avatar_url', 'created_at'}
    assert column_names == expected

    # Check unique constraints
    indexes = inspector.get_indexes('users')
    unique_columns = get_unique_columns(inspector, "users")

    assert ("username",) in unique_columns
    assert ("email",) in unique_columns
    assert ("phone_number",) in unique_columns


def test_conversations_table_constraints():
    """Verify conversations table has type and pair_key constraints."""
    inspector = inspect(engine)

    # Check type constraint exists
    check_constraints = inspector.get_check_constraints('conversations')
    constraint_names = {c['name'] for c in check_constraints}
    assert 'ck_conversation_type' in constraint_names
    assert 'ck_conversation_type_rules' in constraint_names

    # Check direct_pair_key is unique
    unique_columns = get_unique_columns(inspector, "conversations")
    assert ("direct_pair_key",) in unique_columns


def test_message_receipts_status_constraint():
    """Verify message_receipts status values are constrained."""
    inspector = inspect(engine)
    check_constraints = inspector.get_check_constraints('message_receipts')
    constraint_names = {c['name'] for c in check_constraints}
    assert 'ck_receipt_status' in constraint_names


def test_foreign_keys_exist():
    """Verify all foreign keys are defined."""
    inspector = inspect(engine)

    # Check messages.sender_id → users.id (ON DELETE SET NULL)
    messages_fks = inspector.get_foreign_keys('messages')
    sender_fk = [fk for fk in messages_fks if fk['constrained_columns'] == ['sender_id']]
    assert len(sender_fk) == 1
    assert sender_fk[0]['referred_table'] == 'users'

    # Check groups.admin_id → users.id (ON DELETE RESTRICT)
    groups_fks = inspector.get_foreign_keys('groups')
    admin_fk = [fk for fk in groups_fks if fk['constrained_columns'] == ['admin_id']]
    assert len(admin_fk) == 1
    assert admin_fk[0]['referred_table'] == 'users'


def test_indexes_exist():
    """Verify performance indexes are created."""
    inspector = inspect(engine)

    # Users indexes
    users_indexes = inspector.get_indexes('users')
    user_index_names = {idx['name'] for idx in users_indexes}
    assert 'idx_users_username' in user_index_names
    assert 'idx_users_email' in user_index_names
    assert 'idx_users_phone' in user_index_names

    # Messages indexes
    messages_indexes = inspector.get_indexes('messages')
    message_index_names = {idx['name'] for idx in messages_indexes}
    assert 'idx_messages_conversation' in message_index_names
    assert 'idx_messages_sender' in message_index_names
    assert 'idx_messages_created' in message_index_names


def test_unique_constraints():
    """Verify unique constraints prevent duplicates."""
    inspector = inspect(engine)

    # Conversation members: (conversation_id, user_id) unique
    conv_members_constraints = inspector.get_unique_constraints('conversation_members')
    assert any(c['column_names'] == ['conversation_id', 'user_id'] for c in conv_members_constraints)

    # Message receipts: (message_id, recipient_id) unique
    receipts_constraints = inspector.get_unique_constraints('message_receipts')
    assert any(c['column_names'] == ['message_id', 'recipient_id'] for c in receipts_constraints)

    # Messages: (sender_id, client_id) unique (for idempotency)
    messages_constraints = inspector.get_unique_constraints('messages')
    assert any(c['column_names'] == ['sender_id', 'client_id'] for c in messages_constraints)


def test_fk_enforcement_enabled():
    """Verify SQLite FK enforcement is enabled."""
    db = SessionLocal()
    try:
        # Execute PRAGMA to check
        result = db.execute(text("PRAGMA foreign_keys")).fetchone()
        assert result[0] == 1, "Foreign keys are not enabled"
    finally:
        db.close()


def test_direct_pair_key_uniqueness():
    """Verify direct_pair_key prevents duplicate conversations."""
    from app.models import Conversation, User, ConversationMembers
    db = SessionLocal()

    try:
        # Clean up
        db.query(Conversation).delete()
        db.query(User).delete()
        db.commit()

        # Create users
        user1 = User(id=1, username='user1', password_hash='hash', display_name='User 1')
        user2 = User(id=2, username='user2', password_hash='hash', display_name='User 2')
        db.add_all([user1, user2])
        db.commit()

        # Create first conversation
        conv1 = Conversation(type='direct', direct_pair_key='1:2', created_by=1)
        db.add(conv1)
        db.commit()

        # Try to create duplicate (should fail with IntegrityError)
        conv2 = Conversation(type='direct', direct_pair_key='1:2', created_by=1)
        db.add(conv2)

        from sqlalchemy.exc import IntegrityError
        with pytest.raises(IntegrityError):
            db.commit()

        db.rollback()
    finally:
        db.close()


def test_message_idempotency_constraint():
    """Verify (sender_id, client_id) prevents message duplicates."""
    from app.models import Message, Conversation, User, ConversationMembers
    db = SessionLocal()

    try:
        # Clean up
        db.query(Message).delete()
        db.query(Conversation).delete()
        db.query(User).delete()
        db.commit()

        # Create user and conversation
        user = User(id=1, username='user1', password_hash='hash', display_name='User 1')
        db.add(user)
        db.commit()

        conv = Conversation(type='direct', direct_pair_key='1:2', created_by=1)
        db.add(conv)
        db.commit()

        # Create first message
        msg1 = Message(conversation_id=conv.id, sender_id=1, client_id='abc123', content='Hello')
        db.add(msg1)
        db.commit()

        # Try to create duplicate with same sender + client_id (should fail)
        msg2 = Message(conversation_id=conv.id, sender_id=1, client_id='abc123', content='Hello')
        db.add(msg2)

        from sqlalchemy.exc import IntegrityError
        with pytest.raises(IntegrityError):
            db.commit()

        db.rollback()
    finally:
        db.close()
