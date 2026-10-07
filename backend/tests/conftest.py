"""
Pytest configuration and fixtures.
"""

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal, init_db, drop_db
from app.main import app


@pytest.fixture(scope="session", autouse=True)
def setup_database():
    """Initialize database once per test session."""
    init_db()
    yield
    # Don't drop for debugging; in production, drop after all tests


@pytest.fixture
def client():
    """FastAPI test client."""
    return TestClient(app)


@pytest.fixture
def db_session():
    """Database session for manual queries."""
    db = SessionLocal()
    yield db
    db.close()


@pytest.fixture(autouse=True)
def cleanup_after_test(db_session):
    """Clean up database tables after each test."""
    yield
    # Clean up specific tables used in this test
    from app.models import (
        CSRFBootstrap,
        Conversation,
        ConversationMembers,
        Group,
        Message,
        MessageReceipt,
        RefreshToken,
        User,
        Session,
    )
    db_session.query(MessageReceipt).delete()
    db_session.query(Message).delete()
    db_session.query(Group).delete()
    db_session.query(ConversationMembers).delete()
    db_session.query(Conversation).delete()
    db_session.query(RefreshToken).delete()
    db_session.query(CSRFBootstrap).delete()
    db_session.query(User).delete()
    db_session.query(Session).delete()
    db_session.commit()
