"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { useConversations } from "@/hooks/useConversations";
import { useWebSocket } from "@/hooks/useWebSocket";
import { ConversationList } from "@/components/ConversationList";
import { ChatHeader } from "@/components/ChatHeader";
import { Avatar } from "@/components/Avatar";
import { NewMessagePanel } from "@/components/NewMessagePanel";
import { MessageList } from "@/components/messages/MessageList";
import { MessageInput } from "@/components/messages/MessageInput";
import { TypingIndicator } from "@/components/messages/TypingIndicator";

type SidebarView = "conversations" | "new-message";

export default function ConversationsPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, loadUser, logout } = useAuthStore();
  const { activeConversationId, conversations, selectConversation } = useConversations();
  const [sidebarView, setSidebarView] = useState<SidebarView>("conversations");
  const [searchQuery, setSearchQuery] = useState("");

  // WebSocket connects as soon as the user is authenticated (cookie-based auth).
  const { isConnected, reconnecting } = useWebSocket(activeConversationId ?? undefined);

  // Load user on mount
  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/auth");
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return null;
  }

  const handleLogout = async () => {
    // logout() always clears local auth state, even if the backend call
    // fails, so navigation here is unconditional.
    await logout();
    router.push("/auth");
  };

  const activeConversation = conversations.find((c) => c.id === activeConversationId);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      {/* Sidebar: fixed width, never overlaps the chat pane */}
      <div className="w-[340px] flex-shrink-0 bg-white border-r border-gray-200 flex flex-col h-full overflow-hidden">
        {sidebarView === "new-message" ? (
          <NewMessagePanel
            onBack={() => setSidebarView("conversations")}
            onConversationCreated={(conversationId) => selectConversation(conversationId)}
          />
        ) : (
          <>
            {/* Current user profile header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 flex-shrink-0">
              <Avatar avatarUrl={user.avatar_url} seed={user.username} size={40} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-gray-900 truncate">{user.display_name}</p>
                <p className="text-xs text-gray-400 flex items-center gap-1">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isConnected ? "bg-green-500" : "bg-gray-300"
                    }`}
                  />
                  {isConnected ? "Connected" : reconnecting ? "Reconnecting..." : "Offline"}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors flex-shrink-0"
              >
                Logout
              </button>
            </div>

            {/* Conversation search */}
            <div className="px-3 py-2 border-b border-gray-200 flex-shrink-0">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Conversation list (its own internal overflow-y-auto) */}
            <ConversationList
              activeConversationId={activeConversationId ?? undefined}
              onSelectConversation={selectConversation}
              searchQuery={searchQuery}
            />

            {/* New message action */}
            <div className="p-3 border-t border-gray-200 flex-shrink-0">
              <button
                onClick={() => setSidebarView("new-message")}
                className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
              >
                + New message
              </button>
            </div>
          </>
        )}
      </div>

      {/* Main area: fills remaining space, never overlaps the sidebar */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-white">
        {activeConversation ? (
          <>
            <ChatHeader conversation={activeConversation} />
            <MessageList conversationId={activeConversation.id} />
            <TypingIndicator conversationId={activeConversation.id} conversation={activeConversation} />
            <MessageInput conversationId={activeConversation.id} disabled={!isConnected} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-sm px-6">
              <div className="w-20 h-20 mx-auto rounded-full bg-blue-50 flex items-center justify-center mb-4">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  className="w-10 h-10 text-blue-400"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">
                No conversation selected
              </h2>
              <p className="text-sm text-gray-500">
                Select a conversation from the sidebar, or start a new one to begin messaging.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
