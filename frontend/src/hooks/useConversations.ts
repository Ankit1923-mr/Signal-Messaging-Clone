"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMessageStore } from "@/store/messageStore";
import { useAuthStore } from "@/store/authStore";
import { getBroadcastService } from "@/services/broadcastService";
import { conversationService } from "@/services/conversationService";
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
  const [activeConversationId, setActiveConversationId] = useState<
    number | null
  >(null);

  const user = useAuthStore((state) => state.user);
  const conversations = useMessageStore((state) => state.conversations);
  const messages = useMessageStore((state) => state.messages);
  const unreadCounts = useMessageStore((state) => state.unreadCounts);

  const addConversation = useMessageStore((state) => state.addConversation);
  const addPendingMessages = useMessageStore((state) => state.addPendingMessages);
  const markConversationAsRead = useMessageStore(
    (state) => state.markConversationAsRead
  );
  const updateUnreadCount = useMessageStore(
    (state) => state.updateUnreadCount
  );

  // Hydrate conversations (and each one's message history) from the backend
  // on initial load. The database is the source of truth: previously,
  // nothing ever fetched this — Zustand's in-memory store only ever got
  // populated by live events (creating a conversation, or receiving a
  // message for an unknown one), so a page refresh reset it to empty and
  // the whole conversation list silently disappeared even though the data
  // was still sitting in the database the whole time. Guarded by a ref
  // (not state) so this runs exactly once per mount, not on every render.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!user || hydratedRef.current) return;
    hydratedRef.current = true;

    conversationService
      .listConversations()
      .then(async (fetchedConversations) => {
        fetchedConversations.forEach((conversation) => addConversation(conversation));

        // Fetch each conversation's persisted message history too, so the
        // last-message preview, unread counts, and the open chat view are
        // all populated from real data after a refresh instead of only
        // "No messages yet". addPendingMessages already dedupes by message
        // id, so this is safe even if some messages already arrived live
        // before this fetch resolves.
        await Promise.all(
          fetchedConversations.map((conversation) =>
            conversationService
              .getMessages(conversation.id)
              .then((history) => addPendingMessages(conversation.id, history))
              .catch(() => {
                // Non-fatal: the conversation still shows up, just without
                // history until next refresh/reconnect.
              })
          )
        );
      })
      .catch(() => {
        // Non-fatal: conversation list just stays empty until next refresh;
        // live events (Add Contact, incoming messages) still work normally.
      });
  }, [user, addConversation, addPendingMessages]);

  // Select conversation and mark as read
  const selectConversation = useCallback(
    (conversationId: number) => {
      setActiveConversationId(conversationId);
      markConversationAsRead(conversationId);
      // Broadcast to other tabs
      getBroadcastService().broadcastConversationSelected(conversationId);

      // Request notification permission
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
      }
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
