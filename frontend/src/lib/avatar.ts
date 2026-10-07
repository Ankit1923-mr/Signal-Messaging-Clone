/**
 * Avatar generation (DiceBear "thumbs" style, CC0 1.0 licensed).
 *
 * No image upload/storage: avatars are generated deterministically from a
 * short seed string at render time. The backend only ever stores the seed
 * (e.g. "thumbs:alice") in users.avatar_url — well under its 255-char limit —
 * never a data URI or binary blob.
 */

import { createAvatar } from "@dicebear/core";
import * as thumbs from "@dicebear/thumbs";

const SEED_PREFIX = "thumbs:";

/** Build the compact avatar_url value to store for a given seed. */
export function buildAvatarUrl(seed: string): string {
  return `${SEED_PREFIX}${seed}`;
}

/** Extract the seed from a stored avatar_url, falling back to the raw value. */
function extractSeed(avatarUrl: string): string {
  return avatarUrl.startsWith(SEED_PREFIX) ? avatarUrl.slice(SEED_PREFIX.length) : avatarUrl;
}

/**
 * Generate a data: URI SVG for the given seed. Deterministic: the same seed
 * always produces the same avatar, so a username/user id is enough — no
 * randomness needs to be persisted.
 */
export function generateAvatarDataUri(seed: string): string {
  const avatar = createAvatar(thumbs, {
    seed,
    size: 64,
    radius: 50,
  });
  return avatar.toDataUri();
}

/**
 * Resolve the image to render for a user: prefer their stored avatar_url
 * (decoding the seed if it's one of ours), otherwise fall back to a seed
 * derived from their username/display name so every user always has *some*
 * avatar even before onboarding stored one.
 */
export function resolveAvatarSrc(avatarUrl?: string | null, fallbackSeed?: string): string {
  const seed = avatarUrl ? extractSeed(avatarUrl) : fallbackSeed || "guest";
  return generateAvatarDataUri(seed);
}

/** A handful of distinct seeds to offer as picker options during registration. */
export function getAvatarPickerSeeds(): string[] {
  return ["Nova", "Orion", "Luna", "Atlas", "Iris", "Milo", "Zara", "Finn"];
}
