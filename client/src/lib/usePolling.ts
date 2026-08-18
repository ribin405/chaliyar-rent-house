import { useEffect, useRef } from 'react';

const DEFAULT_INTERVAL_MS = 12000;

export function usePolling(callback: () => void, intervalMs: number = DEFAULT_INTERVAL_MS) {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    savedCallback.current();
    const id = setInterval(() => savedCallback.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
