"use client";

import { Conversation } from "@/types/protocol";
import { useAuthStore } from "@/store/authStore";
import { useMessageStore } from "@/store/messageStore";
import { Avatar, GroupAvatar } from "@/components/Avatar";
import { getConversationDisplayInfo } from "@/lib/conversationDisplay";

interface ChatHeaderProps {
  conversation: Conversation;
}

/** Header shown above the message list: avatar, name, online/member status. */
export function ChatHeader({ conversation }: ChatHeaderProps) {
  const currentUser = useAuthStore((state) => state.user);
  const onlineUsers = useMessageStore((state) => state.onlineUsers);

  const lastSeenMap = useMessageStore((state) => state.lastSeen);

  const { name: displayName, otherMember } = getConversationDisplayInfo(conversation, currentUser?.id);

  // Online status is always about the OTHER member(s), never the current
  // user's own connection (that's shown separately in the sidebar profile).
  const onlineMembers = conversation.members.filter(
    (m) => m.id !== currentUser?.id && onlineUsers.has(m.id)
  );

  let subtitle = "Offline";
  if (conversation.type === "group") {
    subtitle = `${conversation.members.length} members`;
  } else if (onlineMembers.length > 0) {
    subtitle = "Online";
  } else if (otherMember) {
    const lastSeenStr = lastSeenMap[otherMember.id];
    if (lastSeenStr) {
      const date = new Date(lastSeenStr);
      const isToday = new Date().toDateString() === date.toDateString();
      const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      subtitle = isToday ? `Last seen today at ${timeStr}` : `Last seen ${date.toLocaleDateString()} at ${timeStr}`;
    }
  }

  return (
    <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-white">
      <div className="flex items-center gap-3">
        {conversation.type === "group" ? (
          <GroupAvatar size={40} />
        ) : (
          <Avatar
            avatarUrl={otherMember?.avatar_url}
            seed={otherMember?.username || String(conversation.id)}
            size={40}
            online={onlineMembers.length > 0}
          />
        )}
        <div>
          <h2 className="font-semibold text-sm text-gray-900">{displayName}</h2>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
      </div>

      {/* Placeholder controls — not wired to real features yet */}
      <div className="flex items-center gap-1 text-gray-400">
        <button className="p-2 rounded-full hover:bg-gray-100 transition-colors" title="Search" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.85-5.65a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z" />
          </svg>
        </button>
        <button className="p-2 rounded-full hover:bg-gray-100 transition-colors" title="More" disabled>
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M12 8a2 2 0 100-4 2 2 0 000 4zm0 2a2 2 0 100 4 2 2 0 000-4zm0 6a2 2 0 100 4 2 2 0 000-4z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
