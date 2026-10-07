"use client";

import { resolveAvatarSrc } from "@/lib/avatar";

interface AvatarProps {
  /** Stored avatar_url (e.g. "thumbs:alice"), if known. */
  avatarUrl?: string | null;
  /** Seed to fall back to when avatarUrl isn't set (e.g. username). */
  seed?: string;
  /** Pixel size of the circle (default 40). */
  size?: number;
  /** Shows a small green dot in the corner when true. */
  online?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<number, string> = {
  28: "w-7 h-7",
  32: "w-8 h-8",
  36: "w-9 h-9",
  40: "w-10 h-10",
  48: "w-12 h-12",
  56: "w-14 h-14",
};

/** Circular avatar — DiceBear "thumbs" (CC0) generated from a seed, no uploads/storage. */
export function Avatar({ avatarUrl, seed, size = 40, online, className = "" }: AvatarProps) {
  const src = resolveAvatarSrc(avatarUrl, seed);
  const sizeClass = SIZE_CLASSES[size] || "w-10 h-10";

  return (
    <div className={`relative inline-block flex-shrink-0 ${sizeClass} ${className}`}>
      <img
        src={src}
        alt=""
        className={`${sizeClass} rounded-full bg-gray-100 border border-gray-200 object-cover`}
      />
      {online && (
        <span
          className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full"
          aria-label="Online"
        />
      )}
    </div>
  );
}

/** Circular placeholder for group conversations (no per-user seed). */
export function GroupAvatar({ size = 40, online, className = "" }: Omit<AvatarProps, "avatarUrl" | "seed">) {
  const sizeClass = SIZE_CLASSES[size] || "w-10 h-10";
  return (
    <div className={`relative inline-block flex-shrink-0 ${sizeClass} ${className}`}>
      <div
        className={`${sizeClass} rounded-full bg-gradient-to-br from-slate-400 to-slate-600 border border-gray-200 flex items-center justify-center text-white`}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-1/2 h-1/2">
          <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
        </svg>
      </div>
      {online && (
        <span
          className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full"
          aria-label="Online"
        />
      )}
    </div>
  );
}
