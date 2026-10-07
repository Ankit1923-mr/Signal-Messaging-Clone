"use client";

import { useEffect, useRef, useState } from "react";
import { useMessageStore, EMPTY_MESSAGES } from "@/store/messageStore";
import { useAuthStore } from "@/store/authStore";
import { Message } from "@/types/protocol";
import { MessageItem } from "./MessageItem";

interface MessageListProps {
  conversationId: number;
  /** Called when the user clicks "Reply" on a message (see MessageItem). */
  onReply?: (message: Message) => void;
}

export function MessageList({ conversationId, onReply }: MessageListProps) {
  // Select the raw stored array directly (with a stable empty-array
  // fallback) rather than state.getMessages(id), which allocated a new []
  // on every call whenever the conversation had no messages yet -- see
  // EMPTY_MESSAGES in messageStore.ts for why that broke snapshot stability.
  const messages = useMessageStore((state) => state.messages[conversationId] ?? EMPTY_MESSAGES);
  const conversation = useMessageStore((state) =>
    state.conversations.find((c) => c.id === conversationId)
  );
  const user = useAuthStore((state) => state.user);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [highlightedId, setHighlightedId] = useState<number | null>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Clicking a reply preview (in MessageItem) scrolls to and briefly
  // highlights the original message, if it's currently rendered in this
  // list. If the original isn't loaded (e.g. far above what's scrolled
  // into view isn't an issue since we render the whole array, but it may
  // genuinely not exist if reply_to_deleted), this is a silent no-op.
  const scrollToMessage = (messageId: number) => {
    const el = document.getElementById(`message-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(messageId);
    setTimeout(() => {
      setHighlightedId((current) => (current === messageId ? null : current));
    }, 1500);
  };

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 dark:bg-gray-950">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
          <p>No messages yet. Start the conversation!</p>
        </div>
      ) : (
        <>
          {messages.map((message, index) => {
            const previous = index > 0 ? messages[index - 1] : undefined;
            const isFirstInRun = !previous || previous.sender_id !== message.sender_id;
            const replySender = message.reply_to_sender_id
              ? conversation?.members.find((m) => m.id === message.reply_to_sender_id)
              : undefined;
            return (
              <div
                key={`${message.id}-${message.client_id}`}
                id={`message-${message.id}`}
                className={`rounded-lg transition-shadow ${
                  highlightedId === message.id ? "ring-2 ring-blue-400 dark:ring-blue-500" : ""
                }`}
              >
                <MessageItem
                  message={message}
                  conversationId={conversationId}
                  sender={conversation?.members.find((m) => m.id === message.sender_id)}
                  replySender={replySender}
                  isFirstInRun={isFirstInRun}
                  isGroup={conversation?.type === "group"}
                  onReply={onReply}
                  onJumpToReply={scrollToMessage}
                />
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </>
      )}
    </div>
  );
}
