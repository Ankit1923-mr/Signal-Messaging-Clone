"""
Seed demo users for manually testing the New Conversation / messaging flow.

Usage (from the backend/ directory):
    python scripts/seed_demo_users.py

Safe to run repeatedly: each user is looked up by username first, and only
created if missing. Running it again never creates duplicates and never
overwrites an existing user's password/profile.

Demo users are pre-verified (is_verified=True) so they can log in directly
without the OTP step, which is convenient for manually testing the full
conversation-creation + WebSocket messaging flow across two browser
sessions. Password is intentionally the same fixed demo value for all of
them -- this is local test data, not a security boundary.
"""

import sys
from pathlib import Path

# Allow running this script directly (python scripts/seed_demo_users.py)
# without needing the package installed or PYTHONPATH set manually.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal
from app.models import User
from app.security import hash_password

DEMO_PASSWORD = "Demo@1234"

DEMO_USERS = [
    {"username": "rahul", "display_name": "Rahul Sharma"},
    {"username": "priya", "display_name": "Priya Singh"},
    {"username": "aman", "display_name": "Aman Verma"},
    {"username": "neha", "display_name": "Neha Gupta"},
]


def avatar_url_for(username: str) -> str:
    """Matches the frontend's DiceBear seed convention (see src/lib/avatar.ts)."""
    return f"thumbs:{username}"


def seed_demo_users() -> None:
    db = SessionLocal()
    try:
        created = []
        skipped = []

        for demo in DEMO_USERS:
            existing = db.query(User).filter(User.username == demo["username"]).first()
            if existing:
                skipped.append(demo["username"])
                continue

            user = User(
                username=demo["username"],
                password_hash=hash_password(DEMO_PASSWORD),
                display_name=demo["display_name"],
                avatar_url=avatar_url_for(demo["username"]),
                is_verified=True,
            )
            db.add(user)
            created.append(demo["username"])

        db.commit()

        if created:
            print(f"Created {len(created)} demo user(s): {', '.join(created)}")
        if skipped:
            print(f"Already existed, skipped: {', '.join(skipped)}")
        if not created and not skipped:
            print("No demo users configured.")

        print(f"\nDemo login password for all seeded users: {DEMO_PASSWORD}")
    finally:
        db.close()


if __name__ == "__main__":
    seed_demo_users()
