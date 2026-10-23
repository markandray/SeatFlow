import { useEffect, useRef } from 'react';

export default function usePolling(callback, intervalMs = 5000, enabled = true) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return undefined;
    let running = false;
    const run = () => {
      if (document.hidden || running) return;
      running = true;
      Promise.resolve(callbackRef.current()).finally(() => {
        running = false;
      });
    };
    const onVisibilityChange = () => {
      if (!document.hidden) run();
    };

    run();
    const timer = window.setInterval(run, intervalMs);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs, enabled]);
}
