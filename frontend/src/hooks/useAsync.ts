import { useCallback, useEffect, useRef, useState } from "react";
import { describeError, type DescribedError } from "../lib/errors";

interface AsyncState<T> {
  data?: T;
  error?: DescribedError;
  loading: boolean;
}

/**
 * Load data on mount (and whenever `deps` change), exposing loading / error / data and a reload.
 * Data from the previous load stays visible while reloading, and a slow response can never
 * overwrite a newer one.
 */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<AsyncState<T>>({ loading: true });
  const latest = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    const id = ++latest.current;
    setState((s) => ({ data: s.data, loading: true }));
    load().then(
      (data) => {
        if (id === latest.current) setState({ data, loading: false });
      },
      (error: unknown) => {
        if (id === latest.current) setState((s) => ({ data: s.data, error: describeError(error), loading: false }));
      },
    );
  }, deps);

  useEffect(() => {
    run();
    return () => {
      latest.current++; // ignore anything still in flight after unmount or a dependency change
    };
  }, [run]);

  return { ...state, reload: run };
}
