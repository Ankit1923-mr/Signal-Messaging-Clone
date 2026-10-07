"""
Receipt Service

Manage message delivery/read state machine:
  pending → delivered → read

Timestamps:
- created_at: when receipt created (same as message)
- delivered_at: when client ACKs delivery (message reached device)
- read_at: when client marks read (user opened message)

Constraint: No backwards transitions (can't go read → delivered)
"""

from datetime import datetime
from sqlalchemy.orm import Session
from fastapi import HTTPException

from app.models import (
    Message,
    MessageReceipt,
    ConversationReadCursor,
    Conversation,
)
from app.time_utils import utc_isoformat


class ReceiptService:
    """
    Service for receipt state management.

    Key invariant: State machine is strictly forward only.
    pending → delivered → read
    """

    @staticmethod
    async def update_receipt(
        message_id: int,
        recipient_id: int,
        status: str,  # "delivered" or "read"
        db: Session
    ) -> MessageReceipt:
        """
        Update receipt status (pending → delivered or delivered → read).

        Args:
            message_id: Message ID
            recipient_id: User ID of recipient
            status: New status ("delivered" or "read")
            db: Database session

        Returns:
            Updated MessageReceipt

        Raises:
            HTTPException(404): Receipt not found
            HTTPException(400): Invalid status or backwards transition

        Allowed transitions:
        - pending → delivered (message reached device)
        - delivered → read (user opened message)
        - pending → read (client skips delivery, goes straight to read)

        Rejected transitions:
        - delivered → pending (backwards)
        - read → * (already terminal)
        - read → delivered (backwards)
        - read → pending (backwards)
        """

        # Step 1: Find receipt
        receipt = db.query(MessageReceipt).filter(
            MessageReceipt.message_id == message_id,
            MessageReceipt.recipient_id == recipient_id
        ).first()

        if not receipt:
            raise HTTPException(
                status_code=404,
                detail="Receipt not found"
            )

        # Step 2: Validate status value
        if status not in ("delivered", "read"):
            raise HTTPException(
                status_code=400,
                detail="Invalid status. Must be 'delivered' or 'read'"
            )

        # Step 3: Check state transitions (forward only)
        current_status = receipt.status

        # If already at target or beyond, no-op (idempotent)
        if current_status == "read":
            # Already terminal, no change needed
            return receipt

        if current_status == "delivered" and status == "delivered":
            # Already there, no change
            return receipt

        if current_status == "pending" and status == "pending":
            # Already there, no change
            return receipt

        # Reject backwards transitions
        if current_status == "delivered" and status == "pending":
            raise HTTPException(
                status_code=400,
                detail="Cannot transition from delivered back to pending"
            )

        if current_status == "read" and status in ("pending", "delivered"):
            raise HTTPException(
                status_code=400,
                detail="Cannot transition backwards from read"
            )

        # Step 4: Update receipt with new status
        now = datetime.utcnow()

        if status == "delivered":
            receipt.status = "delivered"
            receipt.delivered_at = now
        elif status == "read":
            receipt.status = "read"
            receipt.read_at = now
            # Also set delivered_at if not already set
            if not receipt.delivered_at:
                receipt.delivered_at = now

        db.add(receipt)
        db.flush()

        # Step 5: If status is "read", update conversation read cursor
        if status == "read":
            message = db.query(Message).filter(Message.id == message_id).first()
            if message:
                # Find or create read cursor for this conversation
                cursor = db.query(ConversationReadCursor).filter(
                    ConversationReadCursor.conversation_id == message.conversation_id,
                    ConversationReadCursor.user_id == recipient_id
                ).first()

                if cursor:
                    # Update existing cursor
                    if message_id > (cursor.last_read_message_id or 0):
                        cursor.last_read_message_id = message_id
                        cursor.updated_at = now
                else:
                    # Create new cursor
                    cursor = ConversationReadCursor(
                        conversation_id=message.conversation_id,
                        user_id=recipient_id,
                        last_read_message_id=message_id,
                        updated_at=now
                    )
                    db.add(cursor)

        db.commit()
        db.refresh(receipt)

        return receipt

    @staticmethod
    def get_receipt(
        message_id: int,
        recipient_id: int,
        db: Session
    ) -> MessageReceipt | None:
        """
        Get receipt for a message-recipient pair.

        Args:
            message_id: Message ID
            recipient_id: User ID of recipient
            db: Database session

        Returns:
            MessageReceipt or None if not found
        """

        receipt = db.query(MessageReceipt).filter(
            MessageReceipt.message_id == message_id,
            MessageReceipt.recipient_id == recipient_id
        ).first()

        return receipt

    @staticmethod
    def get_message_read_status(
        message_id: int,
        db: Session
    ) -> dict:
        """
        Get read status summary for a message (all recipients).

        Args:
            message_id: Message ID
            db: Database session

        Returns:
            Dict:
            {
                "pending": 2,      # Count of pending receipts
                "delivered": 1,    # Count of delivered receipts
                "read": 3,         # Count of read receipts
                "details": {
                    recipient_id: {
                        "status": "pending|delivered|read",
                        "delivered_at": ISO8601 or None,
                        "read_at": ISO8601 or None
                    },
                    ...
                }
            }
        """

        receipts = db.query(MessageReceipt).filter(
            MessageReceipt.message_id == message_id
        ).all()

        summary = {
            "pending": 0,
            "delivered": 0,
            "read": 0,
            "details": {}
        }

        for receipt in receipts:
            summary[receipt.status] += 1
            summary["details"][receipt.recipient_id] = {
                "status": receipt.status,
                "delivered_at": utc_isoformat(receipt.delivered_at) if receipt.delivered_at else None,
                "read_at": utc_isoformat(receipt.read_at) if receipt.read_at else None,
            }

        return summary

    @staticmethod
    def get_unread_count(
        conversation_id: int,
        user_id: int,
        db: Session
    ) -> int:
        """
        Get count of unread messages in a conversation for a user.

        Args:
            conversation_id: Conversation ID
            user_id: User ID
            db: Database session

        Returns:
            Count of messages where recipient_id=user_id and status != 'read'
        """

        unread_count = db.query(MessageReceipt).join(
            Message,
            MessageReceipt.message_id == Message.id
        ).filter(
            Message.conversation_id == conversation_id,
            MessageReceipt.recipient_id == user_id,
            MessageReceipt.status != "read"
        ).count()

        return unread_count
