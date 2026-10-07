"use client";

import { useCallback, useEffect, useState } from "react";
import { useMessageStore } from "@/store/messageStore";
import { useAuthStore } from "@/store/authStore";
import { getBroadcastService } from "@/services/broadcastService";
import { Conversation } from "@/types/protocol";

/**
 * useConversations Hook
 *
 * Manages conversation-level state:
 * - Add/update conversations
 * - Track active conversation
 * - Update unread counts
 * - Handle conversation selection
 *
 * Separates conversation state from message state for cleaner updates.
 */
export function useConversations() {
  // TEMPORARY DEBUG: remove once the freeze/no-response bugfix is confirmed.
  console.count("useConversations render");

  const [activeConversationId, setActiveConversationId] = useState<
    number | null
  >(null);

  const user = useAuthStore((state) => state.user);
  const conversations = useMessageStore((state) => state.conversations);
  const messages = useMessageStore((state) => state.messages);
  const unreadCounts = useMessageStore((state) => state.unreadCounts);

  const addConversation = useMessageStore((state) => state.addConversation);
  const markConversationAsRead = useMessageStore(
    (state) => state.markConversationAsRead
  );
  const updateUnreadCount = useMessageStore(
    (state) => state.updateUnreadCount
  );

  // Select conversation and mark as read
  const selectConversation = useCallback(
    (conversationId: number) => {
      setActiveConversationId(conversationId);
      markConversationAsRead(conversationId);
      // Broadcast to other tabs
      getBroadcastService().broadcastConversationSelected(conversationId);
    },
    [markConversationAsRead]
  );

  // Update unread counts when messages change
  useEffect(() => {
    if (!user) return;

    conversations.forEach((conversation) => {
      const conversationMessages = messages[conversation.id] || [];

      // Count unread messages from OTHER users (not sender's own messages)
      // Unread = status is not "read" AND sender is not the current user
      const unreadMessages = conversationMessages.filter(
        (msg) => msg.status !== "read" && msg.sender_id !== user.id
      );

      const count = unreadMessages.length;
      const current = unreadCounts[conversation.id] || 0;

      // Only update if changed to avoid unnecessary re-renders
      if (count !== current) {
        updateUnreadCount(conversation.id, count);
      }
    });
  }, [conversations, messages, unreadCounts, updateUnreadCount, user]);

  // Auto-select first conversation if none selected
  useEffect(() => {
    if (!activeConversationId && conversations.length > 0) {
      setActiveConversationId(conversations[0].id);
    }
  }, [activeConversationId, conversations]);

  // Subscribe to broadcast messages from other tabs
  useEffect(() => {
    const broadcastService = getBroadcastService();

    const handler = (message: any) => {
      if (message.type === "conversation-selected") {
        setActiveConversationId(message.conversationId);
      } else if (message.type === "conversation-read") {
        markConversationAsRead(message.conversationId);
      }
    };

    broadcastService.subscribe(handler);

    return () => {
      broadcastService.unsubscribe(handler);
    };
  }, [markConversationAsRead]);

  return {
    activeConversationId,
    conversations,
    selectConversation,
    unreadCounts,
  };
}
