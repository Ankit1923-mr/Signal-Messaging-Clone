"""
Messaging Service

Core message handling:
- Send message with membership validation
- 4000-char validation
- client_id idempotency (sender_id, client_id) UNIQUE constraint
- Message persistence
- Pending receipt creation for each recipient
- Offline message retrieval (ALL pending, no time cutoff)
"""

from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException

from app.models import (
    Message,
    MessageReceipt,
    ConversationMembers,
    Conversation,
    User,
)
from app.time_utils import utc_isoformat


REPLY_PREVIEW_MAX_LENGTH = 200


def build_reply_preview(message: Message, db: Session) -> dict:
    """
    Build the denormalized reply-preview fields (reply_to_sender_id,
    reply_to_content, reply_to_deleted) for a message's WS/REST payload.

    Denormalized (looked up once here, not left for the frontend to
    resolve) so a reply still renders correctly even on a path where the
    original message was never loaded into that client's local state --
    e.g. the RECONNECTED pending-messages list. reply_to_deleted=True
    covers the case where reply_to_message_id was set at send time but the
    original message's row no longer resolves (e.g. a future message-delete
    feature) -- the frontend shows "Original message unavailable" instead
    of erroring.
    """
    if message.reply_to_message_id is None:
        return {
            "reply_to_message_id": None,
            "reply_to_sender_id": None,
            "reply_to_content": None,
            "reply_to_deleted": False,
        }

    original = db.query(Message).filter(Message.id == message.reply_to_message_id).first()
    if not original:
        return {
            "reply_to_message_id": message.reply_to_message_id,
            "reply_to_sender_id": None,
            "reply_to_content": None,
            "reply_to_deleted": True,
        }

    content = original.content
    if len(content) > REPLY_PREVIEW_MAX_LENGTH:
        content = content[:REPLY_PREVIEW_MAX_LENGTH] + "…"

    return {
        "reply_to_message_id": original.id,
        "reply_to_sender_id": original.sender_id,
        "reply_to_content": content,
        "reply_to_deleted": False,
    }


