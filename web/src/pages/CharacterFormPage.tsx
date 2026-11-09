import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { BossDTO, CharacterDTO, GuildDTO, NexonCharacterPreview } from '@pf/shared';
import {
  uploadScreenshot,
  useBosses,
  useCharacter,
  useCreateCharacter,
  useGuilds,
  useWorlds,
  useLookupCharacter,
  useUpdateCharacter,
} from '../api/hooks';
import { friendlyError } from '../api/errors';
import { BossExperiencePicker } from '../components/BossExperiencePicker';
import type { BossSelection } from '../components/BossExperiencePicker';
import { PlayTimeGrid } from '../components/PlayTimeGrid';
import './characters.css';

const NOTE_MAX = 300;

interface Details {
  combatPower: number;
  guildId: string;
  bosses: BossSelection[];
  playTimes: number[];
  note: string;
}

interface FormProps {
  initial?: CharacterDTO;
  guilds: GuildDTO[];
  bosses: BossDTO[];
  /** Resolves when saved; a rejection is shown as the form error. */
  onSubmit: (details: Details, screenshot: File | null) => Promise<void>;
}

function DetailsForm({ initial, guilds, bosses, onSubmit }: FormProps) {
  const [cp, setCp] = useState(initial ? String(initial.combatPower) : '');
  const [guildId, setGuildId] = useState(initial?.guild.id ?? '');
  const [picked, setPicked] = useState<BossSelection[]>(
    initial?.bosses.map((b) => ({ bossDifficultyId: b.bossDifficultyId, experience: b.experience })) ?? [],
  );
  const [playTimes, setPlayTimes] = useState<number[]>(initial?.playTimes ?? []);
  const [note, setNote] = useState(initial?.note ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const digits = cp.replace(/,/g, '').trim();
    if (!/^\d+$/.test(digits) || Number(digits) <= 0) return setError('Enter your combat power as a number.');
    if (!guildId) return setError('Pick a guild.');
    setSaving(true);
    try {
      await onSubmit({ combatPower: Number(digits), guildId, bosses: picked, playTimes, note }, file);
    } catch (err) {
      setError(friendlyError(err));
      setSaving(false);
    }
  }

  return (
    <form className="char-form" onSubmit={submit}>
      <label>
        Combat power
        <input type="text" inputMode="numeric" value={cp} onChange={(e) => setCp(e.target.value)} />
      </label>
      <label>
        Guild
        <select value={guildId} onChange={(e) => setGuildId(e.target.value)}>
          <option value="">Select a guild</option>
          {guilds
            .filter((g) => g.active || g.id === initial?.guild.id)
            .map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
        </select>
      </label>
      <div className="full">
        <h3>Bosses</h3>
        <BossExperiencePicker value={picked} onChange={setPicked} bosses={bosses} />
      </div>
      <div className="full">
        <h3>Play times (your time)</h3>
        <PlayTimeGrid value={playTimes} onChange={setPlayTimes} />
      </div>
      <label className="full">
        Note
        <textarea value={note} maxLength={NOTE_MAX} rows={3} onChange={(e) => setNote(e.target.value)} />
        <small>{`${note.length}/${NOTE_MAX}`}</small>
      </label>
      <label className="full">
        Scouter screenshot
        <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {error && (
        <p className="full" role="alert">
          {error}
        </p>
      )}
      <div className="full">
        <button type="submit" disabled={saving}>
          Save
        </button>
      </div>
    </form>
  );
}

/** Uploads the screenshot (if any); a failure becomes a notice shown on the My characters page. */
async function uploadThenNotice(id: string, file: File | null, saved: string) {
  if (!file) return undefined;
  try {
    await uploadScreenshot(id, file);
  } catch (err) {
    return { notice: `${saved}, but the screenshot upload failed: ${friendlyError(err)}` };
  }
  return undefined;
}

function AddCharacter({ guilds, bosses }: { guilds: GuildDTO[]; bosses: BossDTO[] }) {
  const navigate = useNavigate();
  const lookup = useLookupCharacter();
  const create = useCreateCharacter();
  const [ign, setIgn] = useState('');
  const [chosen, setChosen] = useState<NexonCharacterPreview | null>(null);
  const previews = lookup.data;
  // /api/worlds lists only active worlds; a known world missing from it has been deactivated.
  const worlds = useWorlds();
  const activeWorldIds = new Set(worlds.data?.map((w) => w.nexonWorldId));
  const unavailableReason = (p: NexonCharacterPreview): string | null => {
    if (p.worldName === null) return "This world isn't set up yet — ask the admin";
    if (worlds.data && !activeWorldIds.has(p.nexonWorldId)) return `${p.worldName} isn't active right now`;
    return null;
  };

  async function find(e: FormEvent) {
    e.preventDefault();
    if (!ign.trim()) return;
    setChosen(null);
    const result = await lookup.mutateAsync(ign.trim()).catch(() => null);
    if (result?.length === 1 && unavailableReason(result[0]) === null) setChosen(result[0]);
  }

  return (
    <>
      <form onSubmit={find} className="filters">
        <label>
          In-game name
          <input type="text" value={ign} onChange={(e) => setIgn(e.target.value)} />
        </label>
        <button type="submit" disabled={lookup.isPending}>
          Find
        </button>
      </form>
      {lookup.isError && <p role="alert">{friendlyError(lookup.error)}</p>}
      {previews?.length === 0 && <p>No character found with that name.</p>}
      {previews && previews.length > 0 && (
        <div className="previews">
          {previews.map((p) => {
            const reason = unavailableReason(p);
            return (
              <button
                key={`${p.ign}-${p.nexonWorldId}`}
                type="button"
                className="preview"
                disabled={reason !== null}
                aria-pressed={chosen === p}
                onClick={() => setChosen(p)}
              >
                <img src={p.imageUrl} alt="" />
                <strong>{p.ign}</strong>
                <span>{`Lv. ${p.level} ${p.jobName}`}</span>
                <span>{reason ?? p.worldName}</span>
              </button>
            );
          })}
        </div>
      )}
      {chosen && (
        <DetailsForm
          guilds={guilds}
          bosses={bosses}
          onSubmit={async (details, screenshot) => {
            const created = await create.mutateAsync({ ign: chosen.ign, nexonWorldId: chosen.nexonWorldId, ...details });
            const state = await uploadThenNotice(created.id, screenshot, 'Character saved');
            navigate('/me/characters', { state });
          }}
        />
      )}
    </>
  );
}

function EditCharacter({ id, guilds, bosses }: { id: string; guilds: GuildDTO[]; bosses: BossDTO[] }) {
  const navigate = useNavigate();
  const character = useCharacter(id);
  const update = useUpdateCharacter(id);

  if (character.isPending) return <p>Loading…</p>;
  if (character.isError || !character.data) return <p role="alert">Couldn't load this character.</p>;
  return (
    <>
      <h2>{character.data.ign}</h2>
      <DetailsForm
        initial={character.data}
        guilds={guilds}
        bosses={bosses}
        onSubmit={async (details, screenshot) => {
          await update.mutateAsync(details);
          const state = await uploadThenNotice(id, screenshot, 'Changes saved');
          navigate('/me/characters', { state });
        }}
      />
    </>
  );
}

export function CharacterFormPage() {
  const { id } = useParams();
  const guilds = useGuilds();
  const bosses = useBosses();

  if (guilds.isPending || bosses.isPending) return <p>Loading…</p>;
  if (!guilds.data || !bosses.data) return <p role="alert">Couldn't load the form.</p>;

  return (
    <section>
      <h1>{id ? 'Edit character' : 'Add character'}</h1>
      {id ? (
        <EditCharacter id={id} guilds={guilds.data} bosses={bosses.data} />
      ) : (
        <AddCharacter guilds={guilds.data} bosses={bosses.data} />
      )}
    </section>
  );
}
