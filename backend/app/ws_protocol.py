"""
WebSocket Protocol Definition

SINGLE SOURCE OF TRUTH for all WebSocket message types and payload structures.
Used by: routes/ws.py, tests, and future frontend implementation.

Protocol Design:
- All messages follow envelope: {"type": "...", "payload": {...}}
- Types are lowercase with underscores
- Payloads are strongly typed (define in schemas.py)
- Timestamps are ISO 8601 strings
"""

from enum import Enum
from typing import Literal


class MessageType(str, Enum):
    """Enumeration of all valid WebSocket message types"""

    # Client → Server: Send message
    SEND_MESSAGE = "send_message"

    # Server → Client: Acknowledge message received from client
    MESSAGE_ACK = "message_ack"

    # Server → Client: Incoming message from another user
    MESSAGE_RECEIVED = "message_received"

    # Client → Server: Update receipt status (delivered/read)
    RECEIPT = "receipt"

    # Server → Client: Receipt status changed by recipient
    RECEIPT_UPDATE = "receipt_update"

    # Client → Server: User is typing
    TYPING = "typing"

    # Server → Client: Another user is typing
    USER_TYPING = "user_typing"

    # Server → Client: Connection established
    CONNECTED = "connected"

    # Server → Client: Reconnection with pending messages
    RECONNECTED = "reconnected"

    # Server → Client: Error occurred
    ERROR = "error"

    # Server → Client: Ping (heartbeat)
    PING = "ping"

    # Client → Server: Pong (heartbeat response)
    PONG = "pong"


class ReceiptStatus(str, Enum):
    """Receipt status values"""
    PENDING = "pending"
    DELIVERED = "delivered"
    READ = "read"


# ============================================================================
# MESSAGE PAYLOAD STRUCTURES (used with Pydantic in schemas.py)
# ============================================================================

class SendMessagePayload:
    """
    Client sends message to conversation.

    Example:
    {
      "type": "send_message",
      "payload": {
        "conversation_id": 123,
        "client_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "content": "Hello, how are you?"
      }
    }

    Constraints:
    - conversation_id: valid conversation the user is member of
    - client_id: UUID or unique identifier (prevents duplicates)
    - content: 1-4000 characters, non-empty
    """

    @staticmethod
    def schema():
        return {
            "type": "object",
            "properties": {
                "conversation_id": {"type": "integer"},
                "client_id": {"type": "string", "minLength": 1},
                "content": {"type": "string", "minLength": 1, "maxLength": 4000},
            },
            "required": ["conversation_id", "client_id", "content"],
        }


class MessageAckPayload:
    """
    Server acknowledges message creation and queueing.

    Example:
    {
      "type": "message_ack",
      "payload": {
        "message_id": 456,
        "client_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "created_at": "2026-10-07T14:30:00Z",
        "status": "pending"
      }
    }

    Sent to: sender (confirms message was queued)
    """

    @staticmethod
    def schema():
        return {
            "type": "object",
            "properties": {
                "message_id": {"type": "integer"},
                "client_id": {"type": "string"},
                "created_at": {"type": "string", "format": "date-time"},
                "status": {"type": "string", "enum": ["pending", "delivered", "read"]},
            },
            "required": ["message_id", "client_id", "created_at", "status"],
        }


class MessageReceivedPayload:
    """
    Server broadcasts incoming message to recipient(s).

    Example:
    {
      "type": "message_received",
      "payload": {
        "message_id": 456,
        "conversation_id": 123,
        "sender_id": 1,
        "content": "Hello, how are you?",
        "created_at": "2026-10-07T14:30:00Z",
        "status": "pending"
      }
    }

    Sent to: all recipients in conversation (except sender)
    """

    @staticmethod
    def schema():
        return {
            "type": "object",
            "properties": {
                "message_id": {"type": "integer"},
                "conversation_id": {"type": "integer"},
                "sender_id": {"type": "integer"},
                "content": {"type": "string"},
                "created_at": {"type": "string", "format": "date-time"},
                "status": {"type": "string", "enum": ["pending", "delivered", "read"]},
            },
            "required": ["message_id", "conversation_id", "sender_id", "content", "created_at", "status"],
        }


