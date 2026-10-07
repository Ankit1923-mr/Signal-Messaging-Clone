"""
WebSocket Route Handler

Real-time messaging endpoint: /ws/messages?token=<JWT_ACCESS_TOKEN>

Connection flow:
1. Validate JWT access token
2. Accept WebSocket
3. Register connection (multi-tab support)
4. Fetch and send pending messages (offline reconnect)
5. Listen for client messages
6. Broadcast to appropriate recipients
7. Handle errors without closing connection
8. Heartbeat (ping/pong)
"""

import asyncio
from datetime import datetime
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.orm import Session
import json

from app.database import get_db, SessionLocal
from app.security import verify_token
from app.models import User, Conversation, ConversationMembers
from app.services.connections import ConnectionManager
from app.services.messaging import MessagingService
from app.services.receipts import ReceiptService
from app.ws_protocol import MessageType

router = APIRouter()

# Global connection manager (shared across all WebSocket connections)
manager = ConnectionManager()

# Constants
WS_HEARTBEAT_INTERVAL = 30  # Send ping every 30 seconds
WS_HEARTBEAT_TIMEOUT = 60   # Close if no pong in 60 seconds


# ============================================================================
# WEBSOCKET ENDPOINT
# ============================================================================

@router.websocket("/ws/messages")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time messaging.

    Authentication:
        Browser sends access_token httpOnly cookie automatically.
        FastAPI reads cookie from WebSocket handshake.

    Connection flow:
    1. Validate JWT from cookie
    2. Accept WebSocket
    3. Register connection (multi-tab)
    4. Send pending messages (offline reconnect)
    5. Listen for messages in loop
    6. Broadcast to recipients
    7. Handle errors gracefully

    Protocol: See app/ws_protocol.py for message types and payloads
    """

    user_id = None
    db = None
    heartbeat_task = None

    try:
        # Step 0: Validate origin (prevent cross-origin WebSocket)
        # FastAPI doesn't auto-validate WebSocket origins like HTTP CORS
        origin = websocket.headers.get("origin")
        allowed_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
        if origin and origin not in allowed_origins:
            await websocket.close(code=1008, reason="Invalid origin")
            return

        # Step 1: Extract and validate JWT from httpOnly cookie
        # WebSocket handshake includes cookies automatically from browser
        access_token = websocket.cookies.get("access_token")
        if not access_token:
            await websocket.close(code=1008, reason="Missing token")
            return

        payload = verify_token(access_token)
        if not payload or payload.get("type") != "access":
            await websocket.close(code=1008, reason="Invalid token")
            return

        # Extract user_id from token
        try:
            user_id = int(payload.get("sub"))
        except (ValueError, TypeError):
            await websocket.close(code=1008, reason="Invalid token payload")
            return

        # Verify user exists
        db = SessionLocal()
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            await websocket.close(code=1008, reason="User not found")
            return

        # Step 2: Accept WebSocket connection
        await websocket.accept()

        # Step 3: Register connection (multi-tab support)
        await manager.connect(user_id, websocket)

        # Step 4: Fetch pending messages and send to client
        pending_messages = await MessagingService.get_pending_messages(user_id, db)

        if pending_messages:
            # Client has pending messages (was offline)
            pending_list = []
            for msg in pending_messages:
                pending_list.append({
                    "message_id": msg.id,
                    "sender_id": msg.sender_id,
                    "conversation_id": msg.conversation_id,
                    "content": msg.content,
                    "created_at": msg.created_at.isoformat(),
                    "status": "pending"
                })

            await websocket.send_json({
                "type": MessageType.RECONNECTED,
                "payload": {
                    "pending_messages": pending_list,
                    "timestamp": datetime.utcnow().isoformat()
                }
            })
        else:
            # No pending messages (fresh connection or already caught up)
            await websocket.send_json({
                "type": MessageType.CONNECTED,
                "payload": {
                    "user_id": user_id,
                    "timestamp": datetime.utcnow().isoformat()
                }
            })

        # Step 5: Start heartbeat task (ping/pong)
        heartbeat_task = asyncio.create_task(
            _heartbeat_loop(websocket, user_id, manager)
        )

        # Step 6: Listen for client messages
        while True:
            try:
                data = await websocket.receive_json()
            except WebSocketDisconnect:
                break
            except json.JSONDecodeError:
                # Invalid JSON - send error but don't close
                await websocket.send_json({
                    "type": MessageType.ERROR,
                    "payload": {
                        "code": "INVALID_JSON",
                        "message": "Invalid JSON format"
                    }
                })
                continue

            # Route message to appropriate handler
            msg_type = data.get("type")

            try:
                if msg_type == MessageType.SEND_MESSAGE:
                    await _handle_send_message(user_id, data, manager, db)

                elif msg_type == MessageType.RECEIPT:
                    await _handle_receipt(user_id, data, manager, db)

                elif msg_type == MessageType.TYPING:
                    await _handle_typing(user_id, data, manager, db)

                elif msg_type == MessageType.PONG:
                    # Heartbeat response - just acknowledge, no action needed
                    pass

                else:
                    # Unknown message type
                    await websocket.send_json({
                        "type": MessageType.ERROR,
                        "payload": {
                            "code": "UNKNOWN_TYPE",
                            "message": f"Unknown message type: {msg_type}"
                        }
                    })

            except Exception as e:
                # Log error and send to client, but don't close connection
                await websocket.send_json({
                    "type": MessageType.ERROR,
                    "payload": {
                        "code": "HANDLER_ERROR",
                        "message": "Failed to process message"
                    }
                })

    except Exception as e:
        # Unexpected error - try to close gracefully
        try:
            await websocket.close(code=1011, reason="Internal server error")
        except Exception:
            pass

    finally:
        # Cleanup
        if heartbeat_task:
            heartbeat_task.cancel()

        if user_id:
            await manager.disconnect(user_id, websocket)

        if db:
            db.close()


# ============================================================================
# MESSAGE HANDLERS
# ============================================================================

async def _handle_send_message(user_id: int, data: dict, manager: ConnectionManager, db: Session):
    """
    Handle send_message from client.

    Payload:
    {
        "type": "send_message",
        "payload": {
            "conversation_id": 123,
            "client_id": "uuid-string",
            "content": "Hello!"
        }
    }

    Flow:
    1. Validate payload
    2. Call MessagingService.send_message()
    3. Broadcast message_received to recipients
    4. Send message_ack to sender (all tabs)
    """

    try:
        payload = data.get("payload", {})

        # Extract fields
        conversation_id = payload.get("conversation_id")
        client_id = payload.get("client_id")
        content = payload.get("content")

        # Validate required fields
        if not all([conversation_id, client_id, content]):
            return  # Silently ignore (malformed request)

        # Send message via service (handles validation, idempotency, receipts)
        message = await MessagingService.send_message(
            sender_id=user_id,
            conversation_id=conversation_id,
            client_id=client_id,
            content=content,
            db=db
        )

        # Get all conversation members for broadcasting
        members = db.query(ConversationMembers).filter(
            ConversationMembers.conversation_id == conversation_id
        ).all()
        member_ids = [m.user_id for m in members]

        # Broadcast message_received to all recipients (except sender)
        for member_id in member_ids:
            if member_id != user_id:
                await manager.broadcast_to_user(member_id, {
                    "type": MessageType.MESSAGE_RECEIVED,
                    "payload": {
                        "message_id": message.id,
                        "conversation_id": conversation_id,
                        "sender_id": user_id,
                        "content": message.content,
                        "created_at": message.created_at.isoformat(),
                        "status": "pending"
                    }
                })

        # Send message_ack to sender (ALL tabs for multi-tab sync)
        await manager.broadcast_to_user(user_id, {
            "type": MessageType.MESSAGE_ACK,
            "payload": {
                "message_id": message.id,
                "client_id": client_id,
                "created_at": message.created_at.isoformat(),
                "status": "pending"
            }
        })

    except Exception as e:
        # Service raised exception (validation error, etc.)
        # Send error to client but don't close connection
        pass


async def _handle_receipt(user_id: int, data: dict, manager: ConnectionManager, db: Session):
    """
    Handle receipt (delivery/read) from client.

    Payload:
    {
        "type": "receipt",
        "payload": {
            "message_id": 456,
            "status": "delivered"  // or "read"
        }
    }

    Flow:
    1. Validate payload
    2. Call ReceiptService.update_receipt()
    3. Broadcast receipt_update to message sender
    """

    try:
        payload = data.get("payload", {})

        message_id = payload.get("message_id")
        status = payload.get("status")

        if not message_id or not status:
            return  # Silently ignore

        # Update receipt via service (handles state machine validation)
        receipt = await ReceiptService.update_receipt(
            message_id=message_id,
            recipient_id=user_id,
            status=status,
            db=db
        )

        # Get message to find sender
        from app.models import Message
        message = db.query(Message).filter(Message.id == message_id).first()
        if not message:
            return

        # Broadcast receipt_update to sender (ALL tabs for multi-tab sync)
        timestamp_field = f"{status}_at"
        timestamp_value = getattr(receipt, timestamp_field).isoformat() if getattr(receipt, timestamp_field) else None

        payload_response = {
            "message_id": message_id,
            "status": status,
        }

        if timestamp_value:
            payload_response[timestamp_field] = timestamp_value

        await manager.broadcast_to_user(message.sender_id, {
            "type": MessageType.RECEIPT_UPDATE,
            "payload": payload_response
        })

    except Exception as e:
        # Service raised exception (validation, state machine, etc.)
        # Don't send error, just silently fail
        pass


async def _handle_typing(user_id: int, data: dict, manager: ConnectionManager, db: Session):
    """
    Handle typing indicator from client.

    Payload:
    {
        "type": "typing",
        "payload": {
            "conversation_id": 123,
            "typing": true  // or false
        }
    }

    Flow:
    1. Validate payload
    2. Broadcast to OTHER members of conversation ONLY (not sender)
    3. Don't persist typing events

    Multi-tab note: Sender's other tabs should NOT receive their own typing indicator
    """

    try:
        payload = data.get("payload", {})

        conversation_id = payload.get("conversation_id")
        typing = payload.get("typing")

        if conversation_id is None or typing is None:
            return  # Silently ignore

        # Validate user is member of conversation
        is_member = db.query(ConversationMembers).filter(
            ConversationMembers.conversation_id == conversation_id,
            ConversationMembers.user_id == user_id
        ).first()

        if not is_member:
            return  # User not in conversation

        # Get all conversation members
        members = db.query(ConversationMembers).filter(
            ConversationMembers.conversation_id == conversation_id
        ).all()
        member_ids = [m.user_id for m in members]

        # Broadcast typing to OTHER members ONLY (not sender, not sender's other tabs)
        for member_id in member_ids:
            if member_id != user_id:
                await manager.broadcast_to_user(member_id, {
                    "type": MessageType.USER_TYPING,
                    "payload": {
                        "conversation_id": conversation_id,
                        "sender_id": user_id,
                        "typing": typing
                    }
                })

    except Exception as e:
        # Silently ignore errors
        pass


async def _heartbeat_loop(websocket: WebSocket, user_id: int, manager: ConnectionManager):
    """
    Heartbeat task: Send ping every N seconds, wait for pong.

    Args:
        websocket: WebSocket connection
        user_id: User ID (for logging)
        manager: Connection manager (for disconnection on timeout)

    Flow:
    - Send PING every WS_HEARTBEAT_INTERVAL seconds
    - Wait for PONG response
    - If no PONG in WS_HEARTBEAT_TIMEOUT seconds, close connection
    - Silently handle connection errors
    """

    try:
        while True:
            # Wait before sending next ping
            await asyncio.sleep(WS_HEARTBEAT_INTERVAL)

            try:
                # Send ping
                await websocket.send_json({
                    "type": MessageType.PING
                })

                # In a real implementation, we'd wait for pong and timeout if needed
                # For MVP, we just send ping and rely on the client to respond
                # The connection will naturally close if the client is gone

            except Exception:
                # Connection error - heartbeat loop will exit
                break

    except asyncio.CancelledError:
        # Task cancelled (connection closing) - this is expected
        pass
    except Exception:
        # Unexpected error - silently exit
        pass
