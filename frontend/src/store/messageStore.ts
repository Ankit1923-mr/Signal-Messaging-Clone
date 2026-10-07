/**
 * Message Store (Zustand)
 *
 * Manages:
 * - Messages by conversation
 * - Message receipt status (pending/delivered/read)
 * - Typing indicators
 * - Unread counts
 * - Optimistic updates with client_id tracking
 */

import { create } from "zustand";
import {
  Message,
  Conversation,
  ReceiptStatus,
  MessageReceivedPayload,
  ReceiptUpdatePayload,
} from "@/types/protocol";

// Stable empty-array reference for selectors that need to return "no items
// yet" without allocating a new array on every call (a fresh [] literal on
// each selector invocation breaks useSyncExternalStore's snapshot-stability
// requirement and causes an infinite render loop).
export const EMPTY_MESSAGES: Message[] = [];

export interface TypingUser {
  user_id: number;
  typing: boolean;
  timestamp: number;
}

interface MessageStoreState {
  // Conversations and messages
  conversations: Conversation[];
  messages: Record<number, Message[]>; // conversation_id → messages
  pendingMessages: Record<string, Message>; // client_id → optimistic message

  // Receipt tracking
  receipts: Record<number, ReceiptStatus>; // message_id → status
  unreadCounts: Record<number, number>; // conversation_id → count

  // Typing indicators
  typingUsers: Record<number, TypingUser>; // conversation_id → { user_id, typing, timestamp }

  // Online status
  onlineUsers: Set<number>; // user_id → online status
  lastSeen: Record<number, string>; // user_id → ISO timestamp

  // Connection state
  isConnected: boolean;
  reconnecting: boolean;
  error: string | null;
}

interface MessageStoreActions {
  // Message management
  addMessage: (message: Message) => void;
  addOptimisticMessage: (clientId: string, message: Message) => void;
  confirmMessage: (
    clientId: string,
    messageId: number,
    createdAt?: string,
    replyPreview?: Pick<
      Message,
      "reply_to_message_id" | "reply_to_sender_id" | "reply_to_content" | "reply_to_deleted"
    >
  ) => void;
  getMessages: (conversationId: number) => Message[];

  // Receipt tracking
  updateReceipt: (messageId: number, status: ReceiptStatus) => void;
  updateReceiptTimestamps: (
    messageId: number,
    status: ReceiptStatus,
    deliveredAt?: string,
    readAt?: string
  ) => void;

  // Conversation management
  addConversation: (conversation: Conversation) => void;
  updateUnreadCount: (conversationId: number, count: number) => void;
  markConversationAsRead: (conversationId: number) => void;

  // Typing indicators
  setTyping: (conversationId: number, userId: number, isTyping: boolean) => void;
  getTypingUsers: (conversationId: number) => TypingUser[];

  // Online status
  setUserOnline: (userId: number) => void;
  setUserOffline: (userId: number, timestamp?: string) => void;
  setOnlineUsersSnapshot: (userIds: number[]) => void;
  isUserOnline: (userId: number) => boolean;
  getLastSeen: (userId: number) => string | undefined;

  // Connection state
  setConnected: (connected: boolean) => void;
  setReconnecting: (reconnecting: boolean) => void;
  setError: (error: string | null) => void;

  // Bulk operations
  clearMessages: (conversationId: number) => void;
  addPendingMessages: (conversationId: number, messages: Message[]) => void;
}

