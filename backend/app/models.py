"""
SQLAlchemy ORM models matching canonical database schema.
Source of truth for all database operations.
"""

from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Boolean, ForeignKey,
    UniqueConstraint, CheckConstraint, Index
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()


class User(Base):
    """User account."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), nullable=False, unique=True, index=True)
    email = Column(String(100), unique=True, nullable=True, index=True)
    phone_number = Column(String(15), unique=True, nullable=True, index=True)
    password_hash = Column(String(255), nullable=False)
    display_name = Column(String(100), nullable=False)
    avatar_url = Column(String(255))
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    conversations = relationship("Conversation", back_populates="creator", foreign_keys="Conversation.created_by")
    memberships = relationship("ConversationMembers", back_populates="user", cascade="all, delete-orphan")
    messages = relationship("Message", back_populates="sender", cascade="all, delete-orphan")
    receipts = relationship("MessageReceipt", back_populates="recipient", cascade="all, delete-orphan")
    groups_admin = relationship("Group", back_populates="admin", foreign_keys="Group.admin_id")
    contacts = relationship("Contact", back_populates="user", foreign_keys="Contact.user_id", cascade="all, delete-orphan")
    refresh_tokens = relationship("RefreshToken", back_populates="user", cascade="all, delete-orphan")
    read_cursors = relationship("ConversationReadCursor", back_populates="user", cascade="all, delete-orphan")


class Session(Base):
    """Browser session for CSRF bootstrap."""
    __tablename__ = "sessions"

    id = Column(String(64), primary_key=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)

    # Constraints
    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="ck_sessions_expiry"),
        Index("idx_sessions_expires", "expires_at"),
    )


class CSRFBootstrap(Base):
    """CSRF token for unauthenticated login."""
    __tablename__ = "csrf_bootstrap"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(64), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, unique=True)
    token_hash = Column(String(64), nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False)

    # Constraints
    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="ck_csrf_bootstrap_expiry"),
        Index("idx_csrf_session", "session_id"),
        Index("idx_csrf_expires", "expires_at"),
    )


class Conversation(Base):
    """1-on-1 or group conversation."""
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    type = Column(String(10), nullable=False)  # 'direct' or 'group'
    name = Column(String(255))  # NULL for direct chats
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    direct_pair_key = Column(String(20), unique=True)  # "1:5" for direct chats
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    creator = relationship("User", back_populates="conversations", foreign_keys=[created_by])
    members = relationship("ConversationMembers", back_populates="conversation", cascade="all, delete-orphan")
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")
    group = relationship("Group", back_populates="conversation", uselist=False, cascade="all, delete-orphan")
    read_cursors = relationship("ConversationReadCursor", back_populates="conversation", cascade="all, delete-orphan")

    # Constraints
    __table_args__ = (
        CheckConstraint("type IN ('direct', 'group')", name="ck_conversation_type"),
        CheckConstraint(
            "(type = 'direct' AND direct_pair_key IS NOT NULL AND name IS NULL) "
            "OR (type = 'group' AND direct_pair_key IS NULL AND name IS NOT NULL)",
            name="ck_conversation_type_rules"
        ),
        Index("idx_conversations_type", "type"),
        Index("idx_conversations_pair_key", "direct_pair_key"),
    )


class ConversationMembers(Base):
    """Membership in conversation."""
    __tablename__ = "conversation_members"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    joined_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    conversation = relationship("Conversation", back_populates="members")
    user = relationship("User", back_populates="memberships")

    # Constraints
    __table_args__ = (
        UniqueConstraint("conversation_id", "user_id"),
        Index("idx_conv_members_conversation", "conversation_id"),
        Index("idx_conv_members_user", "user_id"),
    )


class Group(Base):
    """Group chat metadata."""
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, unique=True)
    admin_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    conversation = relationship("Conversation", back_populates="group")
    admin = relationship("User", back_populates="groups_admin", foreign_keys=[admin_id])

    # Constraints
    __table_args__ = (
        Index("idx_groups_admin", "admin_id"),
    )


class Message(Base):
    """Chat message."""
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    sender_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))  # NULL for deleted users
    client_id = Column(String(64), nullable=False)  # For idempotency
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    conversation = relationship("Conversation", back_populates="messages")
    sender = relationship("User", back_populates="messages")
    receipts = relationship("MessageReceipt", back_populates="message", cascade="all, delete-orphan")

    # Constraints
    __table_args__ = (
        UniqueConstraint("sender_id", "client_id"),  # Prevents duplicate sends
        Index("idx_messages_conversation", "conversation_id"),
        Index("idx_messages_sender", "sender_id"),
        Index("idx_messages_created", "created_at"),
    )


class MessageReceipt(Base):
    """Per-recipient message delivery/read status."""
    __tablename__ = "message_receipts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    message_id = Column(Integer, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False)
    recipient_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(20), default="pending", nullable=False)  # pending, delivered, read
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    message = relationship("Message", back_populates="receipts")
    recipient = relationship("User", back_populates="receipts")

    # Constraints
    __table_args__ = (
        UniqueConstraint("message_id", "recipient_id"),  # One receipt per recipient per message
        CheckConstraint("status IN ('pending', 'delivered', 'read')", name="ck_receipt_status"),
        Index("idx_receipts_message", "message_id"),
        Index("idx_receipts_recipient", "recipient_id"),
        Index("idx_receipts_status", "status"),
    )


class ConversationReadCursor(Base):
    """Per-user read position in conversation."""
    __tablename__ = "conversation_read_cursors"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    last_read_message_id = Column(Integer, ForeignKey("messages.id", ondelete="SET NULL"))  # NULL if no messages read
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    conversation = relationship("Conversation", back_populates="read_cursors")
    user = relationship("User", back_populates="read_cursors")

    # Constraints
    __table_args__ = (
        UniqueConstraint("conversation_id", "user_id"),
        Index("idx_read_cursors_conversation", "conversation_id"),
    )


class Contact(Base):
    """User contact list."""
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    contact_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    added_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User", back_populates="contacts", foreign_keys=[user_id])

    # Constraints
    __table_args__ = (
        UniqueConstraint("user_id", "contact_id"),
        CheckConstraint("user_id != contact_id", name="ck_contacts_self_ref"),
        Index("idx_contacts_user", "user_id"),
    )


class RefreshToken(Base):
    """Refresh tokens for authentication."""
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash = Column(String(64), nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    revoked = Column(Boolean, default=False)

    # Relationships
    user = relationship("User", back_populates="refresh_tokens")

    # Constraints
    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="ck_refresh_tokens_expiry"),
        Index("idx_refresh_tokens_user", "user_id"),
        Index("idx_refresh_tokens_expires", "expires_at"),
    )
