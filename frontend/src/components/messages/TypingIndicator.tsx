"use client";

import { useMessageStore } from "@/store/messageStore";
import { Conversation } from "@/types/protocol";

interface TypingIndicatorProps {
  conversationId: number;
  /** Needed to resolve the typing user_id to a display name — see below. */
  conversation?: Conversation;
}

/**
 * Typing Indicator
 *
 * Shows which users are currently typing in the conversation, by name —
 * never the raw numeric user_id. Consumes user_typing events from
 * WebSocket (which only carries {conversation_id, sender_id, typing}; no
 * protocol change was needed — the display name is resolved from the
 * conversation's already-loaded `members` list).
 * Auto-clears after 3 seconds of no updates (matches backend debounce).
 */
export function TypingIndicator({ conversationId, conversation }: TypingIndicatorProps) {
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

  const typingMember = conversation?.members.find((m) => m.id === typing.user_id);
  const name = typingMember?.display_name || typingMember?.username || "Someone";

  return (
    <div className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400 italic px-4 py-2">
      {name} is typing...
    </div>
  );
}