class ReceiptPayload:
    """
    Client sends receipt update (delivery or read).

    Example:
    {
      "type": "receipt",
      "payload": {
        "message_id": 456,
        "status": "delivered"  // or "read"
      }
    }

    Sent to: server
    Result: Server updates receipt_status and broadcasts to sender
    """

    @staticmethod
    def schema():
        return {
            "type": "object",
            "properties": {
                "message_id": {"type": "integer"},
                "status": {"type": "string", "enum": ["delivered", "read"]},
            },
            "required": ["message_id", "status"],
        }


class ReceiptUpdatePayload:
    """
    Server broadcasts receipt status change to sender.

    Example:
    {
      "type": "receipt_update",
      "payload": {
        "message_id": 456,
        "status": "delivered",
        "delivered_at": "2026-10-07T14:30:05Z"
      }
    }

    OR for read:
    {
      "type": "receipt_update",
      "payload": {
        "message_id": 456,
        "status": "read",
        "read_at": "2026-10-07T14:30:10Z"
      }
    }

    Sent to: sender (notifies of receipt status change)
    """

    @staticmethod
    def schema():
        return {
            "type": "object",
            "properties": {
                "message_id": {"type": "integer"},
                "status": {"type": "string", "enum": ["delivered", "read"]},
                "delivered_at": {"type": "string", "format": "date-time"},
                "read_at": {"type": "string", "format": "date-time"},
            },
            "required": ["message_id", "status"],
        }


class TypingPayload:
    """
    Client sends typing indicator.

    Example:
    {
      "type": "typing",
      "payload": {
        "conversation_id": 123,
        "typing": true
      }
    }

    Sent to: server
    Result: Server broadcasts to other members ONLY (not sender)
    """

    @staticmethod
    def schema():
        return {
            "type": "object",
            "properties": {
                "conversation_id": {"type": "integer"},
                "typing": {"type": "boolean"},
            },
            "required": ["conversation_id", "typing"],
        }


class UserTypingPayload:
    """
    Server broadcasts typing indicator to other members.

    Example:
    {
      "type": "user_typing",
      "payload": {
        "sender_id": 1,
        "typing": true
      }
    }

    Sent to: all members in conversation EXCEPT sender (3-5s auto-clear)
    """

    @staticmethod
    def schema():
        return {
            "type": "object",
            "properties": {
                "sender_id": {"type": "integer"},
                "typing": {"type": "boolean"},
            },
            "required": ["sender_id", "typing"],
        }


class ConnectedPayload:
    """
    Server confirms connection established (no pending messages).

    Example:
    {
      "type": "connected",
      "payload": {
        "user_id": 1,
        "timestamp": "2026-10-07T14:30:00Z"
      }
    }

    Sent to: client on successful connection
    """

    @staticmethod
    def schema():
        return {
            "type": "object",
            "properties": {
                "user_id": {"type": "integer"},
                "timestamp": {"type": "string", "format": "date-time"},
            },
            "required": ["user_id", "timestamp"],
        }


