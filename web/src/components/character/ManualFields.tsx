import type { WorldDTO } from '@pf/shared';

interface Props {
  /** Present only when adding (with the world picker); editing keeps IGN and world fixed. */
  ign?: string;
  onIgn?: (v: string) => void;
  worldId?: string;
  onWorld?: (v: string) => void;
  jobName: string;
  onJob: (v: string) => void;
  level: string;
  onLevel: (v: string) => void;
  classOptions: string[];
  worlds?: WorldDTO[];
}

/** World, class and level (plus IGN when adding) for characters entered by hand. Fully controlled. */
export function ManualFields({
  ign, onIgn, worldId = '', onWorld, jobName, onJob, level, onLevel, classOptions, worlds = [],
}: Props) {
  return (
    <>
      {ign !== undefined && (
        <>
          <label>
            Character name
            <input type="text" value={ign} onChange={(e) => onIgn?.(e.target.value)} />
          </label>
          <label>
            World
            <select value={worldId} onChange={(e) => onWorld?.(e.target.value)}>
              <option value="">Select a world</option>
              {worlds.map((w) => (
                <option key={w.id} value={String(w.id)}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label>
        Class
        <select value={jobName} onChange={(e) => onJob(e.target.value)}>
          <option value="">Select a class</option>
          {classOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Level
        <input type="text" inputMode="numeric" value={level} onChange={(e) => onLevel(e.target.value)} />
      </label>
    </>
  );
}
