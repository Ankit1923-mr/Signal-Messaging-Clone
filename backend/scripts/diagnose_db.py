import sys
from pathlib import Path

# Add backend dir to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal
from app.models import Message, MessageReceipt, ConversationReadCursor

db = SessionLocal()

msg = db.query(Message).filter(Message.content == 'TEST_RECEIPT_001').order_by(Message.id.desc()).first()
if not msg:
    print("Message not found!")
else:
    print(f"Message ID: {msg.id}")
    print(f"Sender ID: {msg.sender_id}")
    print(f"Conversation ID: {msg.conversation_id}")
    print(f"Client ID: {msg.client_id}")

    print("\nReceipts:")
    receipts = db.query(MessageReceipt).filter(MessageReceipt.message_id == msg.id).all()
    for r in receipts:
        print(f"- Recipient: {r.recipient_id}, Status: {r.status}, Delivered At: {r.delivered_at}, Read At: {r.read_at}")

    print("\nCursors:")
    cursors = db.query(ConversationReadCursor).filter(ConversationReadCursor.conversation_id == msg.conversation_id).all()
    for c in cursors:
        print(f"- User: {c.user_id}, Last Read Msg ID: {c.last_read_message_id}, Updated At: {c.updated_at}")
