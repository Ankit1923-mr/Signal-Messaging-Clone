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

  // Connection state
  isConnected: boolean;
  reconnecting: boolean;
  error: string | null;
}

interface MessageStoreActions {
  // Message management
  addMessage: (message: Message) => void;
  addOptimisticMessage: (clientId: string, message: Message) => void;
  confirmMessage: (clientId: string, messageId: number) => void;
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
  setUserOffline: (userId: number) => void;
  isUserOnline: (userId: number) => boolean;

  // Connection state
  setConnected: (connected: boolean) => void;
  setReconnecting: (reconnecting: boolean) => void;
  setError: (error: string | null) => void;

  // Bulk operations
  clearMessages: (conversationId: number) => void;
  addPendingMessages: (conversationId: number, messages: Message[]) => void;
}

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

    // Replace optimistic with confirmed message
    confirmMessage: (clientId: string, messageId: number) => {
      set((state) => {
        const message = state.pendingMessages[clientId];
        if (!message) return state;

        // Remove from pending
        const { [clientId]: _, ...remaining } = state.pendingMessages;

        // Update message with real ID
        const updated = { ...message, id: messageId };

        // Update in messages array
        const messages = { ...state.messages };
        const convMessages = messages[message.conversation_id] || [];
        const index = convMessages.findIndex((m) => m.client_id === clientId);
        if (index !== -1) {
          convMessages[index] = updated;
          messages[message.conversation_id] = [...convMessages];
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
            const updated = { ...convMessages[msgIndex], status };
            convMessages[msgIndex] = updated;
            messages[convId] = [...convMessages];
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
            const updated = {
              ...convMessages[msgIndex],
              status,
              ...(deliveredAt && { delivered_at: deliveredAt }),
              ...(readAt && { read_at: readAt }),
            };
            convMessages[msgIndex] = updated;
            messages[convId] = [...convMessages];
          }
        }
        return {
          messages,
          receipts: { ...state.receipts, [messageId]: status },
        };
      });
    },

    // Add conversation
    addConversation: (conversation: Conversation) => {
      set((state) => {
        const existing = state.conversations.find((c) => c.id === conversation.id);
        if (existing) return state;
        return {
          conversations: [...state.conversations, conversation],
          messages: { ...state.messages, [conversation.id]: [] },
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
    setUserOffline: (userId: number) => {
      set((state) => {
        const online = new Set(state.onlineUsers);
        online.delete(userId);
        return { onlineUsers: online };
      });
    },

    // Check if user is online
    isUserOnline: (userId: number) => {
      return get().onlineUsers.has(userId);
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

    // Add pending messages (from reconnect)
    addPendingMessages: (conversationId: number, messages: Message[]) => {
      set((state) => ({
        messages: {
          ...state.messages,
          [conversationId]: [...(state.messages[conversationId] || []), ...messages],
        },
      }));
    },
  })
);
