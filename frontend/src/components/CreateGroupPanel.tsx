"use client";

import { useEffect, useRef, useState } from "react";
import { User } from "@/types/protocol";
import { conversationService } from "@/services/conversationService";
import { useMessageStore } from "@/store/messageStore";
import { Avatar } from "@/components/Avatar";
import { toast } from "@/store/toastStore";

interface CreateGroupPanelProps {
  onBack: () => void;
  onConversationCreated: (conversationId: number) => void;
}

/**
 * "Create Group" sidebar state, following the same in-place-of-the-list
 * pattern as AddContactPanel. Lets the user name a group and multi-select
 * members, then calls the find-or-create-free POST /conversations/group
 * endpoint once on submit (never on each selection).
 */
export function CreateGroupPanel({ onBack, onConversationCreated }: CreateGroupPanelProps) {
  const [groupName, setGroupName] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [selected, setSelected] = useState<Map<number, User>>(new Map());
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const addConversation = useMessageStore((state) => state.addConversation);

  useEffect(() => {
    runSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSearch = async (q: string) => {
    setSearching(true);
    try {
      const users = await conversationService.searchUsers(q);
      setResults(users);
    } catch (err) {
      toast.error("Failed to search contacts");
    } finally {
      setSearching(false);
    }
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), 300);
  };

  const toggleSelected = (user: User) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(user.id)) {
        next.delete(user.id);
      } else {
        next.set(user.id, user);
      }
      return next;
    });
  };

  const handleCreate = async () => {
    const name = groupName.trim();
    if (!name || selected.size === 0 || creating) return;

    setCreating(true);
    try {
      const conversation = await conversationService.createGroupConversation(
        name,
        Array.from(selected.keys())
      );
      addConversation(conversation);
      toast.success("Group created");
      onConversationCreated(conversation.id);
      onBack();
    } catch (err) {
      toast.error("Failed to create group");
      setCreating(false);
    }
  };

  const canCreate = groupName.trim().length > 0 && selected.size > 0 && !creating;

  return (
    <div className="flex flex-col h-full">
      {/* Header: back button + title */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <button
          onClick={onBack}
          className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 p-1 -ml-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
          aria-label="Back"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Create Group</h2>
      </div>

      {/* Group name */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <input
          type="text"
          autoFocus
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="Group name"
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Selected members chips */}
      {selected.size > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          {Array.from(selected.values()).map((user) => (
            <span
              key={user.id}
              className="inline-flex items-center gap-1 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs px-2 py-1 rounded-full"
            >
              {user.display_name}
              <button
                onClick={() => toggleSelected(user)}
                className="text-blue-400 hover:text-blue-600"
                aria-label={`Remove ${user.display_name}`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search contacts to add..."
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>


      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {searching ? (
          <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-6">Searching...</p>
        ) : results.length === 0 ? (
          <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-6">No contacts found</p>
        ) : (
          results.map((user) => {
            const isSelected = selected.has(user.id);
            return (
              <button
                key={user.id}
                onClick={() => toggleSelected(user)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                  isSelected ? "bg-blue-50 dark:bg-blue-900/30" : ""
                }`}
              >
                <Avatar avatarUrl={user.avatar_url} seed={user.username} size={40} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{user.display_name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">@{user.username}</p>
                </div>
                <div
                  className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                    isSelected ? "bg-blue-600 border-blue-600" : "border-gray-300 dark:border-gray-600"
                  }`}
                >
                  {isSelected && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} className="w-3 h-3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Create button */}
      <div className="p-3 border-t border-gray-200 dark:border-gray-800 flex-shrink-0">
        <button
          onClick={handleCreate}
          disabled={!canCreate}
          className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {creating ? "Creating..." : "Create Group"}
        </button>
      </div>
    </div>
  );
}
