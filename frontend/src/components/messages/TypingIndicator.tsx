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
  // Select the raw stored value directly rather than state.getTypingUsers(id),
  // which allocated a brand-new array on every call/render. useSyncExternalStore
  // (what Zustand's hook is built on) requires the selector to return a
  // referentially stable snapshot when nothing changed — an always-new array
  // reference caused "getSnapshot should be cached" / an infinite render loop.
  // typingUsers[conversationId] itself only changes reference when set()
  // actually updates it, so this is stable across unrelated re-renders.
  const typing = useMessageStore((state) => state.typingUsers[conversationId]);

  if (!typing) {
    return null;
  }

  return (
    <div className="flex-shrink-0 text-xs text-gray-500 italic px-4 py-2">
      {typing.user_id} is typing...
    </div>
  );
}