class ReconnectedPayload:
    """
    Server sends pending messages and confirms reconnection.

    Example:
    {
      "type": "reconnected",
      "payload": {
        "pending_messages": [
          {
            "message_id": 456,
            "sender_id": 2,
            "conversation_id": 123,
            "content": "Where are you?",
            "created_at": "2026-10-07T14:31:00Z",
            "status": "pending"
          }
        ],
        "timestamp": "2026-10-07T14:35:00Z"
      }
    }

    Sent to: client on reconnection (if pending messages exist)
    Client should ACK each message to set delivered_at
    """

    @staticmethod
    def schema():
        return {
            "type": "object",
            "properties": {
                "pending_messages": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "message_id": {"type": "integer"},
                            "sender_id": {"type": "integer"},
                            "conversation_id": {"type": "integer"},
                            "content": {"type": "string"},
                            "created_at": {"type": "string", "format": "date-time"},
                            "status": {"type": "string", "enum": ["pending"]},
                        },
                        "required": ["message_id", "sender_id", "conversation_id", "content", "created_at", "status"],
                    },
                },
                "timestamp": {"type": "string", "format": "date-time"},
            },
            "required": ["pending_messages", "timestamp"],
        }


class ErrorPayload:
    """
    Server sends error without closing connection.

    Example:
    {
      "type": "error",
      "payload": {
        "code": "INVALID_MESSAGE",
        "message": "Message must be 1-4000 characters",
        "client_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV"  // optional, for matching to request
      }
    }

    Sent to: client
    Result: Connection stays open, client retries

    Common error codes:
    - INVALID_TOKEN: Token expired/invalid (connection closes with 1008)
    - NOT_MEMBER: User not member of conversation
    - INVALID_MESSAGE: Message format/size violation
    - MESSAGE_FAILED: Message save failed (retry)
    - UNKNOWN_TYPE: Unknown message type
    """

    @staticmethod
    def schema():
        return {
            "type": "object",
            "properties": {
                "code": {"type": "string"},
                "message": {"type": "string"},
                "client_id": {"type": "string"},
            },
            "required": ["code", "message"],
        }


class PingPayload:
    """
    Server sends heartbeat ping (no payload).

    Example:
    {
      "type": "ping"
    }

    Sent to: client every 30 seconds
    Client should respond with PONG within 60 seconds
    If no PONG: server closes connection
    """
    pass


class PongPayload:
    """
    Client responds to heartbeat (no payload).

    Example:
    {
      "type": "pong"
    }

    Sent to: server
    Result: Connection stays alive
    """
    pass


# ============================================================================
# PROTOCOL SUMMARY (for documentation)
# ============================================================================

PROTOCOL_SUMMARY = """
WebSocket Protocol Summary
===========================

1. CONNECTION & AUTHENTICATION
   - Client connects: ws://localhost:8000/ws/messages?token=<JWT_ACCESS_TOKEN>
   - Server validates token (401 if invalid, closes with code 1008)
   - Server sends CONNECTED or RECONNECTED message
   - All subsequent messages are authenticated

2. SEND MESSAGE FLOW
   Client (send_message)
     ↓
   Server (validate member, check idempotency)
     ↓
   Create message + receipt (pending)
     ↓
   Server (message_ack to sender)
     ↓
   Server (message_received broadcast to recipients)

3. DELIVERY/READ FLOW
   Recipient (receipt: delivered)
     ↓
   Server (update receipt, receipt_update to sender)
     ↓
   Recipient (receipt: read)
     ↓
   Server (update receipt, receipt_update to sender)

4. TYPING FLOW
   Client (typing: true/false)
     ↓
   Server (user_typing broadcast to members ONLY, no sender)

5. HEARTBEAT
   Server (ping every 30s)
     ↓
   Client (pong)
     ↓
   Connection stays open
   If no pong in 60s: server closes

6. ERROR HANDLING
   Most errors: Send error message, keep connection open
   Auth errors: Send error, close with code 1008

7. OFFLINE/RECONNECT
   Client disconnects (connection closes)
     ↓
   Messages pile up as "pending" in database
   Client reconnects (new connection + token)
     ↓
   Server sends reconnected with all pending messages
     ↓
   Client auto-ACKs pending → delivered
     ↓
   Client marks visible messages → read

8. MULTI-TAB
   Same user_id = multiple WebSocket connections
   All connections receive broadcasts (messages, typing, receipts)
   If one connection closes, others stay open
"""
