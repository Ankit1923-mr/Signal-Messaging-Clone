"use client";

import { useState } from "react";
import { useSettingsStore, Theme } from "@/store/settingsStore";

interface SettingsModalProps {
  onClose: () => void;
}

type SettingsSection = "appearance" | "notifications" | "privacy";

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * Settings shell, reached from the sidebar profile header. Appearance is
 * the only section wired to real behavior (persisted theme, applied via
 * useTheme.ts). Notifications and Privacy are intentionally rendered as
 * disabled, clearly-labeled placeholders -- they must never look like
 * working switches when nothing reads them, per the "no fake switches"
 * requirement. Wiring them to real behavior (e.g. actually suppressing
 * browser Notifications, or actually disabling read receipts) is future
 * work that would touch useWebSocket.ts / the receipt protocol, which is
 * out of scope for this pass.
 */
export function SettingsModal({ onClose }: SettingsModalProps) {
  const [section, setSection] = useState<SettingsSection>("appearance");
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[560px] max-w-[calc(100vw-2rem)] h-[420px] max-h-[80vh] flex overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left nav */}
        <div className="w-40 flex-shrink-0 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h2 className="font-semibold text-sm text-gray-900 dark:text-gray-100">Settings</h2>
          </div>
          <nav className="flex-1 py-2">
            {([
              { id: "appearance" as const, label: "Appearance" },
              { id: "notifications" as const, label: "Notifications" },
              { id: "privacy" as const, label: "Privacy" },
            ]).map((item) => (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  section === item.id
                    ? "bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium"
                    : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-end px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
              aria-label="Close settings"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {section === "appearance" && (
              <div>
                <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-1">Theme</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  Choose how the app looks. &quot;System&quot; follows your OS setting automatically.
                </p>
                <div className="space-y-2">
                  {THEME_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-2.5 text-sm text-gray-800 dark:text-gray-200 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="theme"
                        checked={theme === option.value}
                        onChange={() => setTheme(option.value)}
                        className="accent-blue-600"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {section === "notifications" && (
              <div>
                <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-1">Notifications</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                  These controls are placeholders and are not yet connected to notification
                  behavior.
                </p>
                <PlaceholderRow label="Enable notifications" />
                <PlaceholderRow label="Show message preview" />
                <PlaceholderRow label="Notification sound" />
              </div>
            )}

            {section === "privacy" && (
              <div>
                <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-1">Privacy</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                  These controls are placeholders and are not yet connected to privacy
                  behavior.
                </p>
                <PlaceholderRow label="Share online status" />
                <PlaceholderRow label="Send read receipts" />
                <PlaceholderRow label="Show typing indicators" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A disabled, explicitly-labeled "Coming soon" row for an unwired setting. */
function PlaceholderRow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-b-0">
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
          Coming soon
        </span>
        <input type="checkbox" disabled className="accent-gray-400 cursor-not-allowed" />
      </span>
    </div>
  );
}
