import { useEffect, useRef } from "react";

export type DebouncedSaver<Args extends unknown[]> = {
  /** Queue a save under `key`. Same-key calls within `delayMs` coalesce. */
  schedule: (key: string, ...args: Args) => void;
  /** Fire every pending save immediately and wait for them all. */
  flush: () => Promise<void>;
};

export function useDebouncedSaver<Args extends unknown[]>(
  fn: (...args: Args) => Promise<void>,
  delayMs = 400,
): DebouncedSaver<Args> {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<string, Args>());

  useEffect(() => {
    return () => {
      for (const t of timers.current.values()) clearTimeout(t);
    };
  }, []);

  function schedule(key: string, ...args: Args) {
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
  }

  async function flush() {
    // Cancel pending timers and collect their args.
    const work: Args[] = [];
    for (const [key, t] of timers.current.entries()) {
      clearTimeout(t);
      const args = pending.current.get(key);
      if (args) work.push(args);
      pending.current.delete(key);
    }
    timers.current.clear();
    await Promise.all(work.map((args) => fn(...args)));
  }

  return { schedule, flush };
}
