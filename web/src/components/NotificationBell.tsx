import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useMarkRead, useNotifications } from '../api/notifyHooks';
import { relativeTime } from './post/time';
import './bell.css';

export function NotificationBell() {
  const { data } = useNotifications();
  const markRead = useMarkRead();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const newestSeen = useRef<string | null | undefined>(undefined);

  const newestId = data ? (data.items[0]?.id ?? null) : undefined;
  useEffect(() => {
    if (newestId === undefined) return;
    // Skip the first load; afterwards a different newest id means something arrived.
    if (newestSeen.current !== undefined && newestSeen.current !== newestId) {
      void qc.invalidateQueries({ queryKey: ['posts'] });
    }
    newestSeen.current = newestId;
  }, [newestId, qc]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const unread = data?.unreadCount ?? 0;
  const items = data?.items.slice(0, 30) ?? [];

  return (
    <div className="bell" ref={wrapRef}>
      <button
        type="button"
        className="bell-button"
        aria-label={`Notifications, ${unread} unread`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="bell-badge" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="bell-panel" role="region" aria-label="Notifications">
          <div className="bell-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button type="button" onClick={() => markRead.mutate({ all: true })}>
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="bell-empty">You're all caught up.</p>
          ) : (
            <ul className="bell-list">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={n.read ? 'bell-item' : 'bell-item unread'}
                    onClick={() => {
                      if (!n.read) markRead.mutate({ ids: [n.id] });
                      setOpen(false);
                      navigate(n.link);
                    }}
                  >
                    <span className="bell-text">{n.text}</span>
                    <span className="bell-time">{relativeTime(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
