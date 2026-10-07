/**
 * WebSocket Protocol Types
 *
 * Mirrors Component 3 backend protocol exactly.
 * Single source of truth for message envelope and payload structures.
 *
 * Reference: backend/app/ws_protocol.py
 *
 * Authentication:
 * - Connect to: ws://localhost:8000/ws/messages
 * - Browser automatically sends httpOnly access_token cookie
 * - No query parameters needed
 */

// ============================================================================
// MESSAGE ENVELOPE
// ============================================================================

export interface WebSocketMessage<T = any> {
  type: MessageType;
  payload?: T;
}

// ============================================================================
// MESSAGE TYPES
// ============================================================================

export enum MessageType {
  // Client → Server: Send message
  SEND_MESSAGE = "send_message",

  // Server → Client: Acknowledge message received from client
  MESSAGE_ACK = "message_ack",

  // Server → Client: Incoming message from another user
  MESSAGE_RECEIVED = "message_received",

  // Client → Server: Update receipt status (delivered/read)
  RECEIPT = "receipt",

  // Server → Client: Receipt status changed by recipient
  RECEIPT_UPDATE = "receipt_update",

  // Client → Server: User is typing
  TYPING = "typing",

  // Server → Client: Another user is typing
  USER_TYPING = "user_typing",

  // Server → Client: User came online
  USER_ONLINE = "user_online",

  // Server → Client: User went offline
  USER_OFFLINE = "user_offline",

  // Server → Client: Connection established
  CONNECTED = "connected",

  // Server → Client: Reconnection with pending messages
  RECONNECTED = "reconnected",

  // Server → Client: Error occurred
  ERROR = "error",

  // Server → Client: Ping (heartbeat)
  PING = "ping",

  // Client → Server: Pong (heartbeat response)
  PONG = "pong",
}

export enum ReceiptStatus {
  PENDING = "pending",
  DELIVERED = "delivered",
  READ = "read",
}

// ============================================================================
// PAYLOAD TYPES
// ============================================================================

export interface SendMessagePayload {
  conversation_id: number;
  client_id: string; // UUID for idempotency
  content: string; // 1-4000 characters
  reply_to_message_id?: number; // optional: id of the message this one replies to
}

/** Denormalized reply-preview fields, present on every message payload shape
 * (ACK/RECEIVED/PendingMessage/history) so a reply renders correctly even
 * when the original message isn't in this client's local store. */
export interface ReplyPreviewFields {
  reply_to_message_id?: number | null;
  reply_to_sender_id?: number | null;
  reply_to_content?: string | null;
  reply_to_deleted?: boolean;
}

export interface MessageAckPayload extends ReplyPreviewFields {
  message_id: number;
  client_id: string;
  created_at: string; // ISO 8601
  status: ReceiptStatus;
}

export interface MessageReceivedPayload extends ReplyPreviewFields {
  message_id: number;
  conversation_id: number;
  sender_id: number;
  content: string;
  created_at: string; // ISO 8601
  status: ReceiptStatus;
}

export interface ReceiptPayload {
  message_id: number;
  status: "delivered" | "read";
}

export interface ReceiptUpdatePayload {
  message_id: number;
  status: ReceiptStatus;
  delivered_at?: string; // ISO 8601
  read_at?: string; // ISO 8601
}

export interface TypingPayload {
  conversation_id: number;
  typing: boolean;
}

export interface UserTypingPayload {
  conversation_id: number;
  sender_id: number;
  typing: boolean;
}

export interface UserOnlinePayload {
  user_id: number;
  timestamp: string; // ISO 8601
}

export interface UserOfflinePayload {
  user_id: number;
  timestamp: string; // ISO 8601
}

export interface ConnectedPayload {
  user_id: number;
  timestamp: string; // ISO 8601
}

export interface PendingMessage extends ReplyPreviewFields {
  message_id: number;
  sender_id: number;
  conversation_id: number;
  content: string;
  created_at: string; // ISO 8601
  status: ReceiptStatus;
}

export interface ReconnectedPayload {
  pending_messages: PendingMessage[];
  timestamp: string; // ISO 8601
}

export interface WebSocketErrorPayload {
  code: string; // e.g., "INVALID_MESSAGE", "NOT_MEMBER"
  message: string;
  client_id?: string; // Optional, for matching to request
}

// ============================================================================
// APPLICATION DOMAIN TYPES
// ============================================================================

export interface Message extends ReplyPreviewFields {
  id: number;
  conversation_id: number;
  sender_id: number;
  content: string;
  client_id: string; // For optimistic updates
  created_at: string;
  status: ReceiptStatus; // Current user's receipt status
  delivered_at?: string;
  read_at?: string;
}

export interface User {
  id: number;
  username: string;
  display_name: string;
  email?: string;
  phone_number?: string;
  avatar_url?: string;
}

export interface Conversation {
  id: number;
  type: "direct" | "group";
  name?: string;
  members: User[];
  last_message?: Message;
  unread_count: number;
  /** Set for groups only (the admin's user id); undefined for direct conversations. */
  admin_id?: number;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface WebSocketState {
  isConnected: boolean;
  isReconnecting: boolean;
  pendingMessages: Message[];
  error: string | null;
}