const getInitialLastSeen = (): Record<number, string> => {
  if (typeof window === "undefined") return {};
  try {
    const data = localStorage.getItem("lastSeen");
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
};

export const useMessageStore = create<MessageStoreState & MessageStoreActions>(
  (set, get) => ({
    // Initial state
    conversations: [],
    messages: {},
    pendingMessages: {},
    receipts: {},
    unreadCounts: {},
    typingUsers: {},
    onlineUsers: new Set(),
    lastSeen: getInitialLastSeen(),
    isConnected: false,
    reconnecting: false,
    error: null,

    // Add incoming message
    addMessage: (message: Message) => {
      set((state) => {
        const messages = {
          ...state.messages,
          [message.conversation_id]: [
            ...(state.messages[message.conversation_id] || []),
            message,
          ],
        };
        return { messages };
      });
    },

    // Add optimistic message (before ACK)
    addOptimisticMessage: (clientId: string, message: Message) => {
      set((state) => ({
        pendingMessages: { ...state.pendingMessages, [clientId]: message },
      }));

      // Also add to messages array
      get().addMessage(message);
    },

    // Replace optimistic with confirmed message.
    //
    // createdAt (from the server's MESSAGE_ACK payload) replaces the
    // optimistic entry's client-clock `new Date()` timestamp captured at
    // send time. Previously this only patched `id`, so the sender's own
    // message kept showing whatever time the client's local clock said at
    // the moment "Send" was clicked -- forever, even after the real,
    // authoritative, persisted created_at was available. Any client/server
    // clock drift made that timestamp permanently wrong. The recipient's
    // view (MESSAGE_RECEIVED) and the post-refresh history fetch both
    // already used the server's created_at directly; this brings the
    // sender's own live view in line with the same single source of truth.
    confirmMessage: (
      clientId: string,
      messageId: number,
      createdAt?: string,
      replyPreview?: Pick<
        Message,
        "reply_to_message_id" | "reply_to_sender_id" | "reply_to_content" | "reply_to_deleted"
      >
    ) => {
      set((state) => {
        const message = state.pendingMessages[clientId];
        if (!message) return state;

        // Remove from pending
        const { [clientId]: _, ...remaining } = state.pendingMessages;

        // Update message with real ID and (if provided) the server's
        // authoritative created_at, plus the server-confirmed reply
        // preview (replaces the client-side guess computed at send time
        // in useWebSocket.ts's sendMessage, e.g. if the reply target
        // wasn't actually valid and the server dropped it).
        const updated = {
          ...message,
          id: messageId,
          ...(createdAt ? { created_at: createdAt } : {}),
          ...(replyPreview ? replyPreview : {}),
        };

        // Update in messages array
        const messages = { ...state.messages };
        const convMessages = messages[message.conversation_id] || [];
        const index = convMessages.findIndex((m) => m.client_id === clientId);
        if (index !== -1) {
          messages[message.conversation_id] = convMessages.map((m, i) =>
            i === index ? updated : m
          );
        }

        return { pendingMessages: remaining, messages };
      });
    },

    // Get messages for conversation
    getMessages: (conversationId: number) => {
      return get().messages[conversationId] || [];
    },

    // Update receipt status
    updateReceipt: (messageId: number, status: ReceiptStatus) => {
      set((state) => ({
        receipts: { ...state.receipts, [messageId]: status },
      }));

      // Update message status
      set((state) => {
        const messages = { ...state.messages };
        for (const convId in messages) {
          const convMessages = messages[convId];
          const msgIndex = convMessages.findIndex((m) => m.id === messageId);
          if (msgIndex !== -1) {
            messages[convId] = convMessages.map((m, i) =>
              i === msgIndex ? { ...m, status } : m
            );
          }
        }
        return { messages };
      });
    },

    // Update receipt with timestamps
    updateReceiptTimestamps: (
      messageId: number,
      status: ReceiptStatus,
      deliveredAt?: string,
      readAt?: string
    ) => {
      set((state) => {
        const messages = { ...state.messages };
        for (const convId in messages) {
          const convMessages = messages[convId];
          const msgIndex = convMessages.findIndex((m) => m.id === messageId);
          if (msgIndex !== -1) {
            messages[convId] = convMessages.map((m, i) =>
              i === msgIndex
                ? {
                    ...m,
                    status,
                    ...(deliveredAt && { delivered_at: deliveredAt }),
                    ...(readAt && { read_at: readAt }),
                  }
                : m
            );
          }
        }
        return {
          messages,
          receipts: { ...state.receipts, [messageId]: status },
        };
      });
    },

    // Add or refresh a conversation's metadata (members/name/type).
    //
    // Root cause of the "Fresh Rahul" identity bug: this used to no-op
    // ("if (existing) return state") whenever the conversation id was
    // already cached, so a conversation object fetched once (e.g. before
    // this dev session's demo users were finalized, or from an earlier
    // SQLite id-reuse cycle) stayed frozen in memory forever -- no later
    // GET /conversations/{id} or POST /conversations/direct response could
    // ever correct it, even though the backend (source of truth) already
    // had the right members. Upserting here means whichever path calls
    // addConversation always reflects the latest fetched truth.
    addConversation: (conversation: Conversation) => {
      set((state) => {
        const index = state.conversations.findIndex((c) => c.id === conversation.id);
        if (index !== -1) {
          const conversations = [...state.conversations];
          conversations[index] = conversation;
          return { conversations };
        }
        return {
          conversations: [...state.conversations, conversation],
          messages: { ...state.messages, [conversation.id]: state.messages[conversation.id] ?? [] },
        };
      });
    },

    // Update unread count
    updateUnreadCount: (conversationId: number, count: number) => {
      set((state) => ({
        unreadCounts: { ...state.unreadCounts, [conversationId]: count },
      }));
    },

    // Mark conversation as read
    markConversationAsRead: (conversationId: number) => {
      set((state) => ({
        unreadCounts: { ...state.unreadCounts, [conversationId]: 0 },
      }));
    },

    // Set typing indicator
    setTyping: (conversationId: number, userId: number, isTyping: boolean) => {
      set((state) => {
        const typing = { ...state.typingUsers };
        if (isTyping) {
          typing[conversationId] = {
            user_id: userId,
            typing: true,
            timestamp: Date.now(),
          };
        } else if (typing[conversationId]?.user_id === userId) {
          delete typing[conversationId];
        }
        return { typingUsers: typing };
      });
    },

    // Get typing users for conversation
    getTypingUsers: (conversationId: number) => {
      const typing = get().typingUsers[conversationId];
      return typing ? [typing] : [];
    },

    // Set user online
    setUserOnline: (userId: number) => {
      set((state) => {
        const online = new Set(state.onlineUsers);
        online.add(userId);
        return { onlineUsers: online };
      });
    },

    // Set user offline
    setUserOffline: (userId: number, timestamp?: string) => {
      set((state) => {
        const online = new Set(state.onlineUsers);
        online.delete(userId);
        const lastSeen = { ...state.lastSeen };
        if (timestamp) {
          lastSeen[userId] = timestamp;
          if (typeof window !== "undefined") {
            localStorage.setItem("lastSeen", JSON.stringify(lastSeen));
          }
        }
        return { onlineUsers: online, lastSeen };
      });
    },

    // Replaces (not merges) the online set. This is sent as an authoritative
    // snapshot on every CONNECTED/RECONNECTED — it must fully replace the
    // previous set, otherwise a peer who went offline while we were
    // disconnected/reconnecting would incorrectly stay "online" forever
    // (a union-only update never removes anyone). Live USER_ONLINE/
    // USER_OFFLINE events still update it incrementally between snapshots.
    setOnlineUsersSnapshot: (userIds: number[]) => {
      set(() => ({ onlineUsers: new Set(userIds) }));
    },

    // Check if user is online
    isUserOnline: (userId: number) => {
      return get().onlineUsers.has(userId);
    },

    getLastSeen: (userId: number) => {
      return get().lastSeen[userId];
    },

    // Connection state
    setConnected: (connected: boolean) => {
      set({ isConnected: connected });
    },

    setReconnecting: (reconnecting: boolean) => {
      set({ reconnecting });
    },

    setError: (error: string | null) => {
      set({ error });
    },

    // Clear messages for conversation
    clearMessages: (conversationId: number) => {
      set((state) => {
        const messages = { ...state.messages };
        delete messages[conversationId];
        return { messages };
      });
    },

    // Add pending messages (from reconnect).
    //
    // Deduplicates by message id against what's already in the conversation.
    // Root cause this guards against: the backend's RECONNECTED payload
    // re-sends EVERY message whose receipt is still "pending" on every new
    // connection (see MessagingService.get_pending_messages — no time
    // cutoff, by design, for offline recovery). If a message had already
    // reached this client once before (e.g. live via MESSAGE_RECEIVED on an
    // earlier connection, or an earlier reconnect) and, for whatever reason,
    // its receipt never advanced past "pending", the next reconnect would
    // hand back that exact same message again and this previously just
    // appended it unconditionally -- producing two message objects with the
    // same id (and both with client_id: "", since neither payload shape
    // includes client_id for received messages), which is what caused the
    // duplicate React key `${id}-${client_id}` (e.g. "3-").
    addPendingMessages: (conversationId: number, messages: Message[]) => {
      set((state) => {
        const existing = state.messages[conversationId] || [];
        const existingIds = new Set(existing.map((m) => m.id));
        const newMessages = messages.filter((m) => !existingIds.has(m.id));
        if (newMessages.length === 0) return state;
        return {
          messages: {
            ...state.messages,
            [conversationId]: [...existing, ...newMessages],
          },
        };
      });
    },
  })
);
