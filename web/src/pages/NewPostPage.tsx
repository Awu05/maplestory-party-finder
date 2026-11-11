import { useId, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { POST_TYPE_LABELS, freeSlotCoverageForViewer, freeSlotsForViewer, maxPartySizeFor } from '@pf/shared';
import type { BossDTO, CharacterDTO, PostDetailDTO, PostType } from '@pf/shared';
import { useBosses, useCharacters, useMe } from '../api/hooks';
import { useCreatePost, usePost, useUpdatePost } from '../api/postHooks';
import type { UpdatePostInput } from '../api/postHooks';
import { friendlyError } from '../api/errors';
import { BossMultiPicker } from '../components/post/BossMultiPicker';
import { FreeTimeGrid } from '../components/post/FreeTimeGrid';
import { browserTimeZone } from '../lib/timeZone';
import './characters.css';

const NOTE_MAX = 300;
const DEFAULT_PARTY_SIZE = 4;

interface Values {
  type: PostType;
  characterId: string;
  bossIds: number[];
  freeTimes: number[];
  partySize: number;
  minCp: string;
  note: string;
}

function sizeRange(bosses: BossDTO[], bossIds: number[], lowest: number) {
  const caps = bosses.flatMap((b) => b.difficulties.filter((d) => bossIds.includes(d.id)).map((d) => d.partyCap));
  return { lo: lowest, hi: Math.max(lowest, maxPartySizeFor(caps)) };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function valuesFromPost(post: PostDetailDTO, editingZone: string): Values {
  return {
    type: post.type,
    characterId: post.poster.characterId ?? '',
    bossIds: post.bosses.map((b) => b.bossDifficultyId),
    // Use the chosen editing zone, preserving quarter-hour-offset selections when needed.
    freeTimes: post.freeTimesZone
      ? freeSlotsForViewer(post.freeTimes, post.freeTimesZone, editingZone, new Date())
      : [],
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

function changedFields(v: Values, orig: Values, editingZone: string): UpdatePostInput {
  const out: UpdatePostInput = {};
  if (v.type !== orig.type) out.type = v.type;
  if (v.characterId !== orig.characterId) out.characterId = v.characterId;
  if (!sameSet(v.bossIds, orig.bossIds)) out.bossDifficultyIds = v.bossIds;
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
  if (!sameSet(v.freeTimes, orig.freeTimes)) {
    out.freeTimes = v.freeTimes;
    out.freeTimesZone = v.freeTimes.length > 0 ? editingZone : null;
  }
  return out;
}

const EMPTY: Values = {
  type: 'recruiting',
  characterId: '',
  bossIds: [],
  freeTimes: [],
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
  const browserZone = browserTimeZone();
  const hasPartialSlots = useMemo(() => {
    if (!post?.freeTimesZone) return false;
    const coverage = [...freeSlotCoverageForViewer(post.freeTimes, post.freeTimesZone, browserZone, new Date()).values()];
    const quarters = coverage.reduce((sum, mask) => sum + Number(Boolean(mask & 1)) + Number(Boolean(mask & 2)), 0);
    return coverage.some((mask) => mask !== 3) || quarters !== post.freeTimes.length * 2;
  }, [post?.freeTimes, post?.freeTimesZone, browserZone]);
  const editingZone = hasPartialSlots ? post!.freeTimesZone! : browserZone;
  const orig = post ? valuesFromPost(post, editingZone) : EMPTY;
  const [v, setV] = useState<Values>(orig);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const freeHintId = useId();

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
    const cp = v.type === 'recruiting' ? parseCp(v.minCp) : null;
    if (cp !== null && (Number.isNaN(cp) || cp <= 0)) return setError('Enter the minimum combat power as a number.');

    setSaving(true);
    try {
      if (post) {
        const changes = changedFields(v, orig, editingZone);
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
          freeTimes: v.freeTimes,
          freeTimesZone: v.freeTimes.length > 0 ? browserTimeZone() : null,
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
      {!post && <p className="post-form__expiry">Posts without a finalized time expire 7 days after creation. You can renew your post for 7 days from the time you renew it.</p>}
      <div>
        <div role="group" aria-label="Post type" className="actions">
          {(['recruiting', 'lfp'] as const).map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={v.type === t} disabled={locked} onClick={() => set({ type: t })}>
              {POST_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        {locked && <small>Can't change while others are in the party</small>}
      </div>
      <label>
        Character
        <select value={v.characterId} disabled={locked} onChange={(e) => set({ characterId: e.target.value })}>
          <option value="">Select a character</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>{`${c.ign} (${c.world.name})`}</option>
          ))}
        </select>
      </label>
      <div>
        <h3>Bosses</h3>
        <BossMultiPicker value={v.bossIds} onChange={setBosses} bosses={bosses} />
      </div>
      <div>
        <h3>When you're free</h3>
        <small id={freeHintId}>Leave empty if you're flexible</small>
        {editingZone !== browserZone && <p><small>Editing availability in {editingZone} to preserve your selected times.</small></p>}
        <FreeTimeGrid
          label="When you're free"
          describedBy={freeHintId}
          value={v.freeTimes}
          onChange={(freeTimes) => set({ freeTimes })}
        />
      </div>
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
      <div>
        <label>
          Note
          <textarea value={v.note} maxLength={NOTE_MAX} rows={3} onChange={(e) => set({ note: e.target.value })} />
        </label>
        <small>{`${v.note.length}/${NOTE_MAX}`}</small>
      </div>
      {error && (
        <p role="alert">
          {error}
        </p>
      )}
      <div>
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
