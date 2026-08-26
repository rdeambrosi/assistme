// Compartido entre middleware.ts (Edge runtime) y app/api/login — usa
// Web Crypto (`crypto.subtle`) en vez de el modulo `node:crypto` porque el
// primero corre en ambos runtimes, el segundo no en Edge.
export const SESSION_COOKIE = "comms_hub_session";

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
