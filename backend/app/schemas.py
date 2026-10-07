"""
Pydantic models for request/response validation.
"""

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ============================================================================
# AUTHENTICATION REQUESTS
# ============================================================================

class RegisterRequest(BaseModel):
    """Registration request with flexible identifier."""
    identifier: str = Field(..., min_length=3, max_length=255, description="Email, phone, or username")
    password: str = Field(..., min_length=8, max_length=255, description="Password (8+ chars)")
    display_name: str = Field(..., min_length=1, max_length=100, description="Display name")


class LoginRequest(BaseModel):
    """Login request with username/email/phone."""
    username: str = Field(..., min_length=3, max_length=255, description="Username, email, or phone")
    password: str = Field(..., description="Password")


class RefreshTokenRequest(BaseModel):
    """Refresh token request (token from cookie, no body needed)."""
    pass  # Token comes from cookie, not body


# ============================================================================
# AUTHENTICATION RESPONSES
# ============================================================================

class UserResponse(BaseModel):
    """User data response."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: str
    email: str | None = None
    phone_number: str | None = None
    avatar_url: str | None = None


class RegisterResponse(BaseModel):
    """Registration success response."""
    user_id: int
    username: str
    display_name: str


class LoginResponse(BaseModel):
    """Login success response."""
    status: str = "authenticated"
    user_id: int
    username: str
    display_name: str


class RefreshResponse(BaseModel):
    """Token refresh success response."""
    status: str = "refreshed"


class LogoutResponse(BaseModel):
    """Logout success response."""
    status: str = "logged_out"


class CSRFResponse(BaseModel):
    """CSRF token response."""
    csrf_token: str


# ============================================================================
# ERROR RESPONSES
# ============================================================================

class ErrorResponse(BaseModel):
    """Error response."""
    detail: str
    status_code: int | None = None


# ============================================================================
# VALIDATION
# ============================================================================

class CredentialsSchema(BaseModel):
    """Unified credentials for login."""
    identifier: str  # username, email, or phone
    password: str

    @field_validator('identifier')
    @classmethod
    def validate_identifier(cls, v: str) -> str:
        if not v or len(v) < 3:
            raise ValueError('Identifier too short')
        return v.strip().lower()
