import { useId, useState } from 'react';
import { MAX_REMINDERS, isValidReminderOffset } from '@pf/shared';
import './reminders.css';

const UNITS = [{ label: 'minutes', size: 1 }, { label: 'hours', size: 60 }, { label: 'days', size: 1440 }];
const unitFor = (minutes: number) => minutes > 0 && minutes % 1440 === 0 ? 1440 : minutes > 0 && minutes % 60 === 0 ? 60 : 1;

export function ReminderEditor({ value, onChange, disabled }: { value: number[]; onChange(next: number[]): void; disabled?: boolean }) {
  const headingId = useId();
  const helpId = useId();
  const errorId = useId();
  const [units, setUnits] = useState<number[]>(() => value.map(unitFor));
  const invalid = value.some((minutes) => !isValidReminderOffset(minutes));
  const replace = (index: number, minutes: number) => onChange(value.map((current, i) => i === index ? minutes : current));
  const currentUnits = value.map((minutes, index) => units[index] ?? unitFor(minutes));
  function changeUnit(index: number, size: number) {
    setUnits(currentUnits.map((current, i) => i === index ? size : current));
    replace(index, value[index]! / currentUnits[index]! * size);
  }
  function remove(index: number) {
    setUnits(currentUnits.filter((_, i) => i !== index));
    onChange(value.filter((_, i) => i !== index));
  }
  function add() {
    setUnits([...currentUnits, 1]);
    onChange([...value, 15]);
  }
  return <div role="group" className="reminders" aria-labelledby={headingId} aria-describedby={`${helpId}${invalid ? ` ${errorId}` : ''}`}>
    <h3 id={headingId}>Reminders</h3>
    <small id={helpId}>Optional. Reminders start once the time is finalized; each can be 5 minutes to 7 days before the run.</small>
    {value.map((minutes, index) => {
      const size = currentUnits[index]!;
      return <div className="reminders__row" key={index}>
        <input className="reminders__amount" type="number" aria-label={`Reminder ${index + 1} amount`} min={1} step={1} required disabled={disabled} value={Number.isNaN(minutes) ? '' : minutes / size} onChange={(e) => replace(index, e.target.value === '' ? NaN : Number(e.target.value) * size)} />
        <select aria-label={`Reminder ${index + 1} unit`} value={size} disabled={disabled} onChange={(e) => changeUnit(index, Number(e.target.value))}>
          {UNITS.map((unit) => <option key={unit.size} value={unit.size}>{unit.label}</option>)}
        </select>
        <span className="reminders__suffix">before the run</span>
        <button type="button" className="btn btn--secondary" aria-label={`Remove reminder ${index + 1}`} disabled={disabled} onClick={() => remove(index)}>Remove</button>
      </div>;
    })}
    {invalid && <p role="alert" id={errorId} className="reminders__error">Use whole minutes between 5 minutes and 7 days.</p>}
    {value.length < MAX_REMINDERS && <button type="button" className="btn btn--secondary reminders__add" disabled={disabled} onClick={add}>Add reminder</button>}
  </div>;
}
