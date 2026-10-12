import { useRef, useState } from "react";
import { describeError, type DescribedError } from "../lib/errors";

/**
 * Wraps a form submission: tracks "busy", turns a failure into a DescribedError, and refuses to
 * start a second submission while one is in flight (a double-click must not send two requests).
 */
export function useSubmit<A extends unknown[], R>(submit: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DescribedError | null>(null);
  const inFlight = useRef(false);

  async function run(...args: A): Promise<R | undefined> {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      return await submit(...args);
    } catch (e) {
      setError(describeError(e));
      return undefined;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return { run, busy, error, clearError: () => setError(null) };
}
