"""
WebSocket Connection Manager

Manages active WebSocket connections per user.
- Supports multi-tab: multiple connections per user_id
- Broadcast to user: sends to ALL connections
- Broadcast to conversation members: sends to authorized recipients only
- Connection failure isolation: one closed connection doesn't affect others
"""

from typing import Dict, List, Set
from fastapi import WebSocket
import json


class ConnectionManager:
    """
    Track and manage active WebSocket connections.

    Structure:
      user_id → [WebSocket, WebSocket, ...]

    All connections for a user receive broadcasts (multi-tab support).
    Failures on one connection are isolated (don't affect others).
    """

    def __init__(self):
        # user_id → list of active WebSocket connections
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, user_id: int, websocket: WebSocket):
        """
        Register a new WebSocket connection for a user.

        Args:
            user_id: User ID (from JWT token)
            websocket: FastAPI WebSocket connection

        Note: Same user can have multiple connections (multi-tab).
        """
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []

        self.active_connections[user_id].append(websocket)

    async def disconnect(self, user_id: int, websocket: WebSocket):
        """
        Unregister a WebSocket connection for a user.

        Args:
            user_id: User ID
            websocket: WebSocket connection to remove

        If no other connections remain for this user, clean up the entry.
        """
        if user_id in self.active_connections:
            try:
                self.active_connections[user_id].remove(websocket)
            except ValueError:
                pass  # Already removed

            # Clean up if no connections remain
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]

    def is_user_online(self, user_id: int) -> bool:
        """
        Check if user has any active WebSocket connections.

        Args:
            user_id: User ID to check

        Returns:
            True if user has at least one active connection
        """
        return user_id in self.active_connections and len(self.active_connections[user_id]) > 0

    async def send_to_user(self, user_id: int, message: dict):
        """
        Send message to a single connection (for testing/internal use).

        Args:
            user_id: User ID
            message: Dict to send as JSON

        Silently fails if connection is closed.
        """
        if user_id in self.active_connections:
            if self.active_connections[user_id]:
                try:
                    await self.active_connections[user_id][0].send_json(message)
                except Exception:
                    pass  # Connection closed or failed

    async def broadcast_to_user(self, user_id: int, message: dict):
        """
        Broadcast message to ALL connections for a user (multi-tab support).

        Args:
            user_id: User ID
            message: Dict to send as JSON

        Multi-Tab Behavior:
        - If user has 2 browser tabs open, both receive the message
        - If one connection fails, the other remains open
        - Failures don't propagate (isolated)

        Example:
            await manager.broadcast_to_user(user_id, {
                "type": "message_received",
                "payload": {...}
            })
        """
        if user_id not in self.active_connections:
            return  # User offline

        # Send to all connections; failures are isolated
        failed_connections = []

        for websocket in self.active_connections[user_id]:
            try:
                await websocket.send_json(message)
            except Exception:
                # Mark for cleanup but don't affect other connections
                failed_connections.append(websocket)

        # Remove failed connections
        for websocket in failed_connections:
            try:
                self.active_connections[user_id].remove(websocket)
            except ValueError:
                pass

        # Clean up if all connections failed
        if not self.active_connections[user_id]:
            del self.active_connections[user_id]

    async def broadcast_to_members(
        self,
        conversation_id: int,
        member_ids: List[int],
        message: dict,
        exclude_user_id: int | None = None
    ):
        """
        Broadcast message to specific conversation members (1:1 or group).

        Args:
            conversation_id: Conversation being messaged (for context only)
            member_ids: List of user IDs to send to
            message: Dict to send as JSON
            exclude_user_id: User ID to skip (e.g., sender in typing)

        Authorization:
        - Caller should have validated that member_ids are valid members
        - This method does NOT check authorization; it just sends

        Multi-Tab:
        - Each member can have multiple connections; all receive the message

        Example (broadcast message to conversation members except sender):
            members = [2, 3, 4]  # recipient IDs
            await manager.broadcast_to_members(
                conversation_id=123,
                member_ids=members,
                message={"type": "message_received", "payload": {...}},
                exclude_user_id=1  # sender
            )
        """
        for member_id in member_ids:
            # Skip excluded user (e.g., don't send typing to sender)
            if exclude_user_id and member_id == exclude_user_id:
                continue

            # Send to all connections for this member
            await self.broadcast_to_user(member_id, message)

    async def get_active_users(self) -> Set[int]:
        """
        Get set of all online user IDs.

        Returns:
            Set of user IDs with active connections

        Useful for debugging or analytics.
        """
        return set(self.active_connections.keys())

    def get_connection_count(self, user_id: int) -> int:
        """
        Get number of active connections for a user.

        Args:
            user_id: User ID

        Returns:
            Number of open WebSocket connections (0 if offline)

        Multi-tab example: user with 2 browser tabs → 2
        """
        if user_id not in self.active_connections:
            return 0
        return len(self.active_connections[user_id])
