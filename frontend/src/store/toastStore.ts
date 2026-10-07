/**
 * Toast Store (Zustand)
 *
 * Single shared toast mechanism for the whole app — replaces the scattered
 * inline "red error text" blocks that AddContactPanel/CreateGroupPanel/
 * GroupMembersModal each had their own copy of. Every caller goes through
 * `addToast()`; rendering lives in <ToastContainer /> (components/Toast.tsx),
 * mounted once in app/layout.tsx.
 */

import { create } from "zustand";

export type ToastVariant = "success" | "error" | "info";

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastStoreState {
  toasts: Toast[];
  addToast: (message: string, variant?: ToastVariant, durationMs?: number) => void;
  removeToast: (id: number) => void;
}

let nextId = 1;
const DEFAULT_DURATION_MS = 4000;

export const useToastStore = create<ToastStoreState>((set, get) => ({
  toasts: [],

  addToast: (message, variant = "info", durationMs = DEFAULT_DURATION_MS) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, message, variant }] }));

    // Auto-dismiss. Each toast owns its own timer, so multiple toasts
    // in flight at once don't interfere with each other's lifetimes.
    setTimeout(() => {
      get().removeToast(id);
    }, durationMs);
  },

  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));

/** Convenience helpers so call sites don't need to know the variant string literals. */
export const toast = {
  success: (message: string) => useToastStore.getState().addToast(message, "success"),
  error: (message: string) => useToastStore.getState().addToast(message, "error"),
  info: (message: string) => useToastStore.getState().addToast(message, "info"),
};
