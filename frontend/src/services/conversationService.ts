/**
 * Conversation Service
 *
 * REST client for the new minimal conversation endpoints
 * (app/routes/conversations.py):
 * - GET  /users/search
 * - POST /conversations/direct
 *
 * Cookie-based auth (same httpOnly access_token cookie as everything else).
 */

import axios from "axios";
import { User, Conversation } from "@/types/protocol";

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
}

function toConversation(data: ConversationApiResponse): Conversation {
  return {
    id: data.id,
    type: data.type,
    name: data.name ?? undefined,
    members: data.members,
    unread_count: 0,
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
};
