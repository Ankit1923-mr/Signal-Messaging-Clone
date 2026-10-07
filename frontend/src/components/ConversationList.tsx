"use client";

import { useMessageStore } from "@/store/messageStore";
import { Conversation } from "@/types/protocol";

interface ConversationListProps {
  activeConversationId?: number;
  onSelectConversation: (conversationId: number) => void;
}

/**
 * Conversation List
 *
 * Shows conversations ordered by latest activity.
 * Displays:
 * - Conversation name
 * - Last message preview
 * - Timestamp
 * - Unread count badge
 * - Active conversation highlighting
 */
export function ConversationList({
  activeConversationId,
  onSelectConversation,
}: ConversationListProps) {
  const conversations = useMessageStore((state) => state.conversations);
  const unreadCounts = useMessageStore((state) => state.unreadCounts);
  const messages = useMessageStore((state) => state.messages);

  // Sort conversations by latest activity
  const sortedConversations = [...conversations].sort((a, b) => {
    const aMessages = messages[a.id] || [];
    const bMessages = messages[b.id] || [];

    const aLatest = aMessages[aMessages.length - 1];
    const bLatest = bMessages[bMessages.length - 1];

    if (!aLatest && !bLatest) return 0;
    if (!aLatest) return 1;
    if (!bLatest) return -1;

    return (
      new Date(bLatest.created_at).getTime() -
      new Date(aLatest.created_at).getTime()
    );
  });

  if (conversations.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        <p>No conversations yet</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-1">
      {sortedConversations.map((conversation) => {
        const isActive = conversation.id === activeConversationId;
        const unreadCount = unreadCounts[conversation.id] || 0;
        const conversationMessages = messages[conversation.id] || [];
        const lastMessage = conversationMessages[conversationMessages.length - 1];

        return (
          <button
            key={conversation.id}
            onClick={() => onSelectConversation(conversation.id)}
            className={`w-full px-4 py-3 text-left transition-colors hover:bg-gray-100 ${
              isActive ? "bg-blue-50 border-l-4 border-blue-600" : ""
            }`}
          >
            <div className="flex justify-between items-start gap-2">
              {/* Conversation name and preview */}
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm text-gray-900 truncate">
                  {conversation.name || "Unnamed Conversation"}
                </h3>
                {lastMessage && (
                  <p className="text-xs text-gray-500 truncate">
                    {lastMessage.content.substring(0, 50)}
                  </p>
                )}
              </div>

              {/* Unread badge and timestamp */}
              <div className="flex items-center gap-2">
                {lastMessage && (
                  <span className="text-xs text-gray-400 whitespace-nowrap">
                    {formatRelativeTime(lastMessage.created_at)}
                  </span>
                )}

                {unreadCount > 0 && (
                  <span className="bg-blue-600 text-white text-xs font-semibold rounded-full w-5 h-5 flex items-center justify-center">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Format timestamp as relative time (e.g., "2m ago", "1h ago", "Today", "Yesterday")
 */
function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) return "now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;

    // Check if it's today or yesterday
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (msgDate.getTime() === today.getTime()) return "Today";
    if (msgDate.getTime() === yesterday.getTime()) return "Yesterday";

    // Otherwise return date
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
