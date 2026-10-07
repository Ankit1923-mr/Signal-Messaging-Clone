"""
Authentication endpoints.
- GET /auth/csrf: Bootstrap CSRF token
- POST /auth/register: Register new user
- POST /auth/login: Authenticate + issue tokens
- POST /auth/refresh: Exchange refresh token for access token
- POST /auth/logout: Revoke tokens
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CSRFBootstrap, RefreshToken, Session as SessionModel, User
from app.schemas import (
    CSRFResponse,
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    RefreshResponse,
    RegisterRequest,
    RegisterResponse,
    VerifyOTPRequest,
)
from app.security import (
    classify_identifier,
    create_access_token,
    create_refresh_token,
    generate_csrf_token,
    generate_unique_username,
    get_cookie_secure_flag,
    hash_csrf_token,
    hash_password,
    verify_password,
    verify_token,
)

router = APIRouter(prefix="/auth", tags=["auth"])


# ============================================================================
# HELPERS
# ============================================================================

def set_auth_cookies(response: Response, access_token: str, refresh_token: str):
    """Set authentication cookies (httponly, secure, samesite)."""
    secure = get_cookie_secure_flag()

    response.set_cookie(
        "access_token",
        value=access_token,
        httponly=True,
        secure=secure,
        samesite="strict",
        max_age=7 * 24 * 60 * 60,  # 7 days
        path="/",
    )

    response.set_cookie(
        "refresh_token",
        value=refresh_token,
        httponly=True,
        secure=secure,
        samesite="strict",
        max_age=30 * 24 * 60 * 60,  # 30 days
        path="/",
    )


def set_session_cookie(response: Response, session_id: str):
    """Set session cookie for CSRF bootstrap."""
    secure = get_cookie_secure_flag()

    response.set_cookie(
        "session_id",
        value=session_id,
        httponly=True,
        secure=secure,
        samesite="strict",
        max_age=3600,  # 1 hour
        path="/",
    )


def clear_auth_cookies(response: Response):
    """Clear authentication cookies."""
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")


# ============================================================================
# 1. GET /auth/csrf - Bootstrap CSRF Token
# ============================================================================

@router.get("/csrf", response_model=CSRFResponse)
def get_csrf_token(request: Request, response: Response, db: Session = Depends(get_db)):
    """
    Get CSRF token for unauthenticated login.

    🔑 CRITICAL INVARIANT: Create/reuse session FIRST, then create CSRF record.

    Flow:
    1. Check for existing session_id cookie
    2. If no session or expired, create new sessions row
    3. Create CSRF token + record (tied to session)
    4. Set session cookie
    5. Return token
    """
    # Step 1: Get or create session
    session_id = request.cookies.get("session_id")
    session_record = None

    if session_id:
        # Check if session exists and not expired
        session_record = db.query(SessionModel).filter(
            SessionModel.id == session_id,
            SessionModel.expires_at > datetime.utcnow()
        ).first()

    # Step 2: Create new session if needed
    if not session_record:
        import secrets
        session_id = secrets.token_urlsafe(32)
        session_record = SessionModel(
            id=session_id,
            expires_at=datetime.utcnow() + timedelta(hours=1)
        )
        db.add(session_record)
        db.flush()  # Ensure session exists for FK constraint

    # Step 3: Delete any existing CSRF record for this session (unique constraint)
    db.query(CSRFBootstrap).filter(
        CSRFBootstrap.session_id == session_id
    ).delete()

    # Step 4: Create CSRF token
    csrf_token = generate_csrf_token()
    token_hash = hash_csrf_token(csrf_token)

    csrf_record = CSRFBootstrap(
        session_id=session_id,
        token_hash=token_hash,
        expires_at=datetime.utcnow() + timedelta(hours=1),
        used=False
    )
    db.add(csrf_record)
    db.commit()

    # Step 4: Set session cookie
    set_session_cookie(response, session_id)

    # Step 5: Return token
    return CSRFResponse(csrf_token=csrf_token)


# ============================================================================
# 2. POST /auth/register - Register New User
# ============================================================================

@router.post("/register", response_model=RegisterResponse, status_code=201)
def register(data: RegisterRequest, db: Session = Depends(get_db)):
    """
    Register new user with email, phone, or username.

    🔑 CRITICAL INVARIANT: Classify identifier → populate correct field.
    """
    # Step 1: Classify identifier (email/phone/username)
    field_name, normalized_value = classify_identifier(data.identifier)

    # Step 2: Check if identifier already exists
    if field_name == "email":
        existing = db.query(User).filter(User.email == normalized_value).first()
        if existing:
            raise HTTPException(
                status_code=409,
                detail="An account with this email already exists"
            )
    elif field_name == "phone_number":
        existing = db.query(User).filter(User.phone_number == normalized_value).first()
        if existing:
            raise HTTPException(
                status_code=409,
                detail="An account with this phone number already exists"
            )
    else:  # username
        existing = db.query(User).filter(User.username == normalized_value).first()
        if existing:
            raise HTTPException(
                status_code=409,
                detail="An account with this username already exists"
            )

    # Step 3: Generate username if needed
    if field_name == "username":
        username = normalized_value
    else:
        # Auto-generate username to avoid collisions
        existing_usernames = {u.username for u in db.query(User.username).all()}
        base = normalized_value.split("@")[0] if field_name == "email" else "user"
        username = generate_unique_username(base, existing_usernames)

    # Step 4: Create user
    # username is always set explicitly above; only set email/phone_number here
    # to avoid a duplicate 'username' keyword when field_name == "username"
    extra_field = {} if field_name == "username" else {field_name: normalized_value}

    user = User(
        username=username,
        password_hash=hash_password(data.password),
        display_name=data.display_name,
        avatar_url=data.avatar_url,
        **extra_field
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return RegisterResponse(
        user_id=user.id,
        username=user.username,
        display_name=user.display_name
    )


# ============================================================================
# 3. POST /auth/login - Authenticate + Issue Tokens
# ============================================================================

@router.post("/login", response_model=LoginResponse)
def login(data: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    """
    Authenticate user and issue access + refresh tokens.

    🔑 CRITICAL INVARIANT: Require valid, unused CSRF tied to session.
    """
    # Step 1: Get CSRF token from header
    csrf_token = request.headers.get("X-CSRF-Token")
    if not csrf_token:
        raise HTTPException(status_code=403, detail="CSRF token missing")

    # Step 2: Validate CSRF (tied to session)
    session_id = request.cookies.get("session_id")
    if not session_id:
        raise HTTPException(status_code=403, detail="Session required")

    token_hash = hash_csrf_token(csrf_token)
    csrf_record = db.query(CSRFBootstrap).filter(
        CSRFBootstrap.session_id == session_id,
        CSRFBootstrap.token_hash == token_hash,
        CSRFBootstrap.expires_at > datetime.utcnow(),
        CSRFBootstrap.used == False
    ).first()

    if not csrf_record:
        raise HTTPException(status_code=403, detail="CSRF token invalid or expired")

    # Mark CSRF as used (one-time use)
    csrf_record.used = True
    db.commit()

    # Step 3: Authenticate user (by username/email/phone)
    username = data.username.lower().strip()
    user = db.query(User).filter(
        (User.username == username) |
        (User.email == username) |
        (User.phone_number == username)
    ).first()

    if not user:
        # User doesn't exist
        raise HTTPException(
            status_code=404,
            detail="Account not found. Please check your username or phone number, or register a new account."
        )

    if not verify_password(data.password, user.password_hash):
        # User exists but password is wrong
        raise HTTPException(
            status_code=401,
            detail="Wrong credentials. Please check your username and password."
        )

    if not user.is_verified:
        raise HTTPException(
            status_code=403,
            detail="Account not verified. Please complete OTP verification."
        )

    # Step 4: Generate tokens
    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)

    # Step 5: Store refresh token in database
    refresh_token_hash = hash_csrf_token(refresh_token)  # Reuse hash function
    refresh_record = RefreshToken(
        user_id=user.id,
        token_hash=refresh_token_hash,
        expires_at=datetime.utcnow() + timedelta(days=30)
    )
    db.add(refresh_record)
    db.commit()

    # Step 6: Set auth cookies
    set_auth_cookies(response, access_token, refresh_token)

    return LoginResponse(
        user_id=user.id,
        username=user.username,
        display_name=user.display_name
    )


# ============================================================================
# 4. POST /auth/refresh - Exchange Refresh Token for Access Token
# ============================================================================

@router.post("/refresh", response_model=RefreshResponse)
def refresh_access_token(request: Request, response: Response, db: Session = Depends(get_db)):
    """
    Exchange refresh token for new access token.

    🔑 CRITICAL INVARIANT: Validate refresh token JWT + DB record directly.
    Do NOT use get_current_user (access token may be expired).
    """
    # Step 1: Get refresh token from cookie
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Refresh token missing")

    # Step 2: Verify refresh JWT
    payload = verify_token(refresh_token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    # Step 3: Verify token type
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")

    # Step 4: Get user ID and check DB record
    try:
        user_id = int(payload.get("sub"))
    except (ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token payload")

    # Step 5: Verify refresh token not revoked
    token_hash = hash_csrf_token(refresh_token)
    refresh_record = db.query(RefreshToken).filter(
        RefreshToken.user_id == user_id,
        RefreshToken.token_hash == token_hash,
        RefreshToken.expires_at > datetime.utcnow(),
        RefreshToken.revoked == False
    ).first()

    if not refresh_record:
        raise HTTPException(status_code=401, detail="Refresh token revoked or expired")

    # Step 6: Verify user still exists
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    # Step 7: Issue new access token
    new_access_token = create_access_token(user_id)

    # Step 8: Set new access token cookie
    response.set_cookie(
        "access_token",
        value=new_access_token,
        httponly=True,
        secure=get_cookie_secure_flag(),
        samesite="strict",
        max_age=7 * 24 * 60 * 60,
        path="/",
    )

    return RefreshResponse()


# ============================================================================
# 5. POST /auth/logout - Revoke Tokens + Clear Cookies
# ============================================================================

@router.post("/logout", response_model=LogoutResponse)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    """
    Logout: revoke refresh token and clear auth cookies.

    🔑 CRITICAL INVARIANT: Delete refresh token from DB + clear cookies.
    """
    # Step 1: Get refresh token from cookie
    refresh_token = request.cookies.get("refresh_token")

    if refresh_token:
        # Step 2: Verify and revoke refresh token
        token_hash = hash_csrf_token(refresh_token)
        refresh_record = db.query(RefreshToken).filter(
            RefreshToken.token_hash == token_hash
        ).first()

        if refresh_record:
            # Delete the refresh token (revocation)
            db.delete(refresh_record)
            db.commit()

    # Step 3: Clear auth cookies
    clear_auth_cookies(response)

    return LogoutResponse()


# ============================================================================
# 5. POST /auth/verify-otp - Verify OTP and Complete Registration
# ============================================================================

@router.post("/verify-otp", response_model=LoginResponse)
def verify_otp(data: VerifyOTPRequest, response: Response, db: Session = Depends(get_db)):
    """
    Verify OTP and complete registration/authentication.

    For the assignment, mock OTP is: 123456
    """
    # Verify OTP (mocked for assignment)
    if data.otp != "123456":
        raise HTTPException(status_code=401, detail="Invalid OTP. Please check the code and try again.")

    # Get user
    user = db.query(User).filter(User.id == data.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.is_verified:
        raise HTTPException(status_code=400, detail="Account is already verified.")

    # Mark user as verified
    user.is_verified = True
    db.commit()
    db.refresh(user)

    # Generate tokens
    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)

    # Store refresh token in database
    refresh_token_hash = hash_csrf_token(refresh_token)
    refresh_record = RefreshToken(
        user_id=user.id,
        token_hash=refresh_token_hash,
        expires_at=datetime.utcnow() + timedelta(days=30)
    )
    db.add(refresh_record)
    db.commit()

    # Set auth cookies
    set_auth_cookies(response, access_token, refresh_token)

    return LoginResponse(
        user_id=user.id,
        username=user.username,
        display_name=user.display_name
    )
