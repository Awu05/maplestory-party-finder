import { Fragment, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { SLOTS_PER_DAY } from '@pf/shared';
import { setTimeFormat, useTimeFormat } from '../../lib/timeFormat';
import type { TimeFormat } from '../../lib/timeFormat';
import './FreeTimeGrid.css';

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${hour < 12 ? 'a' : 'p'}`;
}

export function halfHourLabel(slot: number, format: TimeFormat = '12h'): string {
  const hour = Math.floor(slot / 2);
  if (format === '24h') return `${String(hour).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`;
  const label = hourLabel(hour);
  return slot % 2 ? `${label.slice(0, -1)}:30${label.slice(-1)}` : label;
}

export interface AvailabilityLayer {
  id: string;
  label: string;
  color: string;
  slots: number[];
  coverage?: Map<number, number>;
}

interface Props {
  /** Half-hour slots in the viewer's zone (day * 48 + half-hour, 0 = Sunday). */
  value: number[];
  /** The grid's accessible name; ignored when labelledBy is given. */
  label?: string;
  /** Id of a visible element naming the grid (e.g. a summary), set as aria-labelledby instead of aria-label. */
  labelledBy?: string;
  /** Enables editing (click, drag, Enter/Space) when provided and not readOnly. */
  onChange?: (v: number[]) => void;
  readOnly?: boolean;
  /** Id of an element describing the grid (e.g. a hint), set as aria-describedby. */
  describedBy?: string;
  participants?: AvailabilityLayer[];
}

const lastDay = DAY_LABELS.length - 1;

/** 7-day × 48-slot grid shown in the viewer's local time zone. */
export function FreeTimeGrid({ value, onChange, readOnly, label: gridLabel, labelledBy, describedBy, participants }: Props) {
  const timeFormat = useTimeFormat();
  const selected = new Set(value);
  const layers = participants?.map((p) => ({ ...p, selected: new Set(p.slots) }));
  const slots = Array.from({ length: SLOTS_PER_DAY / 2 }, (_, h) => h);
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
  const [focused, setFocused] = useState(false);
  const cellRefs = useRef(new Map<number, HTMLElement>());
  const onKeyDown = (e: KeyboardEvent<HTMLElement>, slot: number) => {
    const day = Math.floor(slot / SLOTS_PER_DAY);
    const hour = slot % SLOTS_PER_DAY;
    let next: number;
    if (e.key === 'ArrowLeft') next = day === 0 && hour >= 24 ? lastDay * SLOTS_PER_DAY + hour - 24 : Math.max(day - 1, 0) * SLOTS_PER_DAY + hour;
    else if (e.key === 'ArrowRight') next = day === lastDay && hour < 24 ? hour + 24 : Math.min(day + 1, lastDay) * SLOTS_PER_DAY + hour;
    else if (e.key === 'ArrowUp') next = day * SLOTS_PER_DAY + Math.max(hour - 1, 0);
    else if (e.key === 'ArrowDown') next = day * SLOTS_PER_DAY + Math.min(hour + 1, SLOTS_PER_DAY - 1);
    else if (e.key === 'Home') next = hour;
    else if (e.key === 'End') next = lastDay * SLOTS_PER_DAY + hour;
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

  const cellInfo = (slot: number) => {
    const day = Math.floor(slot / SLOTS_PER_DAY);
    const time = slot % SLOTS_PER_DAY;
    const available = layers?.filter((p) => p.selected.has(slot)) ?? [];
    const mask = (p: (typeof available)[number]) => p.coverage?.get(slot) ?? 3;
    const early = available.filter((p) => mask(p) & 1);
    const late = available.filter((p) => mask(p) & 2);
    const everyone = !!layers && layers.length > 1 && early.length === layers.length && late.length === layers.length;
    const names = available.map((p) => `${p.label}${mask(p) === 1 ? ' (first 15 minutes)' : mask(p) === 2 ? ' (last 15 minutes)' : ''}`).join(', ');
    const overlap = Math.max(early.length, late.length);
    const label = `${DAY_LABELS[day]} ${halfHourLabel(time, timeFormat)}${layers ? ` — ${names || 'No one available'}${overlap > 1 && !everyone ? ` — ${overlap} overlap` : ''}${everyone ? ' — Everyone available' : ''}` : ''}`;
    const segment = (group: typeof available) => group.length === 0
      ? 'linear-gradient(var(--surface-2), var(--surface-2))'
      : group.length === 1 ? `linear-gradient(${group[0].color}, ${group[0].color})`
      : `repeating-linear-gradient(135deg, ${group.map((p, i) => `${p.color} ${i * 6}px ${(i + 1) * 6}px`).join(', ')})`;
    const background = available.length === 0 ? undefined : early.length === late.length && early.every((p, i) => p.id === late[i].id)
      ? segment(early) : `${segment(early)} top / 100% 50% no-repeat, ${segment(late)} bottom / 100% 50% no-repeat`;
    return { label, style: background ? { background } : undefined, everyone, count: overlap > 1 ? overlap : null };
  };

  return (
    <>
    <div className="ftg__toolbar" role="group" aria-label="Time format">
      <span>Time format</span>
      <button type="button" className="chip" aria-pressed={timeFormat === '12h'} onClick={() => setTimeFormat('12h')}>12-hour</button>
      <button type="button" className="chip" aria-pressed={timeFormat === '24h'} onClick={() => setTimeFormat('24h')}>24-hour</button>
    </div>
    <div className="ftg">
      <table
        className="ftg__table"
        role="grid"
        aria-readonly={!editable}
        aria-label={labelledBy ? undefined : gridLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
      >
        <thead>
          <tr>
            {[0, SLOTS_PER_DAY / 2].map((start) => (
              <th key={start} scope="colgroup" colSpan={8}>
                {halfHourLabel(start, timeFormat)}–{halfHourLabel(start + SLOTS_PER_DAY / 2 - 1, timeFormat)}
              </th>
            ))}
          </tr>
          <tr>
            {[0, 1].map((period) => (
              <Fragment key={period}>
                <th scope="col">Time</th>
                {DAY_LABELS.map((d) => <th key={d} scope="col">{d}</th>)}
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((h) => (
            <tr key={h}>
              {[h, h + SLOTS_PER_DAY / 2].map((time) => <Fragment key={time}>
              <th scope="row">{halfHourLabel(time, timeFormat)}</th>
              {DAY_LABELS.map((d, day) => {
                const on = selected.has(day * SLOTS_PER_DAY + time);
                const slot = day * SLOTS_PER_DAY + time;
                const { label, style, everyone, count } = cellInfo(slot);
                const cls = `ftg__cell${on ? ' ftg__cell--on' : ''}${everyone ? ' ftg__cell--all' : ''}`;
                if (!editable) {
                  return <td key={d} ref={(el) => { if (el) cellRefs.current.set(slot, el); else cellRefs.current.delete(slot); }}
                    role="gridcell" aria-label={label} title={label} aria-selected={on} className={cls} style={style}
                    tabIndex={slot === active ? 0 : -1} onFocus={() => { setActive(slot); setFocused(true); }}
                    onBlur={() => setFocused(false)} onKeyDown={(e) => onKeyDown(e, slot)}>{count}</td>;
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
                      style={style}
                      title={label}
                      aria-label={label}
                      aria-pressed={on}
                      tabIndex={slot === active ? 0 : -1}
                      onFocus={() => { setActive(slot); setFocused(true); }}
                      onBlur={() => setFocused(false)}
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
                    >{count}</button>
                  </td>
                );
              })}
              </Fragment>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {participants && <p className="ftg__status" role="status">{focused ? cellInfo(active).label : 'Focus a cell to see who is available.'}</p>}
    </>
  );
}
