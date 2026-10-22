export function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object') {
    const e = error as { name?: string; message?: string; code?: string };
    if (e.name === 'AbortError' || e.code === 'ABORT_ERR') return true;
    if (typeof e.message === 'string' && /abort/i.test(e.message)) return true;
  }
  return false;
}
