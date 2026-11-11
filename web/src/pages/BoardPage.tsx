import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { PostSummaryDTO, PostType } from '@pf/shared';
import { useBosses, useCharacters, useMe, useWorlds } from '../api/hooks';
import { usePosts } from '../api/postHooks';
import { friendlyError } from '../api/errors';
import { ChipGroup, MenuChip } from '../components/ui/Chips';
import { PostRow } from '../components/post/PostRow';
import { PostPreview } from '../components/post/PostPreview';
import { usePhone } from '../hooks/useMediaQuery';

export function BoardPage() {
  const me = useMe();
  const mine = useCharacters({ mine: true }, { enabled: !!me.data });
  const worlds = useWorlds();
  const bosses = useBosses();
  const isPhone = usePhone();

  const [type, setType] = useState<PostType | ''>('');
  const [bossId, setBossId] = useState('');
  const [difficultyId, setDifficultyId] = useState('');
  const [pickedWorld, setPickedWorld] = useState<string | null>(null);

  // Wait for the session (and the viewer's characters) so the first board request already has its world default.
  const defaultsReady = me.isError || me.data === null || (me.data !== undefined && (mine.data !== undefined || mine.isError));
  const defaultWorld = (me.data ? (mine.data ?? []) : []).map((c) => c.world.id).sort((a, b) => a - b)[0];
  const worldId = pickedWorld ?? (defaultWorld === undefined ? '' : String(defaultWorld));

  const posts = usePosts(
    {
      type: type || undefined,
      bossId: bossId ? Number(bossId) : undefined,
      bossDifficultyId: difficultyId ? Number(difficultyId) : undefined,
      worldIds: worldId ? [Number(worldId)] : undefined,
    },
    { enabled: defaultsReady },
  );

  const [params, setParams] = useSearchParams();
  const wanted = params.get('post');
  // The ?post= the board was opened with. Only that deep link may stay selected while it is
  // outside the current list; the user picking another row ends it.
  const deepLink = useRef(wanted);
  // A deep link whose detail fetch failed; the selection then falls back to the first row.
  // Reset when ?post= changes, so a transient error doesn't block that id for good.
  const [unavailable, setUnavailable] = useState<string | null>(null);
  useEffect(() => setUnavailable(null), [wanted]);
  const inList = !!wanted && !!posts.data?.some((p) => p.id === wanted);
  // The deep link stays selected outside the filters; the preview fetches it and says so.
  // Any other id missing from the list (filtered out, closed on refetch) falls back to the first row.
  const keepWanted = !!wanted && (inList || (wanted === deepLink.current && wanted !== unavailable));
  const selectedId = !posts.data ? null : keepWanted ? wanted : (posts.data[0]?.id ?? null);
  // Only ?post= changes; other params are kept. Replace, not push, so Back leaves the board.
  const writePost = (id: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('post', id);
        return next;
      },
      { replace: true },
    );
  // The user picked a row (click or keyboard): the opening deep link no longer applies.
  const select = (id: string) => {
    if (id !== deepLink.current) deepLink.current = null;
    writePost(id);
  };

  const selectedBoss = bosses.data?.find((b) => String(b.id) === bossId);
  const selectedDifficulty = selectedBoss?.difficulties.find((d) => String(d.id) === difficultyId);

  return (
    <section>
      <div className="page__head">
        <h1>Board</h1>
        {me.data && (
          <Link className="btn btn--primary" to="/posts/new">
            New post
          </Link>
        )}
      </div>
      <section className="board-filters" aria-label="Board filters">
        <fieldset className="board-filters__group">
          <legend>Party type</legend>
          <ChipGroup<PostType | ''>
            label="Type"
            value={type}
            onChange={setType}
            options={[
              { value: '', label: 'All' },
              { value: 'recruiting', label: 'Recruiting' },
              { value: 'carrying', label: 'Carrying' },
              { value: 'lfp', label: 'Looking for party' },
            ]}
          />
        </fieldset>
        <fieldset className="board-filters__group">
          <legend>Boss</legend>
          <div className="board-filters__controls">
            <MenuChip
              label="Boss"
              allLabel="All bosses"
              valueLabel={selectedBoss?.name ?? null}
              value={bossId}
              onChange={(v) => { setBossId(v); setDifficultyId(''); }}
              options={(bosses.data ?? []).map((b) => ({ value: String(b.id), label: b.name }))}
            />
            <MenuChip
              label="Difficulty"
              allLabel="Any difficulty"
              valueLabel={selectedDifficulty?.difficulty ?? null}
              value={difficultyId}
              onChange={setDifficultyId}
              disabled={!selectedBoss}
              options={(selectedBoss?.difficulties ?? []).map((d) => ({ value: String(d.id), label: d.difficulty }))}
            />
          </div>
          {!selectedBoss && <p className="board-filters__hint">Choose a boss to select a difficulty.</p>}
        </fieldset>
        <fieldset className="board-filters__group">
          <legend>Location</legend>
          <span className="board-filters__label">Worlds</span>
          <div className="board-filters__worlds">
            <ChipGroup
              label="Worlds"
              value={worldId}
              onChange={setPickedWorld}
              options={[{ value: '', label: 'All' }, ...(worlds.data ?? []).map((world) => ({ value: String(world.id), label: world.name }))]}
            />
          </div>
        </fieldset>
      </section>
      {posts.isError && <p role="alert">{friendlyError(posts.error)}</p>}
      <div className={isPhone ? 'board' : 'board board--split'}>
        <PostList
          posts={posts.data}
          loading={posts.isPending}
          refetching={posts.isPlaceholderData}
          isPhone={isPhone}
          showWorld={worldId === ''}
          selectedId={selectedId}
          wanted={wanted}
          select={select}
          rewrite={writePost}
        />
        {/* With an empty list and nothing deep-linked, the list's empty message says it all. */}
        {!isPhone && !posts.isError && (posts.isPending || selectedId !== null) && (
          <PostPreview
            postId={selectedId}
            loading={posts.isPending}
            outsideFilters={selectedId !== null && !inList && selectedId === wanted}
            onUnavailable={setUnavailable}
          />
        )}
      </div>
    </section>
  );
}

