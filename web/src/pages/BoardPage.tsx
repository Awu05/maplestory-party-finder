import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { PostType } from '@pf/shared';
import { useBosses, useCharacters, useGuilds, useMe, useRarityTiers, useWorlds } from '../api/hooks';
import { usePosts, type PostFilters } from '../api/postHooks';
import { friendlyError } from '../api/errors';
import { ChipGroup, MenuChip, ToggleChip } from '../components/ui/Chips';
import { PostCard } from '../components/post/PostCard';

export function BoardPage() {
  const me = useMe();
  const mine = useCharacters({ mine: true }, { enabled: !!me.data });
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
