"use client";

import { useMessageStore } from "@/store/messageStore";

interface TypingIndicatorProps {
  conversationId: number;
}

/**
 * Typing Indicator
 *
 * Shows which users are currently typing in the conversation.
 * Consumes user_typing events from WebSocket.
 * Auto-clears after 3 seconds of no updates (matches backend debounce).
 */
export function TypingIndicator({ conversationId }: TypingIndicatorProps) {
  const typingUsers = useMessageStore((state) => state.getTypingUsers(conversationId));

  if (typingUsers.length === 0) {
    return null;
  }

  return (
    <div className="text-xs text-gray-500 italic px-4 py-2">
      {typingUsers.length === 1
        ? `${typingUsers[0].user_id} is typing...`
        : `${typingUsers.length} people are typing...`}
    </div>
  );
}
