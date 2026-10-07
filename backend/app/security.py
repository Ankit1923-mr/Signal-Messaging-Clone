"""
Security utilities for authentication.
- Password hashing (bcrypt, work factor 12)
- JWT token generation/validation
- CSRF token management
"""

import hashlib
import os
import secrets
from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

# Configuration
SECRET_KEY = os.getenv("JWT_SECRET", "dev-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_SECONDS = 7 * 24 * 60 * 60  # 7 days
REFRESH_TOKEN_EXPIRE_SECONDS = 30 * 24 * 60 * 60  # 30 days

# Password hashing context (bcrypt, work factor 12)
pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__rounds=12
)


# ============================================================================
# PASSWORD HASHING
# ============================================================================

def hash_password(password: str) -> str:
    """Hash password using bcrypt (work factor 12)."""
    return pwd_context.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    """Verify password against bcrypt hash."""
    return pwd_context.verify(password, hashed_password)


# ============================================================================
# JWT TOKENS
# ============================================================================

def create_access_token(user_id: int) -> str:
    """
    Create JWT access token (7 days expiry).

    Payload:
      - sub: user_id (as string)
      - type: "access"
      - exp: expiration timestamp
    """
    payload = {
        "sub": str(user_id),
        "type": "access",
        "exp": datetime.utcnow() + timedelta(seconds=ACCESS_TOKEN_EXPIRE_SECONDS),
        "jti": secrets.token_hex(16),  # Ensures uniqueness even for same-second issuance
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(user_id: int) -> str:
    """
    Create JWT refresh token (30 days expiry).

    Payload:
      - sub: user_id (as string)
      - type: "refresh"
      - exp: expiration timestamp
    """
    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "exp": datetime.utcnow() + timedelta(seconds=REFRESH_TOKEN_EXPIRE_SECONDS),
        "jti": secrets.token_hex(16),  # Ensures uniqueness even for same-second issuance
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> Optional[dict]:
    """
    Verify JWT token and return payload.
    Returns None if invalid or expired.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


# ============================================================================
# CSRF TOKEN MANAGEMENT
# ============================================================================

def generate_csrf_token() -> str:
    """Generate a random CSRF token (43-char URL-safe)."""
    return secrets.token_urlsafe(32)


def hash_csrf_token(token: str) -> str:
    """Hash CSRF token for database storage (one-way)."""
    return hashlib.sha256(token.encode()).hexdigest()


# ============================================================================
# IDENTIFIER CLASSIFICATION (for registration)
# ============================================================================

def classify_identifier(identifier: str) -> tuple[str, str]:
    """
    Classify identifier as email, phone, or username.
    Returns (field_name, normalized_value)

    - Contains @: email
    - Looks like phone (digits + optional +/-): phone_number
    - Otherwise: username
    """
    identifier = identifier.strip().lower()

    # Check for email
    if "@" in identifier:
        return ("email", identifier)

    # Check for phone (digits, +, -)
    phone_chars = identifier.replace("+", "").replace("-", "")
    if phone_chars.isdigit() and len(phone_chars) >= 10:
        return ("phone_number", identifier)

    # Default: username
    return ("username", identifier)


def generate_unique_username(base: str, existing_usernames: set[str] = None) -> str:
    """
    Generate collision-resistant username from base.

    Args:
        base: Username base (from email local-part or "user")
        existing_usernames: Set of existing usernames to avoid

    Returns:
        Unique username
    """
    if existing_usernames is None:
        existing_usernames = set()

    # Sanitize base
    base = base.lower().replace("@", "").replace("+", "")[:20]

    # Try exact base first
    if base not in existing_usernames:
        return base

    # Add random suffix until unique (100 attempts max)
    for _ in range(100):
        suffix = secrets.token_hex(2)  # 4-char hex
        candidate = f"{base}{suffix}"
        if candidate not in existing_usernames:
            return candidate

    # Fallback: pure random
    return f"user{secrets.token_hex(4)}"


# ============================================================================
# COOKIE CONFIGURATION
# ============================================================================

def get_cookie_secure_flag() -> bool:
    """
    Determine if cookies should have Secure flag.

    Production: Secure=True (HTTPS only)
    Development: Secure=False (allows HTTP localhost)
    """
    return os.getenv("ENVIRONMENT", "development") == "production"
