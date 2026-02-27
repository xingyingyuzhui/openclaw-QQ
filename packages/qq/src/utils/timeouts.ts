export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  options?: { onTimeout?: () => void | Promise<void> },
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(async () => {
          try {
            await options?.onTimeout?.();
          } catch {}
          reject(new Error(`${label} timeout after ${timeoutMs}ms`));
        }, Math.max(100, timeoutMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
