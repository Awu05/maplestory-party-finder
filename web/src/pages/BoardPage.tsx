import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { PostSummaryDTO, PostType } from '@pf/shared';
import { useBosses, useCharacters, useGuilds, useMe, useWorlds } from '../api/hooks';
import { usePosts, type PostFilters } from '../api/postHooks';
import { friendlyError } from '../api/errors';
import { ChipGroup, MenuChip, ToggleChip } from '../components/ui/Chips';
import { PostRow } from '../components/post/PostRow';
import { PostPreview } from '../components/post/PostPreview';
import { useMediaQuery } from '../hooks/useMediaQuery';

export function BoardPage() {
  const me = useMe();
  const mine = useCharacters({ mine: true }, { enabled: !!me.data });
  const guilds = useGuilds();
  const worlds = useWorlds();
  const bosses = useBosses();
  const isPhone = useMediaQuery('(max-width: 640px)');

  const [type, setType] = useState<PostType | ''>('');
  const [bossId, setBossId] = useState('');
  const [difficultyId, setDifficultyId] = useState('');
  const [guildId, setGuildId] = useState('');
  const [when, setWhen] = useState<NonNullable<PostFilters['when']>>('any');
  const [pickedWorlds, setPickedWorlds] = useState<number[] | null>(null);

  // Wait for the session (and the viewer's characters) so the first board request already has its world default.
  const defaultsReady = me.isError || me.data === null || (me.data !== undefined && (mine.data !== undefined || mine.isError));
  const defaultWorlds = [...new Set((me.data ? (mine.data ?? []) : []).map((c) => c.world.id))].sort((a, b) => a - b);
  const worldIds = pickedWorlds ?? defaultWorlds;

  const posts = usePosts(
    {
      type: type || undefined,
      bossId: bossId ? Number(bossId) : undefined,
      bossDifficultyId: difficultyId ? Number(difficultyId) : undefined,
      guildId: guildId || undefined,
      worldIds: worldIds.length > 0 ? worldIds : undefined,
      when,
    },
    { enabled: defaultsReady },
  );

  const [params, setParams] = useSearchParams();
  const wanted = params.get('post');
  // A deep link the detail fetch could not load; only then does the selection fall back to the first row.
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const inList = !!wanted && !!posts.data?.some((p) => p.id === wanted);
  // A ?post= outside the current filters stays selected; the preview fetches it and says so.
  const keepWanted = !!wanted && (inList || wanted !== unavailable);
  const selectedId = !posts.data ? null : keepWanted ? wanted : (posts.data[0]?.id ?? null);
  // Only ?post= changes; other params are kept. Replace, not push, so Back leaves the board.
  const select = (id: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('post', id);
        return next;
      },
      { replace: true },
    );

  const selectedBoss = bosses.data?.find((b) => String(b.id) === bossId);
  const selectedDifficulty = selectedBoss?.difficulties.find((d) => String(d.id) === difficultyId);
  const toggleWorld = (id: number) =>
    setPickedWorlds(worldIds.includes(id) ? worldIds.filter((w) => w !== id) : [...worldIds, id]);

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
      <div className="board-filters">
        <div className="board-filters__group">
          <span className="board-filters__label" aria-hidden="true">
            Type
          </span>
          <ChipGroup<PostType | ''>
          label="Type"
          value={type}
          onChange={setType}
          options={[
            { value: '', label: 'All' },
            { value: 'recruiting', label: 'Recruiting' },
            { value: 'lfp', label: 'LFP' },
          ]}
          />
        </div>
        <div className="board-filters__group">
          <span className="board-filters__label" aria-hidden="true">
            When
          </span>
          <ChipGroup<NonNullable<PostFilters['when']>>
          label="When"
          value={when}
          onChange={setWhen}
          options={[
            { value: 'any', label: 'Any' },
            { value: '24h', label: 'Next 24h' },
            { value: '7d', label: 'This week' },
            { value: 'flexible', label: 'Flexible' },
          ]}
          />
        </div>
        <MenuChip
          label="Boss"
          allLabel="All bosses"
          valueLabel={selectedBoss?.name ?? null}
          value={bossId}
          onChange={(v) => {
            setBossId(v);
            setDifficultyId('');
          }}
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
        <MenuChip
          label="Guild"
          allLabel="All guilds"
          valueLabel={guilds.data?.find((g) => g.id === guildId)?.name ?? null}
          value={guildId}
          onChange={setGuildId}
          options={(guilds.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
        />
        <div className="board-filters__group">
          <span className="board-filters__label" aria-hidden="true">
            Worlds
          </span>
          <div role="group" aria-label="Worlds" className="board-filters__worlds">
            {worlds.data?.map((w) => (
              <ToggleChip key={w.id} pressed={worldIds.includes(w.id)} onToggle={() => toggleWorld(w.id)}>
                {w.name}
              </ToggleChip>
            ))}
          </div>
        </div>
      </div>
      {posts.isError && <p role="alert">{friendlyError(posts.error)}</p>}
      <div className={isPhone ? 'board' : 'board board--split'}>
        <PostList
          posts={posts.data}
          loading={posts.isPending}
          refetching={posts.isPlaceholderData}
          isPhone={isPhone}
          selectedId={selectedId}
          wanted={wanted}
          select={select}
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
  selectedId: string | null;
  wanted: string | null;
  select: (id: string) => void;
}

function PostList({ posts, loading, refetching, isPhone, selectedId, wanted, select }: PostListProps) {
  const navigate = useNavigate();
  const rowRefs = useRef(new Map<string, HTMLAnchorElement>());
  const hintId = useId();

  // Default to the first post, and replace a stale id (filtered out, closed, deleted) with it.
  const needsRewrite = !isPhone && selectedId !== null && wanted !== selectedId;
  useEffect(() => {
    if (needsRewrite && selectedId) select(selectedId);
  }, [needsRewrite, selectedId]); // select is recreated each render; these two decide whether it runs

  // Keep the selection visible in the scrolling list, whatever moved it (URL, default, keyboard).
  const rowsShown = !loading && !isPhone && !!posts && posts.length > 0;
  useEffect(() => {
    if (!rowsShown || selectedId === null) return;
    const row = rowRefs.current.get(selectedId);
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
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
            <PostRow post={p} selected={false} onSelect={() => {}} asLink />
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
