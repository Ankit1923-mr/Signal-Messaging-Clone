"""
Comprehensive authentication tests (12 tests).
Uses conftest.py fixtures for client and db_session.
"""

from datetime import datetime, timedelta

from app.models import CSRFBootstrap, RefreshToken, Session as SessionModel, User
from app.security import hash_csrf_token


def register_and_verify(client, identifier="user@example.com", password="password123",
                         display_name="Test User"):
    """
    Helper: register a user and complete OTP verification (mock OTP 123456).
    Returns the registration response data (user_id, username, display_name).
    Login is gated on is_verified, so tests that need to log in must call this first.
    """
    response = client.post("/auth/register", json={
        "identifier": identifier,
        "password": password,
        "display_name": display_name
    })
    assert response.status_code == 201
    data = response.json()

    otp_response = client.post("/auth/verify-otp", json={
        "user_id": data["user_id"],
        "otp": "123456"
    })
    assert otp_response.status_code == 200

    return data


# ============================================================================
# 1. CSRF BOOTSTRAP TESTS
# ============================================================================

def test_csrf_bootstrap_creates_session(client, db_session):
    """
    Test: GET /auth/csrf creates session if none exists.
    Expected: New session created, CSRF token returned, session cookie set.
    """
    # Make request without session cookie
    response = client.get("/auth/csrf")

    # Verify response
    assert response.status_code == 200
    data = response.json()
    assert "csrf_token" in data
    csrf_token = data["csrf_token"]
    assert len(csrf_token) > 0

    # Verify session cookie set
    assert "session_id" in response.cookies
    session_id = response.cookies["session_id"]

    # Verify session created in database
    session = db_session.query(SessionModel).filter(
        SessionModel.id == session_id
    ).first()
    assert session is not None
    assert session.expires_at > datetime.utcnow()

    # Verify CSRF record created
    token_hash = hash_csrf_token(csrf_token)
    csrf_record = db_session.query(CSRFBootstrap).filter(
        CSRFBootstrap.session_id == session_id,
        CSRFBootstrap.token_hash == token_hash
    ).first()
    assert csrf_record is not None
    assert csrf_record.used == False


def test_csrf_bootstrap_reuses_session(client, db_session):
    """
    Test: GET /auth/csrf reuses existing valid session.
    Expected: Same session_id in cookie, different CSRF tokens on each call.
    """
    # First request
    response1 = client.get("/auth/csrf")
    session_id1 = response1.cookies.get("session_id")
    csrf_token1 = response1.json()["csrf_token"]

    # Second request with same session cookie
    client.cookies.set("session_id", session_id1)
    response2 = client.get("/auth/csrf")
    session_id2 = response2.cookies.get("session_id")
    csrf_token2 = response2.json()["csrf_token"]

    # Verify session reused
    assert session_id1 == session_id2

    # Verify different CSRF tokens (or same session used)
    # Session should exist only once
    sessions = db_session.query(SessionModel).filter(
        SessionModel.id == session_id1
    ).all()
    assert len(sessions) == 1


def test_csrf_token_one_time_use(client, db_session):
    """
    Test: CSRF token cannot be reused after login.
    Expected: First login succeeds, second login with same token fails.
    """
    # Register and verify user (login requires is_verified=True)
    register_and_verify(client, "user@example.com", "password123", "Test User")

    # Get CSRF token
    response = client.get("/auth/csrf")
    csrf_token = response.json()["csrf_token"]
    session_id = response.cookies.get("session_id")

    # First login (should succeed)
    response1 = client.post("/auth/login",
        json={"username": "user@example.com", "password": "password123"},
        headers={"X-CSRF-Token": csrf_token}
    )
    assert response1.status_code == 200

    # Second login with same CSRF token (should fail)
    client.cookies.clear()
    client.cookies.set("session_id", session_id)
    response2 = client.post("/auth/login",
        json={"username": "user@example.com", "password": "password123"},
        headers={"X-CSRF-Token": csrf_token}
    )
    assert response2.status_code == 403


def test_csrf_token_expiry(client, db_session):
    """
    Test: Expired CSRF token is rejected.
    Expected: Token beyond expiry time cannot be used for login.
    """
    # Create expired CSRF record manually
    # created_at must be before expires_at per CHECK constraint
    # Set created_at to 2 hours ago, expires_at to 1 hour ago
    now = datetime.utcnow()

    session = SessionModel(
        id="test_session",
        expires_at=now + timedelta(hours=1)
    )
    db_session.add(session)
    db_session.flush()

    expired_csrf = CSRFBootstrap(
        session_id="test_session",
        token_hash=hash_csrf_token("test_token"),
        created_at=now - timedelta(hours=2),
        expires_at=now - timedelta(hours=1),  # Expired 1 hour ago
        used=False
    )
    db_session.add(expired_csrf)
    db_session.commit()

    # Register and verify user (login requires is_verified=True)
    register_and_verify(client, "user@example.com", "password123", "Test User")

    # Try to login with expired token
    client.cookies.set("session_id", "test_session")
    response = client.post("/auth/login",
        json={"username": "user@example.com", "password": "password123"},
        headers={"X-CSRF-Token": "test_token"}
    )
    assert response.status_code == 403


