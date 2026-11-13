import { useEffect, useId, useRef } from 'react';
import type { MouseEvent, ReactNode, RefObject, SyntheticEvent } from 'react';
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
  /**
   * Where focus goes when the dialog closes after Confirm, e.g. the page heading: a delete usually
   * removes the button that opened the dialog. Cancelling returns focus to the opener.
   */
  focusAfterConfirm?: RefObject<HTMLElement | null>;
}

/** A small modal "are you sure?" for destructive admin actions. Focus returns to the opener when it unmounts. */
export function ConfirmDialog({ title, children, confirmLabel, confirmDisabled, busy, error, onConfirm, onCancel, focusAfterConfirm }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const confirmed = useRef(false);
  const afterConfirm = useRef(focusAfterConfirm);
  afterConfirm.current = focusAfterConfirm;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    return () => {
      if (d.open) d.close();
      // The page behind a modal is inert, so focus goes back only once the dialog is gone.
      const target = confirmed.current ? afterConfirm.current?.current : null;
      if (target?.isConnected) target.focus();
      else if (opener?.isConnected) opener.focus();
    };
  }, []);

  const cancel = () => {
    confirmed.current = false;
    onCancel();
  };
  const onDialogCancel = (e: SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    if (!busy) cancel();
  };
  const onDialogClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget && !busy) cancel();
  };

  return (
    <dialog ref={ref} className="confirm-dialog" aria-modal="true" aria-labelledby={headingId} onCancel={onDialogCancel} onClick={onDialogClick}>
      <div className="confirm-dialog__content">
        <h2 id={headingId}>{title}</h2>
        <div className="confirm-dialog__body">{children}</div>
        {error && <p role="alert" className="admin__error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn btn--danger" disabled={busy || confirmDisabled} onClick={() => { confirmed.current = true; onConfirm(); }}>{confirmLabel}</button>
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={cancel}>Cancel</button>
        </div>
      </div>
    </dialog>
  );
}
