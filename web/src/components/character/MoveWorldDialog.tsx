import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MouseEvent, SyntheticEvent } from 'react';
import type { CharacterDTO, WorldCandidateDTO } from '@pf/shared';
import { friendlyError } from '../../api/errors';
import { useGuilds, useMoveCharacter } from '../../api/hooks';
import './character.css';

interface Props {
  character: CharacterDTO;
  candidates: WorldCandidateDTO[];
  onClose: () => void;
  onMoved: (c: CharacterDTO) => void;
}

export function MoveWorldDialog({ character, candidates, onClose, onMoved }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const guilds = useGuilds();
  const move = useMoveCharacter(character.id);
  const [worldId, setWorldId] = useState<number | null>(candidates.length === 1 ? candidates[0].worldId : null);
  const [guildId, setGuildId] = useState('');
  const [error, setError] = useState('');

  // Only active guilds that play the target world; none until a world is picked.
  const guildOptions = useMemo(
    () =>
      worldId === null
        ? []
        : (guilds.data ?? [])
            .filter((g) => g.active && g.worldIds.includes(worldId))
            .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
    [guilds.data, worldId],
  );
  const pickWorld = (id: number) => {
    setWorldId(id);
    // A guild picked for another world doesn't apply to this one.
    if (guildId && !(guilds.data ?? []).some((g) => g.id === guildId && g.worldIds.includes(id))) setGuildId('');
  };

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    d.querySelector<HTMLElement>('select, input')?.focus();
    return () => {
      if (d.open) d.close();
    };
  }, []);

  const onCancel = (e: SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    onClose();
  };
  const onDialogClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const submit = () => {
    if (worldId === null) return;
    setError('');
    move.mutate(
      { worldId, guildId: guildId || null },
      { onSuccess: onMoved, onError: (e) => setError(friendlyError(e)) },
    );
  };

  const single = candidates.length === 1 ? candidates[0] : null;

  return (
    <dialog
      ref={ref}
      className="move-dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      onCancel={onCancel}
      onClick={onDialogClick}
    >
      <div className="move-dialog__content">
        <h2 id={headingId}>
          {single
            ? `${character.ign} was found on ${single.worldName}. Update your character to it?`
            : `${character.ign} was found on more than one world. Update your character to which?`}
        </h2>

        {!single && (
          <fieldset className="move-dialog__worlds">
            <legend>World</legend>
            {candidates.map((c) => (
              <label key={c.worldId} className="move-dialog__world">
                <input
                  type="radio"
                  name="move-world"
                  checked={worldId === c.worldId}
                  onChange={() => pickWorld(c.worldId)}
                />
                <span>
                  {c.worldName} · Lv {c.level} {c.jobName}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <label className="move-dialog__field">
          Guild (optional)
          <select value={guildId} onChange={(e) => setGuildId(e.target.value)}>
            <option value="">No guild</option>
            {guildOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        {guilds.isError && <p role="alert">Couldn't load guilds. You can still update with No guild.</p>}

        {error && <p role="alert">{error}</p>}

        <div className="actions">
          <button type="button" className="btn btn--primary" disabled={worldId === null || move.isPending} onClick={submit}>
            Update
          </button>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Not now
          </button>
        </div>
      </div>
    </dialog>
  );
}
