"use client";

import { useEffect } from "react";
import { useSettingsStore } from "@/store/settingsStore";

/**
 * Applies the persisted theme choice (system/light/dark) to <html> as a
 * `.dark` class, which globals.css's `@custom-variant dark` wires up to
 * Tailwind's `dark:` utilities. Mounted once in app/layout.tsx.
 *
 * "System" tracks the OS preference live via matchMedia, so toggling OS
 * dark mode while the app is open updates it immediately without a reload.
 */
export function useTheme() {
  const theme = useSettingsStore((state) => state.theme);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const applyResolvedTheme = () => {
      const isDark = theme === "dark" || (theme === "system" && media.matches);
      root.classList.toggle("dark", isDark);
    };

    applyResolvedTheme();

    if (theme === "system") {
      media.addEventListener("change", applyResolvedTheme);
      return () => media.removeEventListener("change", applyResolvedTheme);
    }
  }, [theme]);
}
