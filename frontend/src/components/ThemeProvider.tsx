"use client";

import { ReactNode } from "react";
import { useTheme } from "@/hooks/useTheme";

/** Thin client wrapper so the (server) root layout can apply the theme. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useTheme();
  return <>{children}</>;
}
