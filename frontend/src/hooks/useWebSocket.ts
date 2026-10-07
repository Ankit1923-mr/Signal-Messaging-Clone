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
  const messageStore = useMessageStore();
  const clientRef = useRef<WebSocketClient | null>(null);
  const typingTimeoutsRef = useRef<Record<number, NodeJS.Timeout>>({});

  // Initialize WebSocket connection
  useEffect(() => {
    const initializeConnection = async () => {
      try {
        messageStore.setError(null);
        messageStore.setReconnecting(true);

        const client = getWebSocketClient({
          onConnected: () => {
            messageStore.setConnected(true);
            messageStore.setReconnecting(false);
          },

          onReconnected: (pending) => {
            // Add pending messages to store
            if (pending.length > 0) {
              const convId = pending[0].conversation_id;
              // Convert PendingMessage to Message format
              const messages: Message[] = pending.map((pm) => ({
                id: pm.message_id,
                conversation_id: pm.conversation_id,
                sender_id: pm.sender_id,
                content: pm.content,
                client_id: "", // Pending messages from backend don't have client_id
                created_at: pm.created_at,
                status: pm.status,
              }));
              messageStore.addPendingMessages(convId, messages);
            }
            messageStore.setConnected(true);
            messageStore.setReconnecting(false);
          },

          onMessage: (msg) => {
            handleServerMessage(msg);
          },

          onError: (error) => {
            messageStore.setError(error);
          },

          onClose: () => {
            messageStore.setConnected(false);
          },
        });

        clientRef.current = client;
        await client.connect();
      } catch (err) {
        const error = err instanceof Error ? err.message : "Connection failed";
        messageStore.setError(error);
        messageStore.setReconnecting(false);
      }
    };

    initializeConnection();

    // Cleanup on unmount
    return () => {
      // Don't disconnect on unmount — keep connection alive for multi-tab support
      // Only disconnect when user logs out
    };
  }, [messageStore]);

  // Handle server messages
  const handleServerMessage = useCallback(
    (message: WebSocketMessage) => {
      switch (message.type) {
        case MessageType.MESSAGE_ACK: {
          const payload = message.payload as MessageAckPayload;
          messageStore.confirmMessage(payload.client_id, payload.message_id);
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
          messageStore.addMessage(msg);

          // Auto-send "delivered" receipt
          if (clientRef.current) {
            clientRef.current.sendReceipt(payload.message_id, "delivered");
          }
          break;
        }

        case MessageType.RECEIPT_UPDATE: {
          const payload = message.payload as ReceiptUpdatePayload;
          messageStore.updateReceiptTimestamps(
            payload.message_id,
            payload.status as ReceiptStatus,
            payload.delivered_at,
            payload.read_at
          );
          break;
        }

        case MessageType.USER_TYPING: {
          const payload = message.payload as UserTypingPayload;
          // TODO: Implement typing UI
          // For now, just track in store
          if (payload.typing) {
            // Show typing indicator
          } else {
            // Hide typing indicator
          }
          break;
        }
      }
    },
    [messageStore]
  );

  // Send message
  const sendMessage = useCallback(
    async (conversationId: number, content: string) => {
      if (!clientRef.current || !clientRef.current.isConnected()) {
        messageStore.setError("Not connected to server");
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

      messageStore.addOptimisticMessage(clientId, optimistic);

      try {
        await clientRef.current.sendMessage(conversationId, content, clientId);
      } catch (err) {
        const error = err instanceof Error ? err.message : "Failed to send message";
        messageStore.setError(error);
      }
    },
    [messageStore]
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

    messageStore.setConnected(false);
  }, [messageStore]);

  return {
    isConnected: messageStore.isConnected,
    reconnecting: messageStore.reconnecting,
    error: messageStore.error,
    sendMessage,
    sendReceipt,
    sendTyping,
    disconnect,
  };
}
