"""
Reply-to-message tests (S5): persistence, the denormalized reply preview
on send/history, and graceful handling of an invalid/cross-conversation
reply target. Does not touch receipts, typing, idempotency, or
reconnection behavior -- those are exercised by the existing suites.

Uses conftest.py fixtures for client and db_session.
"""

import pytest

from app.models import Message
from app.services.messaging import MessagingService, build_reply_preview


def register_and_verify(client, identifier, password="password123", display_name="Test User"):
    response = client.post("/auth/register", json={
        "identifier": identifier,
        "password": password,
        "display_name": display_name,
    })
    assert response.status_code == 201
    data = response.json()

    otp_response = client.post("/auth/verify-otp", json={
        "user_id": data["user_id"],
        "otp": "123456",
    })
    assert otp_response.status_code == 200
    return data["user_id"]


def login(client, identifier, password="password123"):
    csrf = client.get("/auth/csrf").json()["csrf_token"]
    response = client.post(
        "/auth/login",
        json={"username": identifier, "password": password},
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 200
    return response.json()


@pytest.mark.asyncio
async def test_reply_persists_and_history_includes_preview(client, db_session):
    alice_id = register_and_verify(client, "alice-r1@example.com", display_name="Alice")
    bob_id = register_and_verify(client, "bob-r1@example.com", display_name="Bob")
    login(client, "alice-r1@example.com")

    conv = client.post("/conversations/direct", json={"other_user_id": bob_id}).json()
    conversation_id = conv["id"]

    original = await MessagingService.send_message(
        sender_id=alice_id,
        conversation_id=conversation_id,
        client_id="orig-1",
        content="Are we meeting at 5?",
        db=db_session,
    )

    reply = await MessagingService.send_message(
        sender_id=bob_id,
        conversation_id=conversation_id,
        client_id="reply-1",
        content="Yes, I'll be there.",
        db=db_session,
        reply_to_message_id=original.id,
    )

    persisted = db_session.query(Message).filter(Message.id == reply.id).first()
    assert persisted.reply_to_message_id == original.id

    history = client.get(f"/conversations/{conversation_id}/messages").json()
    reply_entry = next(m for m in history if m["id"] == reply.id)
    assert reply_entry["reply_to_message_id"] == original.id
    assert reply_entry["reply_to_sender_id"] == alice_id
    assert reply_entry["reply_to_content"] == "Are we meeting at 5?"
    assert reply_entry["reply_to_deleted"] is False

    # The original (non-reply) message carries no reply fields.
    original_entry = next(m for m in history if m["id"] == original.id)
    assert original_entry["reply_to_message_id"] is None
    assert original_entry["reply_to_deleted"] is False


@pytest.mark.asyncio
async def test_reply_to_unknown_message_is_ignored_not_failed(client, db_session):
    """An invalid reply_to_message_id (doesn't exist) must not fail the
    send -- it's treated as a normal, non-reply message."""
    alice_id = register_and_verify(client, "alice-r2@example.com", display_name="Alice")
    bob_id = register_and_verify(client, "bob-r2@example.com", display_name="Bob")
    login(client, "alice-r2@example.com")

    conv = client.post("/conversations/direct", json={"other_user_id": bob_id}).json()

    message = await MessagingService.send_message(
        sender_id=alice_id,
        conversation_id=conv["id"],
        client_id="reply-to-ghost",
        content="Replying to nothing",
        db=db_session,
        reply_to_message_id=999999,
    )

    assert message.reply_to_message_id is None
    preview = build_reply_preview(message, db_session)
    assert preview["reply_to_message_id"] is None
    assert preview["reply_to_deleted"] is False


@pytest.mark.asyncio
async def test_reply_to_message_in_different_conversation_is_ignored(client, db_session):
    """A reply_to_message_id from a DIFFERENT conversation must not be
    accepted -- that would leak content across conversations."""
    alice_id = register_and_verify(client, "alice-r3@example.com", display_name="Alice")
    bob_id = register_and_verify(client, "bob-r3@example.com", display_name="Bob")
    carol_id = register_and_verify(client, "carol-r3@example.com", display_name="Carol")
    login(client, "alice-r3@example.com")

    conv_ab = client.post("/conversations/direct", json={"other_user_id": bob_id}).json()
    conv_ac = client.post("/conversations/direct", json={"other_user_id": carol_id}).json()

    message_in_ac = await MessagingService.send_message(
        sender_id=alice_id,
        conversation_id=conv_ac["id"],
        client_id="in-ac",
        content="Secret for Carol only",
        db=db_session,
    )

    cross_reply = await MessagingService.send_message(
        sender_id=alice_id,
        conversation_id=conv_ab["id"],
        client_id="cross-reply",
        content="Trying to reply across conversations",
        db=db_session,
        reply_to_message_id=message_in_ac.id,
    )

    assert cross_reply.reply_to_message_id is None


def test_build_reply_preview_handles_dangling_reply_reference(db_session):
    """build_reply_preview() must report reply_to_deleted=True, not error,
    if reply_to_message_id points at an id that doesn't resolve to any row.

    In normal operation ON DELETE SET NULL means this id is cleared the
    instant an original message row is deleted (there's no message-delete
    feature yet, so this never happens today) -- this exercises that
    defensive branch directly with a transient (never persisted) Message
    object, the same way a future hard-delete or data-migration edge case
    could produce a dangling reference, without touching real DB rows or
    connection-level state other tests depend on.
    """
    dangling_reply = Message(
        id=999999,
        conversation_id=1,
        sender_id=1,
        client_id="dangling",
        content="Replying to something gone",
        reply_to_message_id=888888,  # does not exist in the DB
    )

    preview = build_reply_preview(dangling_reply, db_session)
    assert preview["reply_to_message_id"] == 888888
    assert preview["reply_to_deleted"] is True
    assert preview["reply_to_sender_id"] is None
    assert preview["reply_to_content"] is None
