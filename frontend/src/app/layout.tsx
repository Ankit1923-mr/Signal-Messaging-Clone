import type { Metadata } from "next";
import "./globals.css";
import { ToastContainer } from "@/components/Toast";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "Signal - Secure Messaging",
  description: "End-to-end encrypted messaging application",
};

// Applied before paint (inline, synchronous) so there's no flash of the
// wrong theme while React hydrates — mirrors the same resolution logic as
// useTheme.ts (system/light/dark + localStorage), just run eagerly.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("signal-clone-theme");
    var isDark = stored === "dark" || (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (isDark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          {children}
          <ToastContainer />
        </ThemeProvider>
      </body>
    </html>
  );
}
