import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import './FreeTimeGrid.css';

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${hour < 12 ? 'a' : 'p'}`;
}

interface Props {
  /** Selected slots as hour-of-week in the viewer's zone (day * 24 + hour, 0 = Sunday). No conversion happens here. */
  value: number[];
  label: string;
  /** Enables editing (click, drag, Enter/Space) when provided and not readOnly. */
  onChange?: (v: number[]) => void;
  readOnly?: boolean;
  /** Id of an element describing the grid (e.g. a hint), set as aria-describedby. */
  describedBy?: string;
}

const lastDay = DAY_LABELS.length - 1;

/** 7-day × 24-hour grid shown in the viewer's local time zone. */
export function FreeTimeGrid({ value, onChange, readOnly, label: gridLabel, describedBy }: Props) {
  const selected = new Set(value);
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const editable = !readOnly && !!onChange;

  // The latest selection, updated on every apply so several drag events before a re-render all count;
  // re-synced whenever the parent passes a new value.
  const latest = useRef(value);
  const lastProp = useRef(value);
  if (lastProp.current !== value) {
    lastProp.current = value;
    latest.current = value;
  }

  // Roving tabindex: the grid is one Tab stop, the active cell; arrows move it.
  const [active, setActive] = useState(() => (value.length > 0 ? Math.min(...value) : 0));
  const cellRefs = useRef(new Map<number, HTMLButtonElement>());
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, slot: number) => {
    const day = Math.floor(slot / 24);
    const hour = slot % 24;
    let next: number;
    if (e.key === 'ArrowLeft') next = Math.max(day - 1, 0) * 24 + hour;
    else if (e.key === 'ArrowRight') next = Math.min(day + 1, lastDay) * 24 + hour;
    else if (e.key === 'ArrowUp') next = day * 24 + Math.max(hour - 1, 0);
    else if (e.key === 'ArrowDown') next = day * 24 + Math.min(hour + 1, 23);
    else if (e.key === 'Home') next = hour;
    else if (e.key === 'End') next = lastDay * 24 + hour;
    else return;
    e.preventDefault();
    setActive(next);
    cellRefs.current.get(next)?.focus();
  };

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
    const current = new Set(latest.current);
    if (current.has(slot) === on) return;
    if (on) current.add(slot);
    else current.delete(slot);
    const next = [...current].sort((a, b) => a - b);
    latest.current = next;
    onChange?.(next);
  };

  return (
    <div className="ftg">
      <table
        className="ftg__table"
        role="grid"
        aria-readonly={!editable}
        aria-label={gridLabel}
        aria-describedby={describedBy}
      >
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
                const cls = on ? 'ftg__cell ftg__cell--on' : 'ftg__cell';
                if (!editable) {
                  return <td key={d} role="gridcell" aria-label={label} aria-selected={on} className={cls} />;
                }
                return (
                  <td key={d} role="gridcell" aria-selected={on} className="ftg__td">
                    <button
                      ref={(el) => {
                        if (el) cellRefs.current.set(slot, el);
                        else cellRefs.current.delete(slot);
                      }}
                      type="button"
                      className={cls}
                      aria-label={label}
                      aria-pressed={on}
                      tabIndex={slot === active ? 0 : -1}
                      onFocus={() => setActive(slot)}
                      onKeyDown={(e) => onKeyDown(e, slot)}
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
