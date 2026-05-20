import { useEffect, useRef } from "react";

export function useDebouncedSaver<Args extends unknown[]>(
  fn: (...args: Args) => Promise<void>,
  delayMs = 400,
) {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<string, Args>());

  useEffect(() => {
    return () => {
      for (const t of timers.current.values()) clearTimeout(t);
    };
  }, []);

  return function schedule(key: string, ...args: Args) {
    pending.current.set(key, args);
    const existing = timers.current.get(key);
    if (existing) clearTimeout(existing);
    timers.current.set(
      key,
      setTimeout(async () => {
        const args = pending.current.get(key);
        if (!args) return;
        pending.current.delete(key);
        timers.current.delete(key);
        await fn(...args);
      }, delayMs),
    );
  };
}
