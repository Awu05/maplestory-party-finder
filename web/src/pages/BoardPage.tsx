import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { PostSummaryDTO, PostType } from '@pf/shared';
import { useBosses, useCharacters, useGuilds, useMe, useWorlds } from '../api/hooks';
import { usePosts, type PostFilters } from '../api/postHooks';
import { friendlyError } from '../api/errors';
import { ChipGroup, MenuChip, ToggleChip } from '../components/ui/Chips';
import { PostRow } from '../components/post/PostRow';
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

  const selectedBoss = bosses.data?.find((b) => String(b.id) === bossId);
  const selectedDifficulty = selectedBoss?.difficulties.find((d) => String(d.id) === difficultyId);
  const toggleWorld = (id: number) =>
    setPickedWorlds(worldIds.includes(id) ? worldIds.filter((w) => w !== id) : [...worldIds, id]);

  return (
    <section>
      <div className="page__head">
        <h1>Board</h1>
        {me.data && (
          <Link className="button" to="/posts/new">
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
        <PostList posts={posts.data} loading={posts.isPending} isPhone={isPhone} />
        {!isPhone && (
          <section className="board__preview panel" aria-label="Post preview">
            <p className="board__placeholder">Pick a post to see its party</p>
          </section>
        )}
      </div>
    </section>
  );
}

const EMPTY = 'No open posts match. Be the first to post!';

function PostList({ posts, loading, isPhone }: { posts?: PostSummaryDTO[]; loading: boolean; isPhone: boolean }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const rowRefs = useRef(new Map<string, HTMLAnchorElement>());
  const wanted = params.get('post');
  const selectedId = posts?.some((p) => p.id === wanted) ? wanted : (posts?.[0]?.id ?? null);

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

  // Default to the first post, and replace a stale id (filtered out, closed, deleted) with it.
  const needsRewrite = !isPhone && selectedId !== null && wanted !== selectedId;
  useEffect(() => {
    if (needsRewrite && selectedId) select(selectedId);
  }, [needsRewrite, selectedId]); // select is recreated each render; these two decide whether it runs

  if (loading) {
    return (
      <div className="post-list" role={isPhone ? undefined : 'listbox'} aria-label="Posts" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="post-row post-row--skeleton" aria-hidden="true" />
        ))}
      </div>
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
    <div className="post-list" role="listbox" aria-label="Posts">
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
  );
}
