"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { useConversations } from "@/hooks/useConversations";
import { useWebSocket } from "@/hooks/useWebSocket";
import { ConversationList } from "@/components/ConversationList";
import { ChatHeader } from "@/components/ChatHeader";
import { Avatar } from "@/components/Avatar";
import { AddContactPanel } from "@/components/AddContactPanel";
import { CreateGroupPanel } from "@/components/CreateGroupPanel";
import { MessageList } from "@/components/messages/MessageList";
import { MessageInput } from "@/components/messages/MessageInput";
import { TypingIndicator } from "@/components/messages/TypingIndicator";
import { SettingsModal } from "@/components/SettingsModal";
import { toast } from "@/store/toastStore";
import { Message } from "@/types/protocol";

type SidebarView = "conversations" | "add-contact" | "create-group";

export default function ConversationsPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, loadUser, logout } = useAuthStore();
  const { activeConversationId, conversations, selectConversation } = useConversations();
  const [sidebarView, setSidebarView] = useState<SidebarView>("conversations");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Clear any in-progress reply when switching conversations -- replying
  // across conversations would be confusing and the backend also rejects
  // a reply_to_message_id from a different conversation anyway.
  useEffect(() => {
    setReplyTarget(null);
  }, [activeConversationId]);

  // WebSocket connects as soon as the user is authenticated (cookie-based auth).
  const { isConnected, reconnecting, disconnect } = useWebSocket(activeConversationId ?? undefined);

  // Fire a one-time "Connection restored" toast on an actual reconnect, not
  // on the very first (initial) connection and not repeatedly during
  // reconnect attempts. The persistent "Reconnecting.../Offline" indicator
  // in the sidebar profile header already covers the "connection lost"
  // signal, so this only adds the restore confirmation.
  const prevConnectedRef = useRef<boolean | null>(null);
  const hadDisconnectRef = useRef(false);
  useEffect(() => {
    if (prevConnectedRef.current === true && !isConnected) {
      hadDisconnectRef.current = true;
    } else if (hadDisconnectRef.current && isConnected) {
      toast.success("Connection restored");
      hadDisconnectRef.current = false;
    }
    prevConnectedRef.current = isConnected;
  }, [isConnected]);

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

  // A few desktop-app-style keyboard shortcuts, scoped to this page only
  // (listener is added/removed with this component, so it never affects
  // any other route). Each one preventDefault()s the browser's own
  // shortcut for that combo (Ctrl+F find-in-page, Ctrl+N new window,
  // Ctrl+, browser settings on some platforms) only when we actually
  // handle it here.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      if (!isCtrlOrCmd) return;

      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setSidebarView("conversations");
        // Calling focus() on an already-focused input is a harmless no-op,
        // so there's no special-case needed for "already focused".
        searchInputRef.current?.focus();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setSidebarView("add-contact");
      } else if (e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
    // Close the WebSocket BEFORE clearing auth state: the backend only
    // broadcasts this user as offline (and removes their connection) when
    // the socket actually closes (see ws.py's `finally` block). Without
    // this, other users kept seeing a logged-out user as "Online"
    // indefinitely, since logout() alone never touched the live connection.
    disconnect();
    // logout() always clears local auth state, even if the backend call
    // fails, so navigation here is unconditional.
    await logout();
    router.push("/auth");
  };

  const activeConversation = conversations.find((c) => c.id === activeConversationId);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100 dark:bg-gray-950">
      {/* Sidebar: fixed width, never overlaps the chat pane */}
      <div className="w-[340px] flex-shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col h-full overflow-hidden">
        {sidebarView === "add-contact" ? (
          <AddContactPanel
            onBack={() => setSidebarView("conversations")}
            onConversationCreated={(conversationId) => selectConversation(conversationId)}
          />
        ) : sidebarView === "create-group" ? (
          <CreateGroupPanel
            onBack={() => setSidebarView("conversations")}
            onConversationCreated={(conversationId) => selectConversation(conversationId)}
          />
        ) : (
          <>
            {/* Current user profile header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
              <Avatar avatarUrl={user.avatar_url} seed={user.username} size={40} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">{user.display_name}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isConnected ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"
                    }`}
                  />
                  {isConnected ? "Connected" : reconnecting ? "Reconnecting..." : "Offline"}
                </p>
              </div>
              <button
                onClick={() => setShowSettings(true)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
                aria-label="Settings"
                title="Settings"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4.5 h-4.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <button
                onClick={handleLogout}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
              >
                Logout
              </button>
            </div>

            {/* Conversation search */}
            <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations... (Ctrl+F)"
                className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Conversation list (its own internal overflow-y-auto) */}
            <ConversationList
              activeConversationId={activeConversationId ?? undefined}
              onSelectConversation={selectConversation}
              searchQuery={searchQuery}
            />

            {/* Add Contact / Create Group actions */}
            <div className="p-3 border-t border-gray-200 dark:border-gray-800 flex-shrink-0 flex gap-2">
              <button
                onClick={() => setSidebarView("add-contact")}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
              >
                + Add Contact
              </button>
              <button
                onClick={() => setSidebarView("create-group")}
                className="flex-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                + New Group
              </button>
            </div>
          </>
        )}
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {/* Main area: fills remaining space, never overlaps the sidebar */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-white dark:bg-gray-900">
        {activeConversation ? (
          <>
            <ChatHeader conversation={activeConversation} />
            <MessageList conversationId={activeConversation.id} onReply={setReplyTarget} />
            <TypingIndicator conversationId={activeConversation.id} conversation={activeConversation} />
            <MessageInput
              conversationId={activeConversation.id}
              disabled={!isConnected}
              replyTarget={replyTarget}
              replyTargetName={
                replyTarget
                  ? replyTarget.sender_id === user.id
                    ? "yourself"
                    : activeConversation.members.find((m) => m.id === replyTarget.sender_id)
                        ?.display_name
                  : undefined
              }
              onCancelReply={() => setReplyTarget(null)}
            />
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
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
                No conversation selected
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Select a conversation from the sidebar, or start a new one to begin messaging.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
