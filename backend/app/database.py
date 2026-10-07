"""
Database configuration with FK enforcement.
🔑 CRITICAL: Foreign key enforcement is explicitly enabled for SQLite.
"""

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

# Database URL
DATABASE_URL = "sqlite:///./messages.db"

# Create engine
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False  # Set to True for SQL logging
)

# 🔑 CRITICAL: Enable foreign key constraints in SQLite
@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """
    Enable foreign key constraints in SQLite.

    Without this, ON DELETE CASCADE, SET NULL, and RESTRICT are ignored.
    This event fires on every new connection.
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


# Session factory
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)


def get_db():
    """Dependency for getting database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Initialize database (create all tables)."""
    from app.models import Base
    Base.metadata.create_all(bind=engine)


def drop_db():
    """Drop all tables (for testing)."""
    from app.models import Base
    Base.metadata.drop_all(bind=engine)
