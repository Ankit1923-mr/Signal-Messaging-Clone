"use client";

import { useEffect, useRef } from "react";
import { useMessageStore, EMPTY_MESSAGES } from "@/store/messageStore";
import { useAuthStore } from "@/store/authStore";
import { MessageItem } from "./MessageItem";

interface MessageListProps {
  conversationId: number;
}

export function MessageList({ conversationId }: MessageListProps) {
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

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-400">
          <p>No messages yet. Start the conversation!</p>
        </div>
      ) : (
        <>
          {messages.map((message) => (
            <MessageItem
              key={`${message.id}-${message.client_id}`}
              message={message}
              conversationId={conversationId}
              sender={conversation?.members.find((m) => m.id === message.sender_id)}
            />
          ))}
          <div ref={messagesEndRef} />
        </>
      )}
    </div>
  );
}
