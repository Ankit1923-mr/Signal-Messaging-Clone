/**
 * Single source of truth for "what do we call this conversation / whose
 * avatar do we show" across ChatHeader, ConversationList, and anywhere else
 * that needs it. Previously ChatHeader.tsx and ConversationList.tsx each
 * had their own inline copy of this lookup.
 */

import { Conversation, User } from "@/types/protocol";

export interface ConversationDisplayInfo {
  name: string;
  username?: string;
  avatarUrl?: string;
  /** The other member in a direct conversation; undefined for groups. */
  otherMember?: User;
}

export function getConversationDisplayInfo(
  conversation: Conversation,
  currentUserId?: number
): ConversationDisplayInfo {
  if (conversation.type === "group") {
    return {
      name: conversation.name || "Unnamed Group",
    };
  }

  const otherMember = conversation.members.find((member) => member.id !== currentUserId);

  return {
    name: conversation.name || otherMember?.display_name || otherMember?.username || "Unknown user",
    username: otherMember?.username,
    avatarUrl: otherMember?.avatar_url,
    otherMember,
  };
}
