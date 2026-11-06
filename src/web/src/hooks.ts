import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from './api/client';

export interface AsyncState<T> { data: T | undefined; error: string | null; loading: boolean; reload: () => void }

/** GETs an API path; re-fetches when the path changes or reload() is called. Pass null to skip. */
export function useApi<T>(path: string | null): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) return;
    const ac = new AbortController();
    setLoading(true);
    api<T>(path, { signal: ac.signal })
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => { if (!ac.signal.aborted) setError(errorText(e)); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Wraps a mutating action with busy/error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorText(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
