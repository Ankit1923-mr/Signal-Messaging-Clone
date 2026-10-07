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
    avatar_url: str | None = Field(None, description="Avatar URL (optional)")


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
# CONVERSATIONS
# ============================================================================

class CreateDirectConversationRequest(BaseModel):
    """Request to create or find an existing 1:1 conversation."""
    other_user_id: int


class ConversationResponse(BaseModel):
    """Conversation with resolved member profiles."""
    id: int
    type: str  # "direct" or "group"
    name: str | None = None
    members: list[UserResponse]
    admin_id: int | None = None  # set for groups only; None for direct conversations


class CreateGroupConversationRequest(BaseModel):
    """Request to create a new group conversation."""
    name: str = Field(..., min_length=1, max_length=255, description="Group name")
    member_ids: list[int] = Field(default_factory=list, description="Other members (creator is added automatically)")

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("Group name cannot be empty")
        return stripped


class AddGroupMemberRequest(BaseModel):
    """Request to add a member to an existing group (admin only)."""
    user_id: int


class MessageHistoryResponse(BaseModel):
    """A single persisted message, for hydrating a conversation's history."""
    id: int
    conversation_id: int
    sender_id: int
    client_id: str
    content: str
    created_at: str  # ISO 8601
    status: str  # pending/delivered/read — see get_conversation_messages() for whose receipt this is
    reply_to_message_id: int | None = None
    reply_to_sender_id: int | None = None
    reply_to_content: str | None = None  # short snippet, for the quoted preview
    reply_to_deleted: bool = False  # true if reply_to_message_id was set but the original no longer resolves


class VerifyOTPRequest(BaseModel):
    """OTP verification request."""
    user_id: int
    otp: str = Field(..., min_length=6, max_length=6, description="6-digit OTP")


class VerifyOTPResponse(BaseModel):
    """OTP verification success response."""
    status: str = "verified"
    user_id: int
    username: str
    display_name: str


class ErrorResponse(BaseModel):
    """Error response."""
    code: str
    message: str
    detail: str | None = None


# ============================================================================
# WEBSOCKET MESSAGES (Real-time Messaging)
# ============================================================================

class SendMessagePayload(BaseModel):
    """Client sends message to conversation."""
    conversation_id: int
    client_id: str = Field(..., min_length=1, description="UUID for idempotency")
    content: str = Field(..., min_length=1, max_length=4000, description="Message text (1-4000 chars)")
    reply_to_message_id: int | None = Field(
        None, description="Optional: id of the message this one replies to"
    )


class MessageAckPayload(BaseModel):
    """Server acknowledges message creation."""
    message_id: int
    client_id: str
    created_at: str  # ISO 8601
    status: str = "pending"  # pending, delivered, read
    reply_to_message_id: int | None = None
    reply_to_sender_id: int | None = None
    reply_to_content: str | None = None
    reply_to_deleted: bool = False


class MessageReceivedPayload(BaseModel):
    """Server broadcasts incoming message to recipients."""
    message_id: int
    conversation_id: int
    sender_id: int
    content: str
    created_at: str  # ISO 8601
    status: str = "pending"
    reply_to_message_id: int | None = None
    reply_to_sender_id: int | None = None
    reply_to_content: str | None = None
    reply_to_deleted: bool = False


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
    reply_to_message_id: int | None = None
    reply_to_sender_id: int | None = None
    reply_to_content: str | None = None
    reply_to_deleted: bool = False


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