class MessagingService:
    """
    Service for message operations.

    Key invariant: client_id idempotency.
    If sender retries with same client_id, return existing message (no duplicate).
    """

    @staticmethod
    async def send_message(
        sender_id: int,
        conversation_id: int,
        client_id: str,
        content: str,
        db: Session,
        reply_to_message_id: int | None = None,
    ) -> Message:
        """
        Send message to conversation.

        Args:
            sender_id: User ID of sender (from JWT)
            conversation_id: Target conversation
            client_id: Unique identifier for this message (UUID-like)
            content: Message text (1-4000 chars)
            db: Database session

        Returns:
            Message object (newly created or existing if client_id matches)

        Raises:
            HTTPException(403): Not a member of conversation
            HTTPException(400): Content empty or > 4000 chars
            HTTPException(400): Conversation not found

        Idempotency:
        - If (sender_id, client_id) already exists, return existing message
        - Prevents duplicate messages on retry
        """

        # Step 1: Validate sender is member of conversation
        is_member = db.query(ConversationMembers).filter(
            ConversationMembers.conversation_id == conversation_id,
            ConversationMembers.user_id == sender_id
        ).first()

        if not is_member:
            raise HTTPException(
                status_code=403,
                detail="You are not a member of this conversation"
            )

        # Step 2: Validate content length (4000-char limit)
        content = content.strip() if content else ""
        if len(content) == 0:
            raise HTTPException(
                status_code=400,
                detail="Message cannot be empty"
            )
        if len(content) > 4000:
            raise HTTPException(
                status_code=400,
                detail="Message must be 1-4000 characters"
            )

        # Step 3: Verify conversation exists
        conversation = db.query(Conversation).filter(
            Conversation.id == conversation_id
        ).first()

        if not conversation:
            raise HTTPException(
                status_code=400,
                detail="Conversation not found"
            )

        # Step 4: Idempotency check
        # Query for existing message with same (sender_id, client_id)
        existing_message = db.query(Message).filter(
            Message.conversation_id == conversation_id,
            Message.sender_id == sender_id,
            Message.client_id == client_id
        ).first()

        if existing_message:
            # Return existing message (don't create duplicate)
            return existing_message

        # Step 4b: Validate reply_to_message_id, if provided. A reply target
        # must exist AND belong to this same conversation -- anything else
        # (unknown id, wrong conversation, already-deleted message) is
        # treated as "no reply" rather than failing the whole send, so a
        # stale/bad reply reference from the client can never block sending
        # a message.
        validated_reply_to_id: int | None = None
        if reply_to_message_id is not None:
            reply_target = db.query(Message).filter(
                Message.id == reply_to_message_id,
                Message.conversation_id == conversation_id,
            ).first()
            if reply_target:
                validated_reply_to_id = reply_target.id

        # Step 5: Create new message
        try:
            message = Message(
                conversation_id=conversation_id,
                sender_id=sender_id,
                content=content,
                client_id=client_id,
                created_at=datetime.utcnow(),
                reply_to_message_id=validated_reply_to_id,
            )
            db.add(message)
            db.flush()  # Get message.id before creating receipts
        except IntegrityError:
            db.rollback()
            # If UNIQUE constraint failed, it means another request
            # created this message concurrently. Retrieve and return it.
            existing_message = db.query(Message).filter(
                Message.conversation_id == conversation_id,
                Message.sender_id == sender_id,
                Message.client_id == client_id
            ).first()
            if existing_message:
                return existing_message
            # If still not found, re-raise
            raise HTTPException(
                status_code=500,
                detail="Failed to create message"
            )

        # Step 6: Create pending receipts for each recipient
        # Get all conversation members except sender
        recipients = db.query(ConversationMembers).filter(
            ConversationMembers.conversation_id == conversation_id,
            ConversationMembers.user_id != sender_id
        ).all()

        for recipient in recipients:
            receipt = MessageReceipt(
                message_id=message.id,
                recipient_id=recipient.user_id,
                status="pending",
                created_at=datetime.utcnow()
                # delivered_at, read_at remain NULL until status changes
            )
            db.add(receipt)

        db.commit()
        db.refresh(message)

        return message

    @staticmethod
    async def get_pending_messages(
        user_id: int,
        db: Session
    ) -> list[Message]:
        """
        Retrieve ALL pending messages for a user.

        Args:
            user_id: User ID of recipient
            db: Database session

        Returns:
            List of Message objects where:
            - user_id is the recipient
            - receipt status is 'pending'
            - NO time cutoff (all pending, ever)

        Use case:
        - User reconnects after being offline
        - Fetch all messages they haven't yet delivered
        - Client will ACK each to update status to 'delivered'

        Query:
        SELECT DISTINCT messages.*
        FROM messages
        JOIN message_receipts ON messages.id = message_receipts.message_id
        WHERE message_receipts.recipient_id = ?
          AND message_receipts.status = 'pending'
        ORDER BY messages.created_at ASC
        """

        pending_messages = db.query(Message).join(
            MessageReceipt,
            Message.id == MessageReceipt.message_id
        ).filter(
            MessageReceipt.recipient_id == user_id,
            MessageReceipt.status == "pending"
        ).order_by(Message.created_at.asc()).all()

        return pending_messages

    @staticmethod
    def get_message_with_receipts(
        message_id: int,
        db: Session
    ) -> dict | None:
        """
        Get message with its receipt statuses for all recipients.

        Args:
            message_id: Message ID
            db: Database session

        Returns:
            Dict with message and receipt map:
            {
                "message": Message object,
                "receipts": {
                    recipient_id: {
                        "status": "pending|delivered|read",
                        "delivered_at": ISO8601 or None,
                        "read_at": ISO8601 or None
                    },
                    ...
                }
            }
            Returns None if message not found
        """

        message = db.query(Message).filter(Message.id == message_id).first()
        if not message:
            return None

        receipts_db = db.query(MessageReceipt).filter(
            MessageReceipt.message_id == message_id
        ).all()

        receipts = {}
        for receipt in receipts_db:
            receipts[receipt.recipient_id] = {
                "status": receipt.status,
                "delivered_at": utc_isoformat(receipt.delivered_at) if receipt.delivered_at else None,
                "read_at": utc_isoformat(receipt.read_at) if receipt.read_at else None,
            }

        return {
            "message": message,
            "receipts": receipts
        }
