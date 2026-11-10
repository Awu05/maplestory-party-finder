import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MAX_POST_BOSSES, POST_TYPE_LABELS, maxPartySizeFor } from '@pf/shared';
import type { BossDTO, CharacterDTO, PostDetailDTO, PostType } from '@pf/shared';
import { useBosses, useCharacters, useMe } from '../api/hooks';
import { useCreatePost, usePost, useUpdatePost } from '../api/postHooks';
import type { UpdatePostInput } from '../api/postHooks';
import { friendlyError } from '../api/errors';
import { BossMultiPicker } from '../components/post/BossMultiPicker';
import { localInputToUtcIso, utcIsoToLocalInput } from '../components/post/time';
import './characters.css';

const NOTE_MAX = 300;
const DEFAULT_PARTY_SIZE = 4;

interface Values {
  type: PostType;
  characterId: string;
  bossIds: number[];
  when: string;
  flexible: boolean;
  partySize: number;
  minCp: string;
  note: string;
}

function sizeRange(bosses: BossDTO[], bossIds: number[], lowest: number) {
  const caps = bosses.flatMap((b) => b.difficulties.filter((d) => bossIds.includes(d.id)).map((d) => d.partyCap));
  return { lo: lowest, hi: Math.max(lowest, maxPartySizeFor(caps)) };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function valuesFromPost(post: PostDetailDTO): Values {
  return {
    type: post.type,
    characterId: post.poster.characterId ?? '',
    bossIds: post.bosses.map((b) => b.bossDifficultyId),
    when: post.scheduledAt ? utcIsoToLocalInput(post.scheduledAt) : '',
    flexible: post.scheduledAt === null,
    partySize: post.partySize ?? DEFAULT_PARTY_SIZE,
    minCp: post.minCp === null ? '' : post.minCp.toLocaleString('en-US'),
    note: post.note,
  };
}

/** Parses the Min CP text: null when blank, NaN when invalid. */
function parseCp(text: string): number | null {
  const digits = text.replace(/,/g, '').trim();
  if (digits === '') return null;
  return /^\d+$/.test(digits) ? Number(digits) : NaN;
}

const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));

function timeChanged(v: Values, orig: Values) {
  return v.flexible !== orig.flexible || (!v.flexible && v.when !== orig.when);
}

function changedFields(v: Values, orig: Values): UpdatePostInput {
  const out: UpdatePostInput = {};
  if (v.type !== orig.type) out.type = v.type;
  if (v.characterId !== orig.characterId) out.characterId = v.characterId;
  if (!sameSet(v.bossIds, orig.bossIds)) out.bossDifficultyIds = v.bossIds;
  if (timeChanged(v, orig)) out.scheduledAt = v.flexible ? null : localInputToUtcIso(v.when);
  if (v.type === 'recruiting') {
    const cp = parseCp(v.minCp);
    if (v.type !== orig.type) {
      // Switching to recruiting: the server requires partySize.
      out.partySize = v.partySize;
      if (cp !== null) out.minCp = cp;
    } else {
      if (v.partySize !== orig.partySize) out.partySize = v.partySize;
      if (cp !== parseCp(orig.minCp)) out.minCp = cp;
    }
  }
  if (v.note !== orig.note) out.note = v.note;
  return out;
}

const EMPTY: Values = {
  type: 'recruiting',
  characterId: '',
  bossIds: [],
  when: '',
  flexible: false,
  partySize: DEFAULT_PARTY_SIZE,
  minCp: '',
  note: '',
};

interface FormProps {
  characters: CharacterDTO[];
  bosses: BossDTO[];
  post?: PostDetailDTO;
}

