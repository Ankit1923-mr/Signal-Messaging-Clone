import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signal - Secure Messaging",
  description: "End-to-end encrypted messaging application",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
