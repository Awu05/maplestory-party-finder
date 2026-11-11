import { useSyncExternalStore } from 'react';

export type TimeFormat = '12h' | '24h';
const STORAGE_KEY = 'partyFinder.timeFormat';
const CHANGE_EVENT = 'partyFinder.timeFormatChanged';
let fallback: TimeFormat = '12h';

function getTimeFormat(): TimeFormat {
  if (typeof window === 'undefined') return '12h';
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '24h' ? '24h' : '12h';
  } catch {
    return fallback;
  }
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('storage', listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

export function useTimeFormat(): TimeFormat {
  return useSyncExternalStore(subscribe, getTimeFormat, () => '12h');
}

export function setTimeFormat(format: TimeFormat): void {
  fallback = format;
  try {
    window.localStorage.setItem(STORAGE_KEY, format);
  } catch {
    // The preference still works for this tab when storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
