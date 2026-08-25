// Los errores de supabase-js (PostgrestError) no son instancias de Error,
// asi que `String(err)` los deja como "[object Object]". Usado por todas
// las API routes para devolver un mensaje legible en la respuesta JSON.
export function serializeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    const maybeMessage = (err as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}
