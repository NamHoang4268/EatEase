'use client';

import { useEffect, useState } from 'react';

type ApiState = 'checking' | 'available' | 'unavailable';

export function ApiStatus() {
  const [state, setState] = useState<ApiState>('checking');

  useEffect(() => {
    const controller = new AbortController();

    void fetch('/api/v1/health', { signal: controller.signal })
      .then((response) => {
        setState(response.ok ? 'available' : 'unavailable');
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState('unavailable');
        }
      });

    return () => controller.abort();
  }, []);

  return <p aria-live="polite">API: {state}</p>;
}
