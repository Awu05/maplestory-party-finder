import { useEffect, useRef } from 'react';
import { localHoursToUtcHours, utcHoursToLocalHours } from '@pf/shared';
import './PlayTimeGrid.css';

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${hour < 12 ? 'a' : 'p'}`;
}

interface Props {
  /** Selected slots as UTC hour-of-week (0 = Sunday 00:00 UTC … 167). */
  value: number[];
  /** Enables editing (click, drag, Enter/Space) when provided and not readOnly. */
  onChange?: (v: number[]) => void;
  readOnly?: boolean;
}

/** 7-day × 24-hour grid shown in the viewer's local time zone. */
export function PlayTimeGrid({ value, onChange, readOnly }: Props) {
  const offset = new Date().getTimezoneOffset();
  const local = utcHoursToLocalHours(value, offset);
  const selected = new Set(local.map((s) => s.day * 24 + s.hour));
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const editable = !readOnly && !!onChange;

  // dragTo: the state (on/off) every cell entered during a drag is set to.
  const dragTo = useRef<boolean | null>(null);
  const mouseHandled = useRef(false);
  useEffect(() => {
    const end = () => {
      dragTo.current = null;
      // A click on the same cell fires before this timeout; any other release must not leave the flag set.
      setTimeout(() => {
        mouseHandled.current = false;
      }, 0);
    };
    window.addEventListener('mouseup', end);
    return () => window.removeEventListener('mouseup', end);
  }, []);

  const apply = (slot: number, on: boolean) => {
    if (selected.has(slot) === on) return;
    const next = new Set(selected);
    if (on) next.add(slot);
    else next.delete(slot);
    onChange?.(localHoursToUtcHours([...next].map((n) => ({ day: Math.floor(n / 24), hour: n % 24 })), offset));
  };

  return (
    <div className="ptg">
      <table className="ptg__table" role="grid" aria-readonly={!editable} aria-label="Play times in your local time">
        <thead>
          <tr>
            <td />
            {DAY_LABELS.map((d) => (
              <th key={d} scope="col">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hours.map((h) => (
            <tr key={h}>
              <th scope="row">{hourLabel(h)}</th>
              {DAY_LABELS.map((d, day) => {
                const on = selected.has(day * 24 + h);
                const slot = day * 24 + h;
                const label = `${d} ${hourLabel(h)}`;
                const cls = on ? 'ptg__cell ptg__cell--on' : 'ptg__cell';
                if (!editable) {
                  return <td key={d} role="gridcell" aria-label={label} aria-selected={on} className={cls} />;
                }
                return (
                  <td key={d} role="gridcell" aria-selected={on} className="ptg__td">
                    <button
                      type="button"
                      className={cls}
                      aria-label={label}
                      aria-pressed={on}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        mouseHandled.current = true;
                        dragTo.current = !on;
                        apply(slot, !on);
                      }}
                      onMouseEnter={() => {
                        if (dragTo.current !== null) apply(slot, dragTo.current);
                      }}
                      onClick={() => {
                        // Mouse presses were handled on mousedown; this covers keyboard (Enter/Space).
                        if (mouseHandled.current) mouseHandled.current = false;
                        else apply(slot, !on);
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