const EMPTY = 'No open posts match. Be the first to post!';

interface PostListProps {
  posts?: PostSummaryDTO[];
  loading: boolean;
  refetching: boolean;
  isPhone: boolean;
  showWorld: boolean;
  selectedId: string | null;
  wanted: string | null;
  /** A user selection (click, keyboard). */
  select: (id: string) => void;
  /** Writes ?post= without counting as a user selection (default row, fallbacks). */
  rewrite: (id: string) => void;
}

function PostList({ posts, loading, refetching, isPhone, showWorld, selectedId, wanted, select, rewrite }: PostListProps) {
  const navigate = useNavigate();
  const rowRefs = useRef(new Map<string, HTMLAnchorElement>());
  const hintId = useId();

  // Write the board's choice back to the URL when it differs from ?post=: the first row by
  // default, or as the fallback for an id that left the list or a deep link that failed to load.
  const needsRewrite = !isPhone && selectedId !== null && wanted !== selectedId;
  useEffect(() => {
    if (needsRewrite && selectedId) rewrite(selectedId);
  }, [needsRewrite, selectedId]); // rewrite is recreated each render; these two decide whether it runs

  // Keep the selection visible, whatever moved it (URL, default, keyboard). Only the list
  // scrolls (scrollIntoView would also scroll the page); rows are offset from the list,
  // which is position: relative in post.css.
  const rowsShown = !loading && !isPhone && !!posts && posts.length > 0;
  useEffect(() => {
    if (!rowsShown || selectedId === null) return;
    const row = rowRefs.current.get(selectedId);
    const list = row?.parentElement;
    if (!row || !list) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [selectedId, rowsShown]);

  const skeletons = [0, 1, 2].map((i) => <div key={i} className="post-row post-row--skeleton" aria-hidden="true" />);
  // Outside the listbox (a listbox may only own options). Desktop branches share this
  // fragment shape so React keeps the same listbox node from loading to loaded.
  const hint = (
    <span id={hintId} className="visually-hidden">
      Press Enter to open the post
    </span>
  );

  if (loading && isPhone) {
    return (
      <div className="post-list" aria-busy="true">
        {skeletons}
      </div>
    );
  }
  if (loading) {
    return (
      <>
        {hint}
        <div className="post-list" role="listbox" aria-label="Posts" aria-describedby={hintId} aria-busy="true">
          {skeletons}
        </div>
      </>
    );
  }
  if (!posts) return null;
  if (posts.length === 0) return <p className="post-list post-list--empty">{EMPTY}</p>;

  if (isPhone) {
    return (
      <ul className="post-list" aria-label="Posts">
        {posts.map((p) => (
          <li key={p.id}>
            <PostRow post={p} selected={false} onSelect={() => {}} asLink showWorld={showWorld} />
          </li>
        ))}
      </ul>
    );
  }

  const onKeyDown = (e: KeyboardEvent<HTMLAnchorElement>, i: number) => {
    let next: number;
    if (e.key === 'ArrowDown') next = Math.min(i + 1, posts.length - 1);
    else if (e.key === 'ArrowUp') next = Math.max(i - 1, 0);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = posts.length - 1;
    else if (e.key === 'Enter') {
      // Modified Enter (new tab/window) falls through to the native link.
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(`/posts/${posts[i].id}`);
      return;
    } else return;
    e.preventDefault();
    const id = posts[next].id;
    select(id);
    rowRefs.current.get(id)?.focus();
  };

  return (
    <>
      {hint}
      <div
        className="post-list"
        role="listbox"
        aria-label="Posts"
        aria-describedby={hintId}
        aria-busy={refetching || undefined}
      >
        {posts.map((p, i) => (
          <PostRow
            key={p.id}
            ref={(el) => {
              if (el) rowRefs.current.set(p.id, el);
              else rowRefs.current.delete(p.id);
            }}
            post={p}
            showWorld={showWorld}
            selected={p.id === selectedId}
            onSelect={() => select(p.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            asLink={false}
          />
        ))}
      </div>
    </>
  );
}
