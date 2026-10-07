"""
Conversation and user-search endpoints.

Minimal REST surface needed for the frontend's conversation list + "Add
Contact" flow:
- GET  /users/search              Find a user to start a direct conversation with
- GET  /conversations              List the current user's existing conversations
                                   (DB is the source of truth — this is what
                                   hydrates the frontend on page load/refresh;
                                   see useConversations.ts).
- POST /conversations/direct      Find-or-create a 1:1 conversation (idempotent)
- GET  /conversations/{id}        Fetch conversation metadata (members etc.)
                                   for a conversation the caller didn't
                                   initiate -- needed so the RECIPIENT of a
                                   brand-new conversation's first message can
                                   learn who it's with (see useWebSocket.ts's
                                   MESSAGE_RECEIVED handler).
- GET  /conversations/{id}/messages  Fetch persisted message history for a
                                   conversation, so messages survive a page
                                   refresh instead of only existing in the
                                   live-session Zustand store.
- POST /conversations/group       Create a group conversation (creator becomes admin)
- POST /conversations/{id}/members         Admin-only: add a member to a group
- DELETE /conversations/{id}/members/{uid} Admin-only: remove a member from a group

Authenticated via the same httpOnly access_token cookie used elsewhere
(see app.dependencies.get_current_user_from_cookie) — no new auth
mechanism, no WebSocket protocol changes.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.database import get_db
from app.dependencies import get_current_user_from_cookie
from app.models import Conversation, ConversationMembers, Group, Message, MessageReceipt, User
from app.schemas import (
    AddGroupMemberRequest,
    ConversationResponse,
    CreateDirectConversationRequest,
    CreateGroupConversationRequest,
    MessageHistoryResponse,
    UserResponse,
)
from app.services.messaging import build_reply_preview
from app.time_utils import utc_isoformat

router = APIRouter(tags=["conversations"])


def _pair_key(user_a: int, user_b: int) -> str:
    """Deterministic key for a pair of user ids, e.g. "3:7" (lower id first)."""
    lo, hi = sorted((user_a, user_b))
    return f"{lo}:{hi}"


def _conversation_to_response(conversation: Conversation, db: Session) -> ConversationResponse:
    member_ids = [m.user_id for m in conversation.members]
    members = db.query(User).filter(User.id.in_(member_ids)).all()
    admin_id = None
    if conversation.type == "group":
        group = db.query(Group).filter(Group.conversation_id == conversation.id).first()
        admin_id = group.admin_id if group else None
    return ConversationResponse(
        id=conversation.id,
        type=conversation.type,
        name=conversation.name,
        members=[UserResponse.model_validate(m) for m in members],
        admin_id=admin_id,
    )


@router.get("/users/search", response_model=list[UserResponse])
def search_users(
    q: str = Query("", max_length=100),
    current_user: User = Depends(get_current_user_from_cookie),
    db: Session = Depends(get_db),
):
    """
    Search users by username or display name (case-insensitive substring).
    Excludes the current user. Empty query returns a short default list so
    the "New Conversation" picker isn't empty before the user types anything.
    """
    query = db.query(User).filter(User.id != current_user.id)

    if q.strip():
        pattern = f"%{q.strip()}%"
        query = query.filter(
            or_(User.username.ilike(pattern), User.display_name.ilike(pattern))
        )

    users = query.order_by(User.display_name).limit(20).all()
    return [UserResponse.model_validate(u) for u in users]


@router.get("/conversations", response_model=list[ConversationResponse])
def list_conversations(
    current_user: User = Depends(get_current_user_from_cookie),
    db: Session = Depends(get_db),
):
    """
    List every conversation the current user is a member of.

    This is the hydration source for the frontend on page load/refresh:
    before this endpoint existed, the conversation list only ever came from
    live events (POST /conversations/direct's own response, or the
    MESSAGE_RECEIVED handler's GET /conversations/{id} fetch) held in
    Zustand's in-memory store — nothing repopulated it after a refresh reset
    that store to empty. Read-only: does not create or modify anything.
    """
    membership_rows = db.query(ConversationMembers).filter(
        ConversationMembers.user_id == current_user.id
    ).all()
    conversation_ids = [m.conversation_id for m in membership_rows]
    if not conversation_ids:
        return []

    conversations = db.query(Conversation).filter(
        Conversation.id.in_(conversation_ids)
    ).all()
    return [_conversation_to_response(c, db) for c in conversations]


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageHistoryResponse])
def get_conversation_messages(
    conversation_id: int,
    current_user: User = Depends(get_current_user_from_cookie),
    db: Session = Depends(get_db),
):
    """
    Fetch persisted message history for a conversation, oldest first.

    Needed so messages already stored in the database remain visible after
    a page refresh — previously nothing ever fetched message history; the
    frontend only ever saw messages that arrived live over the WebSocket
    during the current session, or (for messages still undelivered) the
    bounded "pending" recovery list sent on reconnect.

    Does not change the receipt state machine: `status` just reports each
    message's already-existing receipt row (read-only), using whichever
    receipt is relevant to the viewer --- for a direct (1:1) conversation
    there is exactly one receipt per message, so no new logic is needed to
    pick the right one.
    """
    is_member = db.query(ConversationMembers).filter(
        ConversationMembers.conversation_id == conversation_id,
        ConversationMembers.user_id == current_user.id,
    ).first()
    if not is_member:
        raise HTTPException(status_code=403, detail="Not a member of this conversation")

    messages = db.query(Message).filter(
        Message.conversation_id == conversation_id
    ).order_by(Message.created_at.asc()).all()

    message_ids = [m.id for m in messages]
    receipts_by_message = {}
    if message_ids:
        for receipt in db.query(MessageReceipt).filter(
            MessageReceipt.message_id.in_(message_ids)
        ).all():
            receipts_by_message[receipt.message_id] = receipt

    result = []
    for m in messages:
        receipt = receipts_by_message.get(m.id)
        result.append(MessageHistoryResponse(
            id=m.id,
            conversation_id=m.conversation_id,
            sender_id=m.sender_id if m.sender_id is not None else 0,
            client_id=m.client_id,
            content=m.content,
            created_at=utc_isoformat(m.created_at),
            status=receipt.status if receipt else "pending",
            **build_reply_preview(m, db),
        ))
    return result


@router.get("/conversations/{conversation_id}", response_model=ConversationResponse)
def get_conversation(
    conversation_id: int,
    current_user: User = Depends(get_current_user_from_cookie),
    db: Session = Depends(get_db),
):
    """
    Fetch a single conversation's metadata (type, name, members).

    Used by the recipient of a brand-new conversation's first WebSocket
    message: they never called POST /conversations/direct themselves, so
    this is how their frontend learns who the conversation is with.
    """
    conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    is_member = db.query(ConversationMembers).filter(
        ConversationMembers.conversation_id == conversation_id,
        ConversationMembers.user_id == current_user.id,
    ).first()
    if not is_member:
        raise HTTPException(status_code=403, detail="Not a member of this conversation")

    return _conversation_to_response(conversation, db)


@router.post("/conversations/direct", response_model=ConversationResponse, status_code=201)
def create_or_get_direct_conversation(
    data: CreateDirectConversationRequest,
    current_user: User = Depends(get_current_user_from_cookie),
    db: Session = Depends(get_db),
):
    """
    Find the existing direct conversation between the current user and
    other_user_id, or create it. Idempotent: calling this twice for the
    same pair never creates a duplicate (direct_pair_key is UNIQUE).
    """
    if data.other_user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot start a conversation with yourself")

    other_user = db.query(User).filter(User.id == data.other_user_id).first()
    if not other_user:
        raise HTTPException(status_code=404, detail="User not found")

    pair_key = _pair_key(current_user.id, data.other_user_id)

    existing = db.query(Conversation).filter(
        Conversation.type == "direct",
        Conversation.direct_pair_key == pair_key,
    ).first()
    if existing:
        # Defensive repair: an older bug could leave a conversation row
        # committed with no members if the request was interrupted between
        # the two separate commits that used to exist here. If we ever find
        # one, backfill the two membership rows now rather than returning a
        # conversation with an empty members list forever.
        if not existing.members:
            db.add(ConversationMembers(conversation_id=existing.id, user_id=current_user.id))
            db.add(ConversationMembers(conversation_id=existing.id, user_id=data.other_user_id))
            db.commit()
            db.refresh(existing)
        return _conversation_to_response(existing, db)

    # Not found — create the conversation AND its two membership rows in a
    # single transaction (one commit), so a request interrupted partway
    # through can never leave an orphaned, memberless conversation behind.
    # The UNIQUE(direct_pair_key) constraint is the authoritative safety net
    # against a concurrent duplicate creation race from the other side.
    conversation = Conversation(
        type="direct",
        name=None,
        created_by=current_user.id,
        direct_pair_key=pair_key,
    )
    db.add(conversation)
    try:
        db.flush()  # assigns conversation.id without committing yet
        db.add(ConversationMembers(conversation_id=conversation.id, user_id=current_user.id))
        db.add(ConversationMembers(conversation_id=conversation.id, user_id=data.other_user_id))
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(Conversation).filter(
            Conversation.type == "direct",
            Conversation.direct_pair_key == pair_key,
        ).first()
        if existing:
            if not existing.members:
                db.add(ConversationMembers(conversation_id=existing.id, user_id=current_user.id))
                db.add(ConversationMembers(conversation_id=existing.id, user_id=data.other_user_id))
                db.commit()
                db.refresh(existing)
            return _conversation_to_response(existing, db)
        raise HTTPException(status_code=500, detail="Failed to create conversation")

    db.refresh(conversation)
    return _conversation_to_response(conversation, db)


@router.post("/conversations/group", response_model=ConversationResponse, status_code=201)
def create_group_conversation(
    data: CreateGroupConversationRequest,
    current_user: User = Depends(get_current_user_from_cookie),
    db: Session = Depends(get_db),
):
    """
    Create a new group conversation. The creator becomes the group's admin
    and is always a member, regardless of whether they included their own
    id in member_ids.

    Validates every requested member id actually exists before creating
    anything, then creates the Conversation, its Group admin row, and every
    ConversationMembers row in a single transaction — a request interrupted
    partway through can never leave an orphaned group or partial membership
    behind. Duplicate ids in member_ids (including the creator's own id) are
    de-duplicated before insertion so the UNIQUE(conversation_id, user_id)
    constraint is never hit under normal use.
    """
    member_ids = set(data.member_ids)
    member_ids.add(current_user.id)

    if member_ids - {current_user.id}:
        found_users = db.query(User).filter(User.id.in_(member_ids)).all()
        found_ids = {u.id for u in found_users}
        missing = member_ids - found_ids
        if missing:
            raise HTTPException(status_code=404, detail=f"User(s) not found: {sorted(missing)}")

    conversation = Conversation(
        type="group",
        name=data.name,
        created_by=current_user.id,
        direct_pair_key=None,
    )
    db.add(conversation)
    db.flush()  # assigns conversation.id without committing yet

    db.add(Group(conversation_id=conversation.id, admin_id=current_user.id))
    for member_id in member_ids:
        db.add(ConversationMembers(conversation_id=conversation.id, user_id=member_id))

    db.commit()
    db.refresh(conversation)
    return _conversation_to_response(conversation, db)


def _get_group_and_admin_check(
    conversation_id: int, current_user: User, db: Session
) -> tuple[Conversation, Group]:
    """
    Shared validation for the admin member-management endpoints: the
    conversation must exist and be a group, and the current user must be
    its admin. Raises the appropriate HTTPException otherwise.
    """
    conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation.type != "group":
        raise HTTPException(status_code=400, detail="Not a group conversation")

    group = db.query(Group).filter(Group.conversation_id == conversation_id).first()
    if not group:
        raise HTTPException(status_code=500, detail="Group metadata missing")

    if group.admin_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the group admin can manage members")

    return conversation, group


@router.post("/conversations/{conversation_id}/members", response_model=ConversationResponse, status_code=201)
def add_group_member(
    conversation_id: int,
    data: AddGroupMemberRequest,
    current_user: User = Depends(get_current_user_from_cookie),
    db: Session = Depends(get_db),
):
    """
    Add a member to a group. Admin-only. Rejects a user that doesn't exist
    or is already a member. Single commit: either the membership row is
    added or nothing changes.
    """
    conversation, _group = _get_group_and_admin_check(conversation_id, current_user, db)

    target_user = db.query(User).filter(User.id == data.user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    existing_membership = db.query(ConversationMembers).filter(
        ConversationMembers.conversation_id == conversation_id,
        ConversationMembers.user_id == data.user_id,
    ).first()
    if existing_membership:
        raise HTTPException(status_code=400, detail="User is already a member of this group")

    db.add(ConversationMembers(conversation_id=conversation_id, user_id=data.user_id))
    db.commit()
    db.refresh(conversation)
    return _conversation_to_response(conversation, db)


@router.delete("/conversations/{conversation_id}/members/{user_id}", response_model=ConversationResponse)
def remove_group_member(
    conversation_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user_from_cookie),
    db: Session = Depends(get_db),
):
    """
    Remove a member from a group. Admin-only. The admin cannot remove
    themselves via this endpoint (there is no reassignment-of-admin flow,
    so that would leave the group without an admin). Rejects removing a
    user who isn't currently a member.
    """
    conversation, group = _get_group_and_admin_check(conversation_id, current_user, db)

    if user_id == group.admin_id:
        raise HTTPException(status_code=400, detail="Cannot remove the group admin")

    membership = db.query(ConversationMembers).filter(
        ConversationMembers.conversation_id == conversation_id,
        ConversationMembers.user_id == user_id,
    ).first()
    if not membership:
        raise HTTPException(status_code=404, detail="User is not a member of this group")

    db.delete(membership)
    db.commit()
    db.refresh(conversation)
    return _conversation_to_response(conversation, db)