function PostForm({ characters, bosses, post }: FormProps) {
  const navigate = useNavigate();
  const create = useCreatePost();
  const update = useUpdatePost(post?.id ?? '');
  const orig = post ? valuesFromPost(post) : EMPTY;
  const [v, setV] = useState<Values>(orig);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const locked = !!post && post.memberCount > 1;
  const lowest = post ? Math.max(2, post.memberCount) : 2;
  const { lo, hi } = sizeRange(bosses, v.bossIds, lowest);
  const sizes = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

  const set = (patch: Partial<Values>) => setV((cur) => ({ ...cur, ...patch }));
  const setBosses = (bossIds: number[]) => {
    const range = sizeRange(bosses, bossIds, lowest);
    setV((cur) => ({ ...cur, bossIds, partySize: clamp(cur.partySize, range.lo, range.hi) }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    // A deleted poster character (blank on edit) stays blank unless the user picks another.
    if (!v.characterId && !(post && orig.characterId === '')) return setError('Pick a character.');
    if (v.bossIds.length === 0) return setError('Pick at least one boss.');
    // An edited post keeps its already-scheduled time unvalidated unless the time was changed.
    if (!v.flexible && (!post || timeChanged(v, orig))) {
      if (!v.when) return setError('Pick a time, or tick Flexible.');
      if (new Date(localInputToUtcIso(v.when)).getTime() <= Date.now()) return setError('Pick a time in the future.');
    }
    const cp = v.type === 'recruiting' ? parseCp(v.minCp) : null;
    if (cp !== null && (Number.isNaN(cp) || cp <= 0)) return setError('Enter the minimum combat power as a number.');

    setSaving(true);
    try {
      if (post) {
        const changes = changedFields(v, orig);
        if (Object.keys(changes).length === 0) {
          setSaving(false);
          return setError('No changes to save.');
        }
        await update.mutateAsync(changes);
        navigate(`/posts/${post.id}`);
      } else {
        const created = await create.mutateAsync({
          type: v.type,
          characterId: v.characterId,
          bossDifficultyIds: v.bossIds,
          scheduledAt: v.flexible ? null : localInputToUtcIso(v.when),
          ...(v.type === 'recruiting' ? { partySize: v.partySize, ...(cp !== null ? { minCp: cp } : {}) } : {}),
          note: v.note,
        });
        navigate(`/posts/${created.id}`);
      }
    } catch (err) {
      setError(friendlyError(err));
      setSaving(false);
    }
  }

  return (
    <form className="char-form" onSubmit={submit}>
      <div className="full">
        <div role="group" aria-label="Post type" className="actions">
          {(['recruiting', 'lfp'] as const).map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={v.type === t} disabled={locked} onClick={() => set({ type: t })}>
              {POST_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        {locked && <small>Can't change while others are in the party</small>}
      </div>
      <label className="full">
        Character
        <select value={v.characterId} disabled={locked} onChange={(e) => set({ characterId: e.target.value })}>
          <option value="">Select a character</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>{`${c.ign} (${c.world.name})`}</option>
          ))}
        </select>
      </label>
      <div className="full">
        <h3>Bosses</h3>
        <BossMultiPicker value={v.bossIds} onChange={setBosses} bosses={bosses} max={MAX_POST_BOSSES} />
      </div>
      <label>
        When
        <input
          type="datetime-local"
          value={v.flexible ? '' : v.when}
          disabled={v.flexible}
          onChange={(e) => set({ when: e.target.value })}
        />
      </label>
      <label>
        <span>
          <input type="checkbox" checked={v.flexible} onChange={(e) => set({ flexible: e.target.checked })} /> Flexible
        </span>
      </label>
      {v.type === 'recruiting' && (
        <>
          <label>
            Party size
            <select value={v.partySize} onChange={(e) => set({ partySize: Number(e.target.value) })}>
              {sizes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            Min CP
            <input type="text" inputMode="numeric" value={v.minCp} onChange={(e) => set({ minCp: e.target.value })} />
          </label>
        </>
      )}
      <div className="full">
        <label>
          Note
          <textarea value={v.note} maxLength={NOTE_MAX} rows={3} onChange={(e) => set({ note: e.target.value })} />
        </label>
        <small>{`${v.note.length}/${NOTE_MAX}`}</small>
      </div>
      {error && (
        <p className="full" role="alert">
          {error}
        </p>
      )}
      <div className="full">
        <button type="submit" className="btn btn--primary" disabled={saving}>
          Save
        </button>
      </div>
    </form>
  );
}

export function NewPostPage() {
  const { id } = useParams();
  const me = useMe();
  const characters = useCharacters({ mine: true }, { enabled: !!me.data });
  const bosses = useBosses();
  const post = usePost(id);
  const heading = <h1>{id ? 'Edit post' : 'New post'}</h1>;

  if (me.isPending) return <p>Loading…</p>;
  if (!me.data) {
    return (
      <section>
        {heading}
        <p>Log in with Discord to post.</p>
        <a className="btn btn--primary" href="/api/auth/discord">
          Log in with Discord
        </a>
      </section>
    );
  }
  if (characters.isPending || bosses.isPending || (id && post.isPending)) return <p>Loading…</p>;
  if (!characters.data || !bosses.data || (id && !post.data)) return <p role="alert">Couldn't load the form.</p>;

  if (id && post.data && !post.data.isPoster) {
    return (
      <section>
        {heading}
        <p>Only the poster can edit this post.</p>
      </section>
    );
  }
  if (characters.data.length === 0) {
    return (
      <section>
        {heading}
        <Link to="/me/characters/new">Add a character first</Link>
      </section>
    );
  }

  return (
    <section>
      {heading}
      <PostForm characters={characters.data} bosses={bosses.data} post={id ? post.data : undefined} />
    </section>
  );
}
