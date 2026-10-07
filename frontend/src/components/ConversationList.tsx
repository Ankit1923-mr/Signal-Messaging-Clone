"use client";

import { useMessageStore } from "@/store/messageStore";
import { useAuthStore } from "@/store/authStore";
import { Conversation } from "@/types/protocol";
import { Avatar, GroupAvatar } from "@/components/Avatar";
import { getConversationDisplayInfo } from "@/lib/conversationDisplay";

interface ConversationListProps {
  activeConversationId?: number;
  onSelectConversation: (conversationId: number) => void;
  /** Client-side filter by conversation/other-member display name. */
  searchQuery?: string;
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
  searchQuery,
}: ConversationListProps) {
  const conversations = useMessageStore((state) => state.conversations);
  const unreadCounts = useMessageStore((state) => state.unreadCounts);
  const messages = useMessageStore((state) => state.messages);
  const onlineUsers = useMessageStore((state) => state.onlineUsers);
  const currentUser = useAuthStore((state) => state.user);

  // Filter by search query (matches conversation name or the other member's name)
  const query = searchQuery?.trim().toLowerCase();
  const filteredConversations = !query
    ? conversations
    : conversations.filter((conversation) => {
        const info = getConversationDisplayInfo(conversation, currentUser?.id);
        return (
          info.name.toLowerCase().includes(query) ||
          (info.username || "").toLowerCase().includes(query)
        );
      });

  // Sort conversations by latest activity
  const sortedConversations = [...filteredConversations].sort((a, b) => {
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
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-3">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-gray-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-600">No conversations yet</p>
        <p className="text-xs text-gray-400 mt-1">Start a new conversation to begin messaging</p>
      </div>
    );
  }

  if (filteredConversations.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400 px-6 py-12 text-center">
        No conversations match &quot;{searchQuery}&quot;
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {sortedConversations.map((conversation) => {
        const isActive = conversation.id === activeConversationId;
        const unreadCount = unreadCounts[conversation.id] || 0;
        const conversationMessages = messages[conversation.id] || [];
        const lastMessage = conversationMessages[conversationMessages.length - 1];

        const { name: displayName, otherMember } = getConversationDisplayInfo(
          conversation,
          currentUser?.id
        );

        // Online status is about the OTHER member(s), never the current user.
        const onlineMembers = conversation.members.filter(
          (m) => m.id !== currentUser?.id && onlineUsers.has(m.id)
        );
        const hasOnlineMembers = onlineMembers.length > 0;

        return (
          <button
            key={conversation.id}
            onClick={() => onSelectConversation(conversation.id)}
            className={`w-full px-3 py-3 text-left transition-colors border-b border-gray-100 hover:bg-gray-50 ${
              isActive ? "bg-blue-50" : ""
            }`}
          >
            <div className="flex items-center gap-3">
              {conversation.type === "group" ? (
                <GroupAvatar size={48} />
              ) : (
                <Avatar
                  avatarUrl={otherMember?.avatar_url}
                  seed={otherMember?.username || String(conversation.id)}
                  size={48}
                  online={hasOnlineMembers}
                />
              )}

              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline gap-2">
                  <h3 className="font-semibold text-sm text-gray-900 truncate">
                    {displayName}
                  </h3>
                  {lastMessage && (
                    <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                      {formatRelativeTime(lastMessage.created_at)}
                    </span>
                  )}
                </div>
                <div className="flex justify-between items-center gap-2 mt-0.5">
                  <p className="text-sm text-gray-500 truncate">
                    {lastMessage ? lastMessage.content.substring(0, 50) : "No messages yet"}
                  </p>
                  {unreadCount > 0 && (
                    <span className="bg-blue-600 text-white text-xs font-semibold rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center flex-shrink-0">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </div>
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
