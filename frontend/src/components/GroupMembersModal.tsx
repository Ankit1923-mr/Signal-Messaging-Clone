"use client";

import { useEffect, useRef, useState } from "react";
import { Conversation, User } from "@/types/protocol";
import { conversationService } from "@/services/conversationService";
import { useMessageStore } from "@/store/messageStore";
import { Avatar } from "@/components/Avatar";

interface GroupMembersModalProps {
  conversation: Conversation;
  currentUserId: number;
  onClose: () => void;
}

/**
 * Member list for a group conversation, reached from ChatHeader. Shows
 * every member, an "Admin" badge on the group's admin, and — admin-only —
 * controls to add or remove members. Reuses the conversation's already-
 * fetched `members`/`admin_id` (no new GET endpoint needed); add/remove
 * mutations call the admin-only REST endpoints and patch the store's
 * conversation in place via the existing upsert-by-id `addConversation`.
 */
export function GroupMembersModal({ conversation, currentUserId, onClose }: GroupMembersModalProps) {
  const addConversation = useMessageStore((state) => state.addConversation);
  const isAdmin = conversation.admin_id === currentUserId;

  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showAddPicker, setShowAddPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const memberIds = new Set(conversation.members.map((m) => m.id));

  const runSearch = async (q: string) => {
    setSearching(true);
    try {
      const users = await conversationService.searchUsers(q);
      setResults(users.filter((u) => !memberIds.has(u.id)));
    } catch {
      setError("Failed to search contacts");
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (showAddPicker) runSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddPicker]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), 300);
  };

  const handleAddMember = async (userId: number) => {
    setBusyUserId(userId);
    setError(null);
    try {
      const updated = await conversationService.addGroupMember(conversation.id, userId);
      addConversation(updated);
      setShowAddPicker(false);
      setQuery("");
    } catch (err) {
      setError("Failed to add member");
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRemoveMember = async (userId: number) => {
    setBusyUserId(userId);
    setError(null);
    try {
      const updated = await conversationService.removeGroupMember(conversation.id, userId);
      addConversation(updated);
    } catch (err) {
      setError("Failed to remove member");
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-[360px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900">{conversation.name || "Group"}</h2>
            <p className="text-xs text-gray-500">{conversation.members.length} members</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="px-4 py-2 text-xs text-red-600 bg-red-50 flex-shrink-0">{error}</div>
        )}

        {/* Member list */}
        <div className="flex-1 overflow-y-auto">
          {conversation.members.map((member) => {
            const memberIsAdmin = conversation.admin_id === member.id;
            return (
              <div
                key={member.id}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
              >
                <Avatar avatarUrl={member.avatar_url} seed={member.username} size={36} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {member.display_name}
                    {member.id === currentUserId && (
                      <span className="text-gray-400 font-normal"> (you)</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 truncate">@{member.username}</p>
                </div>
                {memberIsAdmin && (
                  <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full flex-shrink-0">
                    Admin
                  </span>
                )}
                {isAdmin && !memberIsAdmin && (
                  <button
                    onClick={() => handleRemoveMember(member.id)}
                    disabled={busyUserId !== null}
                    className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 disabled:opacity-50 flex-shrink-0"
                  >
                    {busyUserId === member.id ? "Removing..." : "Remove"}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Admin-only: add member */}
        {isAdmin && (
          <div className="border-t border-gray-200 flex-shrink-0">
            {showAddPicker ? (
              <div className="flex flex-col max-h-60">
                <div className="p-2">
                  <input
                    type="text"
                    autoFocus
                    value={query}
                    onChange={(e) => handleQueryChange(e.target.value)}
                    placeholder="Search contacts to add..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="flex-1 overflow-y-auto">
                  {searching ? (
                    <p className="text-center text-sm text-gray-400 py-4">Searching...</p>
                  ) : results.length === 0 ? (
                    <p className="text-center text-sm text-gray-400 py-4">No contacts found</p>
                  ) : (
                    results.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => handleAddMember(user.id)}
                        disabled={busyUserId !== null}
                        className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-gray-50 transition-colors disabled:opacity-50"
                      >
                        <Avatar avatarUrl={user.avatar_url} seed={user.username} size={32} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{user.display_name}</p>
                        </div>
                        {busyUserId === user.id && (
                          <span className="text-xs text-gray-400 flex-shrink-0">Adding...</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddPicker(true)}
                className="w-full text-sm font-semibold text-blue-600 hover:bg-blue-50 py-3 transition-colors"
              >
                + Add Member
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
