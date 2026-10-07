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
# WEBSOCKET MESSAGES (Real-time Messaging)
# ============================================================================

class SendMessagePayload(BaseModel):
    """Client sends message to conversation."""
    conversation_id: int
    client_id: str = Field(..., min_length=1, description="UUID for idempotency")
    content: str = Field(..., min_length=1, max_length=4000, description="Message text (1-4000 chars)")


class MessageAckPayload(BaseModel):
    """Server acknowledges message creation."""
    message_id: int
    client_id: str
    created_at: str  # ISO 8601
    status: str = "pending"  # pending, delivered, read


class MessageReceivedPayload(BaseModel):
    """Server broadcasts incoming message to recipients."""
    message_id: int
    conversation_id: int
    sender_id: int
    content: str
    created_at: str  # ISO 8601
    status: str = "pending"


class ReceiptPayload(BaseModel):
    """Client sends receipt update (delivery or read)."""
    message_id: int
    status: str = Field(..., pattern="^(delivered|read)$")


class ReceiptUpdatePayload(BaseModel):
    """Server broadcasts receipt status change."""
    message_id: int
    status: str = Field(..., pattern="^(delivered|read)$")
    delivered_at: str | None = None  # ISO 8601, set if status=delivered
    read_at: str | None = None  # ISO 8601, set if status=read


class TypingPayload(BaseModel):
    """Client sends typing indicator."""
    conversation_id: int
    typing: bool


class UserTypingPayload(BaseModel):
    """Server broadcasts typing indicator to members."""
    sender_id: int
    typing: bool


class ConnectedPayload(BaseModel):
    """Server confirms connection established (no pending messages)."""
    user_id: int
    timestamp: str  # ISO 8601


class PendingMessage(BaseModel):
    """Single pending message in reconnected payload."""
    message_id: int
    sender_id: int
    conversation_id: int
    content: str
    created_at: str  # ISO 8601
    status: str = "pending"


class ReconnectedPayload(BaseModel):
    """Server sends pending messages on reconnection."""
    pending_messages: list[PendingMessage]
    timestamp: str  # ISO 8601


class WebSocketErrorPayload(BaseModel):
    """Server sends error without closing connection."""
    code: str = Field(..., description="Error code (e.g., INVALID_MESSAGE, NOT_MEMBER)")
    message: str = Field(..., description="Human-readable error message")
    client_id: str | None = None  # Optional, for matching to request


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
