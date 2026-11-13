'use client';

import { useCallback, useEffect, useState } from 'react';

type PlatformTheme = 'light' | 'dark';
const STORAGE_KEY = 'zenbook-platform-theme';

export function usePlatformTheme() {
  const [theme, setTheme] = useState<PlatformTheme>('light');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') setTheme(stored);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'light' ? 'dark' : 'light';
      window.localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
