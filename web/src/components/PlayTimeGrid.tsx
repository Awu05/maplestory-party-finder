import { utcHoursToLocalHours } from '@pf/shared';
import './PlayTimeGrid.css';

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${hour < 12 ? 'a' : 'p'}`;
}

interface Props {
  /** Selected slots as UTC hour-of-week (0 = Sunday 00:00 UTC … 167). */
  value: number[];
  /** Interactive editing (click/drag) arrives in Task 12; only read-only rendering exists today. */
  onChange?: (v: number[]) => void;
  readOnly?: boolean;
}

/** 7-day × 24-hour grid shown in the viewer's local time zone. */
export function PlayTimeGrid({ value }: Props) {
  const local = utcHoursToLocalHours(value, new Date().getTimezoneOffset());
  const selected = new Set(local.map((s) => s.day * 24 + s.hour));
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="ptg">
      <table className="ptg__table" role="grid" aria-readonly="true" aria-label="Play times in your local time">
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
                return (
                  <td
                    key={d}
                    role="gridcell"
                    aria-label={`${d} ${hourLabel(h)}`}
                    aria-selected={on}
                    className={on ? 'ptg__cell ptg__cell--on' : 'ptg__cell'}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
