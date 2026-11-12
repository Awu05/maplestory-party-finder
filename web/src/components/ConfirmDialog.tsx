import { useEffect, useId, useRef } from 'react';
import type { MouseEvent, ReactNode, SyntheticEvent } from 'react';
import './confirmDialog.css';

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** Disables Confirm, e.g. while the numbers it reports are still loading. */
  confirmDisabled?: boolean;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A small modal "are you sure?" for destructive admin actions. Focus returns to the opener when it unmounts. */
export function ConfirmDialog({ title, children, confirmLabel, confirmDisabled, busy, error, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    return () => {
      if (d.open) d.close();
      // The page behind a modal is inert, so focus goes back only once the dialog is gone.
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const onDialogCancel = (e: SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    if (!busy) onCancel();
  };
  const onDialogClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget && !busy) onCancel();
  };

  return (
    <dialog ref={ref} className="confirm-dialog" aria-modal="true" aria-labelledby={headingId} onCancel={onDialogCancel} onClick={onDialogClick}>
      <div className="confirm-dialog__content">
        <h2 id={headingId}>{title}</h2>
        <div className="confirm-dialog__body">{children}</div>
        {error && <p role="alert" className="admin__error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn btn--danger" disabled={busy || confirmDisabled} onClick={onConfirm}>{confirmLabel}</button>
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </dialog>
  );
}
