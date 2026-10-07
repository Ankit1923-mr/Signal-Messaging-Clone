/**
 * Settings Store (Zustand)
 *
 * Appearance (theme) is the one section in this store that actually changes
 * behavior end-to-end: it's persisted to localStorage and applied to the DOM
 * by useTheme.ts. Notification/Privacy fields exist here as placeholders
 * only — see SettingsModal.tsx, where they're rendered as disabled controls
 * explicitly labeled "Coming soon" so they never look functional without
 * being wired to real behavior (no WebSocket/notification-dispatch changes
 * were made this round).
 */

import { create } from "zustand";

export type Theme = "system" | "light" | "dark";

interface SettingsState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const THEME_STORAGE_KEY = "signal-clone-theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // localStorage unavailable (private browsing etc.) — fall back silently.
  }
  return "system";
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: getInitialTheme(),

  setTheme: (theme) => {
    set({ theme });
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Best-effort persistence only; theme still applies for this session.
    }
  },
}));
