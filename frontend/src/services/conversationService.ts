/**
 * Conversation Service
 *
 * REST client for the conversation endpoints (app/routes/conversations.py):
 * - GET  /users/search
 * - GET  /conversations                       list the current user's conversations
 * - POST /conversations/direct
 * - GET  /conversations/{id}
 * - GET  /conversations/{id}/messages          persisted message history
 * - POST /conversations/group                  create a group conversation
 * - POST /conversations/{id}/members            admin-only: add a group member
 * - DELETE /conversations/{id}/members/{uid}    admin-only: remove a group member
 *
 * Cookie-based auth (same httpOnly access_token cookie as everything else).
 */

import axios from "axios";
import { User, Conversation, Message, ReceiptStatus } from "@/types/protocol";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const apiClient = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

interface ConversationApiResponse {
  id: number;
  type: "direct" | "group";
  name: string | null;
  members: User[];
  admin_id: number | null;
}

interface MessageHistoryApiResponse {
  id: number;
  conversation_id: number;
  sender_id: number;
  client_id: string;
  content: string;
  created_at: string;
  status: string;
}

function toConversation(data: ConversationApiResponse): Conversation {
  return {
    id: data.id,
    type: data.type,
    name: data.name ?? undefined,
    members: data.members,
    unread_count: 0,
    admin_id: data.admin_id ?? undefined,
  };
}

function toMessage(data: MessageHistoryApiResponse): Message {
  return {
    id: data.id,
    conversation_id: data.conversation_id,
    sender_id: data.sender_id,
    content: data.content,
    client_id: data.client_id,
    created_at: data.created_at,
    status: data.status as ReceiptStatus,
  };
}

export const conversationService = {
  /** Search for a user to start a conversation with (excludes self). */
  async searchUsers(query: string): Promise<User[]> {
    const response = await apiClient.get<User[]>("/users/search", {
      params: { q: query },
    });
    return response.data;
  },

  /**
   * List every conversation the current user is a member of. This is the
   * source-of-truth hydration call on page load/refresh — the database,
   * not localStorage or Zustand, is authoritative for which conversations
   * exist.
   */
  async listConversations(): Promise<Conversation[]> {
    const response = await apiClient.get<ConversationApiResponse[]>("/conversations");
    return response.data.map(toConversation);
  },

  /** Find or create the direct conversation with otherUserId. Idempotent. */
  async createDirectConversation(otherUserId: number): Promise<Conversation> {
    const response = await apiClient.post<ConversationApiResponse>("/conversations/direct", {
      other_user_id: otherUserId,
    });
    return toConversation(response.data);
  },

  /**
   * Fetch metadata for a conversation by id. Used when a MESSAGE_RECEIVED
   * event references a conversation_id the recipient doesn't know about yet
   * (they never called createDirectConversation themselves).
   */
  async getConversation(conversationId: number): Promise<Conversation> {
    const response = await apiClient.get<ConversationApiResponse>(`/conversations/${conversationId}`);
    return toConversation(response.data);
  },

  /** Fetch persisted message history for a conversation (oldest first). */
  async getMessages(conversationId: number): Promise<Message[]> {
    const response = await apiClient.get<MessageHistoryApiResponse[]>(
      `/conversations/${conversationId}/messages`
    );
    return response.data.map(toMessage);
  },

  /** Create a new group conversation. The caller becomes the group's admin. */
  async createGroupConversation(name: string, memberIds: number[]): Promise<Conversation> {
    const response = await apiClient.post<ConversationApiResponse>("/conversations/group", {
      name,
      member_ids: memberIds,
    });
    return toConversation(response.data);
  },

  /** Admin-only: add a member to a group. Returns the updated conversation. */
  async addGroupMember(conversationId: number, userId: number): Promise<Conversation> {
    const response = await apiClient.post<ConversationApiResponse>(
      `/conversations/${conversationId}/members`,
      { user_id: userId }
    );
    return toConversation(response.data);
  },

  /** Admin-only: remove a member from a group. Returns the updated conversation. */
  async removeGroupMember(conversationId: number, userId: number): Promise<Conversation> {
    const response = await apiClient.delete<ConversationApiResponse>(
      `/conversations/${conversationId}/members/${userId}`
    );
    return toConversation(response.data);
  },
};
