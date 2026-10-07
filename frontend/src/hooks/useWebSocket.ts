/**
 * useWebSocket Hook
 *
 * Manages WebSocket connection lifecycle and message handling.
 * Integrates with messageStore for state management.
 *
 * Usage:
 *   const { isConnected, sendMessage, sendTyping } = useWebSocket();
 *   sendMessage(conversationId, "Hello", clientId);
 */

import { useEffect, useRef, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  WebSocketClient,
  getWebSocketClient,
  resetWebSocketClient,
} from "@/services/websocketClient";
import { useMessageStore } from "@/store/messageStore";
import {
  WebSocketMessage,
  MessageType,
  MessageAckPayload,
  MessageReceivedPayload,
  ReceiptUpdatePayload,
  UserTypingPayload,
  Message,
  ReceiptStatus,
} from "@/types/protocol";

export function useWebSocket() {
  // IMPORTANT: select individual actions/fields instead of the whole store.
  // Zustand's set() always returns a new top-level state object, even for
  // unrelated field changes. A plain `useMessageStore()` call (no selector)
  // re-renders on every store mutation and returns a new object reference
  // each time — if that object is ever used as a useEffect dependency, the
  // effect calling set() inside itself creates an infinite
  // render -> effect -> set() -> new reference -> render loop. (This was
  // exactly the previous bug here, and it froze the whole tab.)
  // Action functions themselves ARE referentially stable across renders
  // (Zustand only replaces state fields on set(), not the action closures),
  // so selecting them individually gives us stable effect dependencies.
  const setError = useMessageStore((state) => state.setError);
  const setReconnecting = useMessageStore((state) => state.setReconnecting);
  const setConnected = useMessageStore((state) => state.setConnected);
  const addPendingMessages = useMessageStore((state) => state.addPendingMessages);
  const confirmMessage = useMessageStore((state) => state.confirmMessage);
  const addMessage = useMessageStore((state) => state.addMessage);
  const addOptimisticMessage = useMessageStore((state) => state.addOptimisticMessage);
  const updateReceiptTimestamps = useMessageStore((state) => state.updateReceiptTimestamps);
  const setTyping = useMessageStore((state) => state.setTyping);
  const setUserOnline = useMessageStore((state) => state.setUserOnline);
  const setUserOffline = useMessageStore((state) => state.setUserOffline);
  const isConnected = useMessageStore((state) => state.isConnected);
  const reconnecting = useMessageStore((state) => state.reconnecting);
  const error = useMessageStore((state) => state.error);

  const clientRef = useRef<WebSocketClient | null>(null);
  const typingTimeoutsRef = useRef<Record<number, NodeJS.Timeout>>({});

  // Initialize WebSocket connection. Runs exactly once per mount: the
  // dependency array is empty because every value used inside is either a
  // stable Zustand action or a ref — there is nothing that should ever
  // cause this to reconnect on its own. The singleton in websocketClient.ts
  // (plus its own guard against duplicate connects) is what actually keeps
  // "one connection per tab" even across multiple components calling this
  // hook (e.g. every MessageItem's read-observer also uses useWebSocket()).
  useEffect(() => {
    const initializeConnection = async () => {
      try {
        setError(null);
        setReconnecting(true);

        const client = getWebSocketClient({
          onConnected: () => {
            setConnected(true);
            setReconnecting(false);
          },

          onReconnected: (pending) => {
            // Add pending messages grouped by conversation
            if (pending.length > 0) {
              // Group by conversation_id to handle multi-conversation recovery
              const byConversation = new Map<number, Message[]>();

              pending.forEach((pm) => {
                const msg: Message = {
                  id: pm.message_id,
                  conversation_id: pm.conversation_id,
                  sender_id: pm.sender_id,
                  content: pm.content,
                  client_id: "", // Pending messages from backend don't have client_id
                  created_at: pm.created_at,
                  status: pm.status,
                };

                if (!byConversation.has(pm.conversation_id)) {
                  byConversation.set(pm.conversation_id, []);
                }
                byConversation.get(pm.conversation_id)!.push(msg);
              });

              // Add each conversation's messages separately
              byConversation.forEach((messages, convId) => {
                addPendingMessages(convId, messages);
              });
            }
            setConnected(true);
            setReconnecting(false);
          },

          onMessage: (msg) => {
            handleServerMessage(msg);
          },

          onError: (err) => {
            setError(err);
          },

          onClose: () => {
            setConnected(false);
          },
        });

        clientRef.current = client;
        await client.connect();
      } catch (err) {
        const error = err instanceof Error ? err.message : "Connection failed";
        setError(error);
        setReconnecting(false);
      }
    };

    initializeConnection();

    // Cleanup on unmount
    return () => {
      // Don't disconnect on unmount — keep connection alive for multi-tab support
      // Only disconnect when user logs out
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle server messages
  const handleServerMessage = useCallback(
    (message: WebSocketMessage) => {
      switch (message.type) {
        case MessageType.MESSAGE_ACK: {
          const payload = message.payload as MessageAckPayload;
          confirmMessage(payload.client_id, payload.message_id);
          break;
        }

        case MessageType.MESSAGE_RECEIVED: {
          const payload = message.payload as MessageReceivedPayload;
          const msg: Message = {
            id: payload.message_id,
            conversation_id: payload.conversation_id,
            sender_id: payload.sender_id,
            content: payload.content,
            client_id: "",
            created_at: payload.created_at,
            status: payload.status as ReceiptStatus,
          };
          addMessage(msg);

          // Auto-send "delivered" receipt
          if (clientRef.current) {
            clientRef.current.sendReceipt(payload.message_id, "delivered");
          }
          break;
        }

        case MessageType.RECEIPT_UPDATE: {
          const payload = message.payload as ReceiptUpdatePayload;
          updateReceiptTimestamps(
            payload.message_id,
            payload.status as ReceiptStatus,
            payload.delivered_at,
            payload.read_at
          );
          break;
        }

        case MessageType.USER_TYPING: {
          const payload = message.payload as UserTypingPayload;
          setTyping(payload.conversation_id, payload.sender_id, payload.typing);
          break;
        }

        case MessageType.USER_ONLINE: {
          const payload = message.payload as any;
          setUserOnline(payload.user_id);
          break;
        }

        case MessageType.USER_OFFLINE: {
          const payload = message.payload as any;
          setUserOffline(payload.user_id);
          break;
        }
      }
    },
    [confirmMessage, addMessage, updateReceiptTimestamps, setTyping, setUserOnline, setUserOffline]
  );

  // Send message
  const sendMessage = useCallback(
    async (conversationId: number, content: string) => {
      if (!clientRef.current || !clientRef.current.isConnected()) {
        setError("Not connected to server");
        return;
      }

      const clientId = uuidv4();

      // Create optimistic message
      const optimistic: Message = {
        id: 0, // Placeholder, will be replaced on ACK
        conversation_id: conversationId,
        sender_id: 0, // Will be filled from auth store
        content,
        client_id: clientId,
        created_at: new Date().toISOString(),
        status: "pending" as ReceiptStatus,
      };

      addOptimisticMessage(clientId, optimistic);

      try {
        await clientRef.current.sendMessage(conversationId, content, clientId);
      } catch (err) {
        const error = err instanceof Error ? err.message : "Failed to send message";
        setError(error);
      }
    },
    [setError, addOptimisticMessage]
  );

  // Send receipt (mark as read)
  const sendReceipt = useCallback(
    (messageId: number, status: "delivered" | "read") => {
      if (!clientRef.current || !clientRef.current.isConnected()) return;
      clientRef.current.sendReceipt(messageId, status);
    },
    []
  );

  // Send typing indicator (debounced)
  const sendTyping = useCallback(
    (conversationId: number, isTyping: boolean) => {
      if (!clientRef.current || !clientRef.current.isConnected()) return;

      // Clear existing timeout for this conversation
      if (typingTimeoutsRef.current[conversationId]) {
        clearTimeout(typingTimeoutsRef.current[conversationId]);
      }

      clientRef.current.sendTyping(conversationId, isTyping);

      // Auto-stop typing after 3 seconds
      if (isTyping) {
        typingTimeoutsRef.current[conversationId] = setTimeout(() => {
          if (clientRef.current) {
            clientRef.current.sendTyping(conversationId, false);
          }
        }, 3000);
      }
    },
    []
  );

  // Disconnect
  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }

    // Clear typing timeouts
    Object.values(typingTimeoutsRef.current).forEach(clearTimeout);
    typingTimeoutsRef.current = {};

    setConnected(false);
  }, [setConnected]);

  return {
    isConnected,
    reconnecting,
    error,
    sendMessage,
    sendReceipt,
    sendTyping,
    disconnect,
  };
}
