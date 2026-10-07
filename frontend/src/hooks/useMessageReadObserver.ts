"use client";

import { useEffect, useRef } from "react";
import { useWebSocket } from "./useWebSocket";
import { useMessageStore } from "@/store/messageStore";
import { useAuthStore } from "@/store/authStore";

/**
 * useMessageReadObserver Hook
 *
 * Marks incoming messages as read when they become visible using IntersectionObserver.
 * Prevents duplicate receipt requests for already-read messages.
 *
 * Usage:
 *   const messageRef = useMessageReadObserver(messageId, conversationId);
 *   <div ref={messageRef}>Message content</div>
 */

export function useMessageReadObserver(
  messageId: number,
  conversationId: number
) {
  const { sendReceipt } = useWebSocket();
  const user = useAuthStore((state) => state.user);
  const messages = useMessageStore((state) => state.messages);
  const observedRef = useRef<Set<number>>(new Set());
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Skip if already marked as read or if we're the sender
    const message = messages[conversationId]?.find((m) => m.id === messageId);
    if (!message || message.status === "read" || message.sender_id === user?.id) {
      return;
    }

    // Skip if already observed in this session
    if (observedRef.current.has(messageId)) {
      return;
    }

    // Create intersection observer
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !observedRef.current.has(messageId)) {
            // Message is visible
            observedRef.current.add(messageId);
            // Send read receipt
            sendReceipt(messageId, "read");
            // Stop observing
            observer.disconnect();
          }
        });
      },
      {
        threshold: 0.5, // At least 50% visible
        rootMargin: "0px",
      }
    );

    if (elementRef.current) {
      observer.observe(elementRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [messageId, conversationId, sendReceipt, user?.id, messages]);

  return elementRef;
}
