"""
Conversation and user-search endpoints.

Minimal REST surface needed for the frontend's "+ New Conversation" flow:
- GET  /users/search              Find a user to start a direct conversation with
- POST /conversations/direct      Find-or-create a 1:1 conversation (idempotent)
- GET  /conversations/{id}        Fetch conversation metadata (members etc.)
                                   for a conversation the caller didn't
                                   initiate -- needed so the RECIPIENT of a
                                   brand-new conversation's first message can
                                   learn who it's with (see useWebSocket.ts's
                                   MESSAGE_RECEIVED handler).

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
from app.models import Conversation, ConversationMembers, User
from app.schemas import ConversationResponse, CreateDirectConversationRequest, UserResponse

router = APIRouter(tags=["conversations"])


def _pair_key(user_a: int, user_b: int) -> str:
    """Deterministic key for a pair of user ids, e.g. "3:7" (lower id first)."""
    lo, hi = sorted((user_a, user_b))
    return f"{lo}:{hi}"


def _conversation_to_response(conversation: Conversation, db: Session) -> ConversationResponse:
    member_ids = [m.user_id for m in conversation.members]
    members = db.query(User).filter(User.id.in_(member_ids)).all()
    return ConversationResponse(
        id=conversation.id,
        type=conversation.type,
        name=conversation.name,
        members=[UserResponse.model_validate(m) for m in members],
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
