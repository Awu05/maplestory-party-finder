import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCharacters, useGuilds, useRarityTiers, useWorlds } from '../api/hooks';
import { CharacterCard } from '../components/card/CharacterCard';
import { CardDetailModal } from '../components/card/CardDetailModal';
import './characters.css';

const ARCHETYPE_OPTIONS = [
  ['warrior', 'Warrior'],
  ['magician', 'Magician'],
  ['bowman', 'Bowman'],
  ['thief', 'Thief'],
  ['pirate', 'Pirate'],
  ['xenon', 'Xenon'],
] as const;

export function CharactersPage() {
  const navigate = useNavigate();
  const [guildId, setGuildId] = useState('');
  const [worldId, setWorldId] = useState('');
  const [archetype, setArchetype] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const guilds = useGuilds();
  const worlds = useWorlds();
  const tiers = useRarityTiers();
  const characters = useCharacters({
    guildId: guildId || undefined,
    worldId: worldId ? Number(worldId) : undefined,
    archetype: archetype || undefined,
    q: q || undefined,
  });
  const opened = characters.data?.find((c) => c.id === openId);

  return (
    <section>
      <h1>Characters</h1>
      <div className="filters">
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
          World
          <select value={worldId} onChange={(e) => setWorldId(e.target.value)}>
            <option value="">All worlds</option>
            {worlds.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Archetype
          <select value={archetype} onChange={(e) => setArchetype(e.target.value)}>
            <option value="">All archetypes</option>
            {ARCHETYPE_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search IGN
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      {characters.isError && <p role="alert">Couldn't load characters.</p>}
      {characters.isPending && <p>Loading…</p>}
      {characters.data?.length === 0 && <p>No characters match.</p>}
      <div className="card-grid">
        {characters.data?.map((c) => (
          <CharacterCard key={c.id} character={c} tiers={tiers.data ?? []} onOpen={() => setOpenId(c.id)} />
        ))}
      </div>

      {opened && (
        <CardDetailModal
          character={opened}
          tiers={tiers.data ?? []}
          onClose={() => setOpenId(null)}
          onEdit={() => navigate(`/me/characters/${opened.id}/edit`)}
        />
      )}
    </section>
  );
}
