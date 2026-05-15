/**
 * Generates a 6-character human-friendly room code.
 * Uses an unambiguous alphabet (no 0/O, 1/I/L) so codes are easy to read aloud.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateRoomCode(length = 6): string {
  let out = "";
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    const buf = new Uint32Array(length);
    window.crypto.getRandomValues(buf);
    for (let i = 0; i < length; i++) {
      out += ALPHABET[buf[i] % ALPHABET.length];
    }
    return out;
  }
  // Server fallback (only used if ever called from server code).
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/** Normalises any user-typed code: trims, uppercases, strips spaces. */
export function normaliseRoomCode(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}
