"""
Group messaging tests: creation, admin member management, a message/receipt
persistence check for 3+ member groups (verifying the existing generic
conversation-scoped messaging infra needs no group-specific changes), and a
regression check that direct (1:1) conversations are unaffected.

Uses conftest.py fixtures for client and db_session.
"""

import pytest

from app.models import Conversation, ConversationMembers, Group, Message, MessageReceipt
from app.services.messaging import MessagingService


def register_and_verify(client, identifier, password="password123", display_name="Test User"):
    """Register + OTP-verify a user (mock OTP 123456), returning user_id."""
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
    """Log in as an already-verified user. Cookies are stored on `client`."""
    csrf = client.get("/auth/csrf").json()["csrf_token"]
    response = client.post(
        "/auth/login",
        json={"username": identifier, "password": password},
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 200
    return response.json()


# ============================================================================
# GROUP CREATION
# ============================================================================

def test_create_group_basic(client, db_session):
    """Creator + members all become conversation members; creator is admin."""
    alice_id = register_and_verify(client, "alice@example.com", display_name="Alice")
    bob_id = register_and_verify(client, "bob@example.com", display_name="Bob")
    login(client, "alice@example.com")

    response = client.post("/conversations/group", json={
        "name": "Study Group",
        "member_ids": [bob_id],
    })

    assert response.status_code == 201
    data = response.json()
    assert data["type"] == "group"
    assert data["name"] == "Study Group"
    assert data["admin_id"] == alice_id
    member_ids = {m["id"] for m in data["members"]}
    assert member_ids == {alice_id, bob_id}


def test_create_group_creator_becomes_admin_and_member(client, db_session):
    """Creator is always included as a member even if member_ids omits them."""
    alice_id = register_and_verify(client, "alice2@example.com", display_name="Alice")
    bob_id = register_and_verify(client, "bob2@example.com", display_name="Bob")
    login(client, "alice2@example.com")

    response = client.post("/conversations/group", json={
        "name": "No Self Included",
        "member_ids": [bob_id],  # creator's own id intentionally omitted
    })

    assert response.status_code == 201
    data = response.json()
    member_ids = {m["id"] for m in data["members"]}
    assert alice_id in member_ids

    group = db_session.query(Group).filter(Group.conversation_id == data["id"]).first()
    assert group is not None
    assert group.admin_id == alice_id


def test_create_group_multiple_members(client, db_session):
    """A group with 3+ members persists every membership row."""
    alice_id = register_and_verify(client, "alice3@example.com", display_name="Alice")
    bob_id = register_and_verify(client, "bob3@example.com", display_name="Bob")
    carol_id = register_and_verify(client, "carol3@example.com", display_name="Carol")
    dave_id = register_and_verify(client, "dave3@example.com", display_name="Dave")
    login(client, "alice3@example.com")

    response = client.post("/conversations/group", json={
        "name": "Big Group",
        "member_ids": [bob_id, carol_id, dave_id],
    })

    assert response.status_code == 201
    data = response.json()
    member_ids = {m["id"] for m in data["members"]}
    assert member_ids == {alice_id, bob_id, carol_id, dave_id}

    rows = db_session.query(ConversationMembers).filter(
        ConversationMembers.conversation_id == data["id"]
    ).all()
    assert len(rows) == 4


def test_create_group_unknown_user_rejected(client, db_session):
    """An unknown member_id is rejected; no conversation is created."""
    register_and_verify(client, "alice4@example.com", display_name="Alice")
    login(client, "alice4@example.com")

    response = client.post("/conversations/group", json={
        "name": "Ghost Group",
        "member_ids": [999999],
    })

    assert response.status_code == 404
    assert db_session.query(Conversation).filter(Conversation.name == "Ghost Group").first() is None


def test_create_group_empty_name_rejected(client, db_session):
    """An empty (or whitespace-only) group name is rejected."""
    register_and_verify(client, "alice5@example.com", display_name="Alice")
    login(client, "alice5@example.com")

    response = client.post("/conversations/group", json={
        "name": "   ",
        "member_ids": [],
    })

    assert response.status_code == 422


def test_create_group_duplicate_membership_deduplicated(client, db_session):
    """Passing the same member id twice (or the creator's own id) never
    produces duplicate ConversationMembers rows."""
    alice_id = register_and_verify(client, "alice6@example.com", display_name="Alice")
    bob_id = register_and_verify(client, "bob6@example.com", display_name="Bob")
    login(client, "alice6@example.com")

    response = client.post("/conversations/group", json={
        "name": "Dedup Group",
        "member_ids": [bob_id, bob_id, alice_id],
    })

    assert response.status_code == 201
    data = response.json()
    rows = db_session.query(ConversationMembers).filter(
        ConversationMembers.conversation_id == data["id"]
    ).all()
    assert len(rows) == 2


# ============================================================================
# ADMIN MEMBER MANAGEMENT
# ============================================================================

def _create_group(client, admin_identifier, name, member_ids):
    login(client, admin_identifier)
    response = client.post("/conversations/group", json={"name": name, "member_ids": member_ids})
    assert response.status_code == 201
    return response.json()


def test_non_admin_cannot_add_members(client, db_session):
    alice_id = register_and_verify(client, "alice7@example.com", display_name="Alice")
    bob_id = register_and_verify(client, "bob7@example.com", display_name="Bob")
    carol_id = register_and_verify(client, "carol7@example.com", display_name="Carol")

    group = _create_group(client, "alice7@example.com", "Group7", [bob_id])

    # Bob (non-admin member) tries to add Carol.
    login(client, "bob7@example.com")
    response = client.post(f"/conversations/{group['id']}/members", json={"user_id": carol_id})

    assert response.status_code == 403


def test_non_admin_cannot_remove_members(client, db_session):
    alice_id = register_and_verify(client, "alice8@example.com", display_name="Alice")
    bob_id = register_and_verify(client, "bob8@example.com", display_name="Bob")
    carol_id = register_and_verify(client, "carol8@example.com", display_name="Carol")

    group = _create_group(client, "alice8@example.com", "Group8", [bob_id, carol_id])

    # Bob (non-admin member) tries to remove Carol.
    login(client, "bob8@example.com")
    response = client.delete(f"/conversations/{group['id']}/members/{carol_id}")

    assert response.status_code == 403


def test_admin_can_add_member(client, db_session):
    alice_id = register_and_verify(client, "alice9@example.com", display_name="Alice")
    bob_id = register_and_verify(client, "bob9@example.com", display_name="Bob")
    carol_id = register_and_verify(client, "carol9@example.com", display_name="Carol")

    group = _create_group(client, "alice9@example.com", "Group9", [bob_id])

    login(client, "alice9@example.com")
    response = client.post(f"/conversations/{group['id']}/members", json={"user_id": carol_id})

    assert response.status_code == 201
    data = response.json()
    member_ids = {m["id"] for m in data["members"]}
    assert member_ids == {alice_id, bob_id, carol_id}


def test_admin_add_member_unknown_user_rejected(client, db_session):
    register_and_verify(client, "alice10@example.com", display_name="Alice")
    group = _create_group(client, "alice10@example.com", "Group10", [])

    login(client, "alice10@example.com")
    response = client.post(f"/conversations/{group['id']}/members", json={"user_id": 999999})

    assert response.status_code == 404


def test_admin_add_member_duplicate_rejected(client, db_session):
    alice_id = register_and_verify(client, "alice11@example.com", display_name="Alice")
    bob_id = register_and_verify(client, "bob11@example.com", display_name="Bob")
    group = _create_group(client, "alice11@example.com", "Group11", [bob_id])

    login(client, "alice11@example.com")
    response = client.post(f"/conversations/{group['id']}/members", json={"user_id": bob_id})

    assert response.status_code == 400


def test_admin_can_remove_member(client, db_session):
    alice_id = register_and_verify(client, "alice12@example.com", display_name="Alice")
    bob_id = register_and_verify(client, "bob12@example.com", display_name="Bob")
    group = _create_group(client, "alice12@example.com", "Group12", [bob_id])

    login(client, "alice12@example.com")
    response = client.delete(f"/conversations/{group['id']}/members/{bob_id}")

    assert response.status_code == 200
    data = response.json()
    member_ids = {m["id"] for m in data["members"]}
    assert member_ids == {alice_id}


def test_admin_remove_nonmember_rejected(client, db_session):
    alice_id = register_and_verify(client, "alice13@example.com", display_name="Alice")
    bob_id = register_and_verify(client, "bob13@example.com", display_name="Bob")
    outsider_id = register_and_verify(client, "outsider13@example.com", display_name="Outsider")
    group = _create_group(client, "alice13@example.com", "Group13", [bob_id])

    login(client, "alice13@example.com")
    response = client.delete(f"/conversations/{group['id']}/members/{outsider_id}")

    assert response.status_code == 404


def test_admin_cannot_remove_self_via_normal_removal(client, db_session):
    alice_id = register_and_verify(client, "alice14@example.com", display_name="Alice")
    bob_id = register_and_verify(client, "bob14@example.com", display_name="Bob")
    group = _create_group(client, "alice14@example.com", "Group14", [bob_id])

    login(client, "alice14@example.com")
    response = client.delete(f"/conversations/{group['id']}/members/{alice_id}")

    assert response.status_code == 400

    # Admin membership must still be intact.
    rows = db_session.query(ConversationMembers).filter(
        ConversationMembers.conversation_id == group["id"],
        ConversationMembers.user_id == alice_id,
    ).first()
    assert rows is not None


# ============================================================================
# GROUP MESSAGE SEND / PERSIST / RECEIPT VERIFICATION (3+ members)
# ============================================================================

@pytest.mark.asyncio
async def test_group_message_persists_and_creates_receipts_for_all_other_members(client, db_session):
    """
    A message sent into a 3-member group is persisted once and a pending
    receipt is created for every OTHER member (not the sender) — this is
    the same generic, conversation-scoped MessagingService.send_message
    path direct conversations already use; verifying it here confirms no
    group-specific messaging code is needed, per the audit.
    """
    alice_id = register_and_verify(client, "alice16@example.com", display_name="Alice")
    bob_id = register_and_verify(client, "bob16@example.com", display_name="Bob")
    carol_id = register_and_verify(client, "carol16@example.com", display_name="Carol")

    group = _create_group(client, "alice16@example.com", "Group16", [bob_id, carol_id])
    conversation_id = group["id"]

    message = await MessagingService.send_message(
        sender_id=alice_id,
        conversation_id=conversation_id,
        client_id="group-msg-1",
        content="Hello group!",
        db=db_session,
    )

    persisted = db_session.query(Message).filter(Message.id == message.id).first()
    assert persisted is not None
    assert persisted.content == "Hello group!"
    assert persisted.conversation_id == conversation_id

    receipts = db_session.query(MessageReceipt).filter(
        MessageReceipt.message_id == message.id
    ).all()
    recipient_ids = {r.recipient_id for r in receipts}
    assert recipient_ids == {bob_id, carol_id}
    assert all(r.status == "pending" for r in receipts)

    # Reload (simulates a page refresh): message history is still there.
    history_response = client.get(f"/conversations/{conversation_id}/messages")
    assert history_response.status_code == 200
    history = history_response.json()
    assert any(m["id"] == message.id and m["content"] == "Hello group!" for m in history)


# ============================================================================
# REGRESSION: DIRECT (1:1) CONVERSATIONS STILL WORK
# ============================================================================

def test_direct_conversation_still_works(client, db_session):
    """Existing find-or-create direct-conversation behavior is unaffected
    by the group-conversation additions."""
    alice_id = register_and_verify(client, "alice15@example.com", display_name="Alice")
    bob_id = register_and_verify(client, "bob15@example.com", display_name="Bob")
    login(client, "alice15@example.com")

    response1 = client.post("/conversations/direct", json={"other_user_id": bob_id})
    assert response1.status_code == 201
    data1 = response1.json()
    assert data1["type"] == "direct"
    assert data1["admin_id"] is None
    member_ids = {m["id"] for m in data1["members"]}
    assert member_ids == {alice_id, bob_id}

    # Calling again must return the same conversation, not a duplicate.
    response2 = client.post("/conversations/direct", json={"other_user_id": bob_id})
    assert response2.status_code == 201
    assert response2.json()["id"] == data1["id"]

    count = db_session.query(Conversation).filter(Conversation.type == "direct").count()
    assert count == 1
