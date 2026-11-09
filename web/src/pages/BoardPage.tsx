import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { PostType } from '@pf/shared';
import { useBosses, useCharacters, useGuilds, useMe, useRarityTiers, useWorlds } from '../api/hooks';
import { usePosts, type PostFilters } from '../api/postHooks';
import { friendlyError } from '../api/errors';
import { PostCard } from '../components/post/PostCard';
import './characters.css';

export function BoardPage() {
  const me = useMe();
  const mine = useCharacters({ mine: true });
  const guilds = useGuilds();
  const worlds = useWorlds();
  const bosses = useBosses();
  const tiers = useRarityTiers();

  const [type, setType] = useState<PostType | ''>('');
  const [bossId, setBossId] = useState('');
  const [difficultyId, setDifficultyId] = useState('');
  const [guildId, setGuildId] = useState('');
  const [when, setWhen] = useState<NonNullable<PostFilters['when']>>('any');
  const [pickedWorlds, setPickedWorlds] = useState<number[] | null>(null);

  // Wait for the session (and the viewer's characters) so the first board request already has its world default.
  const defaultsReady = me.data === null || (me.data !== undefined && (mine.data !== undefined || mine.isError));
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
  const toggleWorld = (id: number) =>
    setPickedWorlds(worldIds.includes(id) ? worldIds.filter((w) => w !== id) : [...worldIds, id]);

  return (
    <section>
      <h1>Board</h1>
      {me.data && (
        <Link className="button" to="/posts/new">
          New post
        </Link>
      )}
      <div className="filters">
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as PostType | '')}>
            <option value="">All</option>
            <option value="lfp">LFP</option>
            <option value="recruiting">Recruiting</option>
          </select>
        </label>
        <label>
          Boss
          <select
            value={bossId}
            onChange={(e) => {
              setBossId(e.target.value);
              setDifficultyId('');
            }}
          >
            <option value="">All bosses</option>
            {bosses.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Difficulty
          <select value={difficultyId} onChange={(e) => setDifficultyId(e.target.value)} disabled={!selectedBoss}>
            <option value="">Any difficulty</option>
            {selectedBoss?.difficulties.map((d) => (
              <option key={d.id} value={d.id}>
                {d.difficulty}
              </option>
            ))}
          </select>
        </label>
        <label>
          Guild
          <select value={guildId} onChange={(e) => setGuildId(e.target.value)}>
            <option value="">All guilds</option>
            {guilds.data?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          When
          <select value={when} onChange={(e) => setWhen(e.target.value as NonNullable<PostFilters['when']>)}>
            <option value="any">Any</option>
            <option value="24h">Next 24h</option>
            <option value="7d">This week</option>
            <option value="flexible">Flexible</option>
          </select>
        </label>
        <fieldset className="world-picker">
          <legend>Worlds</legend>
          {worlds.data?.map((w) => (
            <label key={w.id}>
              <input type="checkbox" checked={worldIds.includes(w.id)} onChange={() => toggleWorld(w.id)} />
              {w.name}
            </label>
          ))}
        </fieldset>
      </div>
      {posts.isError && <p role="alert">{friendlyError(posts.error)}</p>}
      {posts.data && posts.data.length === 0 && <p>No open posts match. Be the first to post!</p>}
      <div className="post-grid">
        {posts.data?.map((p) => (
          <PostCard key={p.id} post={p} tiers={tiers.data ?? []} />
        ))}
      </div>
    </section>
  );
}
