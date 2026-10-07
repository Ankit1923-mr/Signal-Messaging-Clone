"use client";

import { useToastStore, ToastVariant } from "@/store/toastStore";

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: "bg-green-600 text-white",
  error: "bg-red-600 text-white",
  info: "bg-gray-800 text-white",
};

const VARIANT_ICON: Record<ToastVariant, string> = {
  success: "✓",
  error: "⚠",
  info: "ℹ",
};

/**
 * App-wide toast stack. Mounted once in app/layout.tsx. Desktop-friendly
 * fixed position (bottom-right), stacks multiple toasts without layout
 * shift to the rest of the page (fixed positioning, own z-index), and each
 * toast auto-dismisses on its own timer (see toastStore.ts).
 */
export function ToastContainer() {
  const toasts = useToastStore((state) => state.toasts);
  const removeToast = useToastStore((state) => state.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex items-start gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm ${VARIANT_STYLES[t.variant]}`}
        >
          <span aria-hidden="true">{VARIANT_ICON[t.variant]}</span>
          <span className="flex-1 break-words">{t.message}</span>
          <button
            onClick={() => removeToast(t.id)}
            className="opacity-70 hover:opacity-100 flex-shrink-0"
            aria-label="Dismiss notification"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
