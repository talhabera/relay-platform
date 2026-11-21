'use client';

import { useEffect } from 'react';
import { initUmamiIdentity } from '@/lib/analytics';

export function AnalyticsProvider() {
  useEffect(() => {
    try {
      const cleanup = initUmamiIdentity();
      return cleanup;
    } catch {
      return () => {};
    }
  }, []);

  return null;
}