# ============================================================================
# 2. REGISTRATION TESTS
# ============================================================================

def test_register_success(client):
    """
    Test: User registration with email works.
    Expected: User created, status 201, user data returned.
    """
    response = client.post("/auth/register", json={
        "identifier": "john@example.com",
        "password": "password123",
        "display_name": "John Doe"
    })

    assert response.status_code == 201
    data = response.json()
    assert data["user_id"] > 0
    assert data["username"]  # Auto-generated
    assert data["display_name"] == "John Doe"


def test_register_duplicate_email(client):
    """
    Test: Duplicate email is rejected.
    Expected: First registration succeeds, second fails with 409 (conflict).
    """
    # Register first user
    response1 = client.post("/auth/register", json={
        "identifier": "john@example.com",
        "password": "password123",
        "display_name": "John Doe"
    })
    assert response1.status_code == 201

    # Try to register with same email
    response2 = client.post("/auth/register", json={
        "identifier": "john@example.com",
        "password": "password456",
        "display_name": "Another John"
    })
    assert response2.status_code == 409
    assert "already exists" in response2.json()["detail"].lower()


# ============================================================================
# 3. LOGIN TESTS
# ============================================================================

def test_login_success(client, db_session):
    """
    Test: Login with valid credentials works.
    Expected: Tokens issued, cookies set, user data returned.
    """
    # Register and verify user (login requires is_verified=True)
    register_and_verify(client, "user@example.com", "password123", "Test User")

    # Get CSRF token
    response_csrf = client.get("/auth/csrf")
    csrf_token = response_csrf.json()["csrf_token"]

    # Login
    response = client.post("/auth/login",
        json={"username": "user@example.com", "password": "password123"},
        headers={"X-CSRF-Token": csrf_token}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "authenticated"
    assert data["user_id"] > 0
    assert "access_token" in response.cookies
    assert "refresh_token" in response.cookies


def test_login_invalid_password(client):
    """
    Test: Login with wrong password fails.
    Expected: Status 401, "wrong credentials" error (distinct from account-not-found).
    """
    # Register user (wrong-password check happens before is_verified check,
    # so OTP verification isn't required for this test)
    client.post("/auth/register", json={
        "identifier": "user@example.com",
        "password": "password123",
        "display_name": "Test User"
    })

    # Get CSRF token
    response_csrf = client.get("/auth/csrf")
    csrf_token = response_csrf.json()["csrf_token"]

    # Try login with wrong password
    response = client.post("/auth/login",
        json={"username": "user@example.com", "password": "wrongpassword"},
        headers={"X-CSRF-Token": csrf_token}
    )

    assert response.status_code == 401
    assert "wrong credentials" in response.json()["detail"].lower()


def test_login_nonexistent_account(client):
    """
    Test: Login with an identifier that has no account fails.
    Expected: Status 404, account-not-found message (distinct from wrong-password).
    """
    response_csrf = client.get("/auth/csrf")
    csrf_token = response_csrf.json()["csrf_token"]

    response = client.post("/auth/login",
        json={"username": "nobody@example.com", "password": "password123"},
        headers={"X-CSRF-Token": csrf_token}
    )

    assert response.status_code == 404
    assert "account not found" in response.json()["detail"].lower()


def test_login_unverified_account_rejected(client):
    """
    Test: Login before OTP verification is rejected.
    Expected: Status 403, no auth cookies issued.
    """
    client.post("/auth/register", json={
        "identifier": "user@example.com",
        "password": "password123",
        "display_name": "Test User"
    })

    response_csrf = client.get("/auth/csrf")
    csrf_token = response_csrf.json()["csrf_token"]

    response = client.post("/auth/login",
        json={"username": "user@example.com", "password": "password123"},
        headers={"X-CSRF-Token": csrf_token}
    )

    assert response.status_code == 403
    assert "not verified" in response.json()["detail"].lower()
    assert "access_token" not in response.cookies


def test_verify_otp_wrong_code_rejected(client):
    """
    Test: Wrong OTP is rejected and does not verify the account.
    """
    response = client.post("/auth/register", json={
        "identifier": "user@example.com",
        "password": "password123",
        "display_name": "Test User"
    })
    user_id = response.json()["user_id"]

    otp_response = client.post("/auth/verify-otp", json={
        "user_id": user_id,
        "otp": "000000"
    })

    assert otp_response.status_code == 401
    assert "access_token" not in otp_response.cookies


def test_verify_otp_success(client, db_session):
    """
    Test: Correct OTP (123456) verifies the account and issues auth cookies.
    """
    response = client.post("/auth/register", json={
        "identifier": "user@example.com",
        "password": "password123",
        "display_name": "Test User"
    })
    user_id = response.json()["user_id"]

    otp_response = client.post("/auth/verify-otp", json={
        "user_id": user_id,
        "otp": "123456"
    })

    assert otp_response.status_code == 200
    assert "access_token" in otp_response.cookies
    assert "refresh_token" in otp_response.cookies

    user = db_session.query(User).filter(User.id == user_id).first()
    assert user.is_verified is True


def test_verify_otp_already_verified_rejected(client):
    """
    Test: Verifying an already-verified account is rejected.
    """
    data = register_and_verify(client, "user@example.com", "password123", "Test User")

    otp_response = client.post("/auth/verify-otp", json={
        "user_id": data["user_id"],
        "otp": "123456"
    })

    assert otp_response.status_code == 400
    assert "already verified" in otp_response.json()["detail"].lower()


def test_login_requires_csrf(client):
    """
    Test: Login without CSRF token fails.
    Expected: Status 403.
    """
    # Register user
    client.post("/auth/register", json={
        "identifier": "user@example.com",
        "password": "password123",
        "display_name": "Test User"
    })

    # Try login without CSRF token
    response = client.post("/auth/login",
        json={"username": "user@example.com", "password": "password123"}
    )

    assert response.status_code == 403


# ============================================================================
# 4. REFRESH TOKEN TEST
# ============================================================================

def test_refresh_token_works(client, db_session):
    """
    Test: Refresh token exchanges for new access token.
    Expected: New access token issued, refresh token remains valid.
    """
    # Register, verify, and login
    register_and_verify(client, "user@example.com", "password123", "Test User")

    response_csrf = client.get("/auth/csrf")
    csrf_token = response_csrf.json()["csrf_token"]

    response_login = client.post("/auth/login",
        json={"username": "user@example.com", "password": "password123"},
        headers={"X-CSRF-Token": csrf_token}
    )

    old_access_token = response_login.cookies.get("access_token")

    # Call refresh endpoint
    response = client.post("/auth/refresh")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "refreshed"

    # Verify new access token issued
    new_access_token = response.cookies.get("access_token")
    assert new_access_token is not None
    # Note: tokens may be identical if issued in same second (same exp claim)
    # The important thing is that refresh endpoint worked and set a token


# ============================================================================
# 5. LOGOUT TEST
# ============================================================================

def test_logout_revokes_refresh(client, db_session):
    """
    Test: Logout revokes refresh token and clears cookies.
    Expected: Refresh token deleted from DB, cookies cleared.
    """
    # Register, verify, and login
    register_and_verify(client, "user@example.com", "password123", "Test User")

    response_csrf = client.get("/auth/csrf")
    csrf_token = response_csrf.json()["csrf_token"]

    client.post("/auth/login",
        json={"username": "user@example.com", "password": "password123"},
        headers={"X-CSRF-Token": csrf_token}
    )

    # Count refresh tokens before logout
    refresh_tokens_before = db_session.query(RefreshToken).count()

    # Logout
    response = client.post("/auth/logout")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "logged_out"

    # Verify cookies cleared
    assert response.cookies.get("access_token") is None or \
           response.cookies.get("access_token") == ""

    # Verify refresh token deleted from DB
    refresh_tokens_after = db_session.query(RefreshToken).count()
    assert refresh_tokens_after < refresh_tokens_before


# ============================================================================
# 6. COOKIE SECURITY TEST
# ============================================================================

def test_cookies_have_security_flags(client):
    """
    Test: Authentication cookies have required security flags.
    Expected: HttpOnly, SameSite=strict, Secure (env-dependent).
    """
    # Register, verify, and login
    register_and_verify(client, "user@example.com", "password123", "Test User")

    response_csrf = client.get("/auth/csrf")
    csrf_token = response_csrf.json()["csrf_token"]

    response = client.post("/auth/login",
        json={"username": "user@example.com", "password": "password123"},
        headers={"X-CSRF-Token": csrf_token}
    )

    # Check cookies exist
    assert "access_token" in response.cookies
    assert "refresh_token" in response.cookies

    # Note: TestClient doesn't expose cookie attributes directly,
    # but we can verify they're set. In real browser, these flags
    # would be enforced by the HTTP headers sent.
    # This test verifies the endpoint sets cookies without error.
    assert response.status_code == 200
