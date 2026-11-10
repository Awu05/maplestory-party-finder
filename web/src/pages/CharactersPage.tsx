import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCharacters, useGuilds, useRarityTiers, useWorlds } from '../api/hooks';
import { CharacterCard } from '../components/card/CharacterCard';
import { CardDetailModal } from '../components/card/CardDetailModal';
import { MenuChip } from '../components/ui/Chips';
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
      <div className="page__head">
        <h1>Characters</h1>
      </div>
      <div className="filters">
        <MenuChip
          label="Guild"
          allLabel="All guilds"
          valueLabel={guilds.data?.find((g) => g.id === guildId)?.name ?? null}
          value={guildId}
          onChange={setGuildId}
          options={(guilds.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
        />
        <MenuChip
          label="World"
          allLabel="All worlds"
          valueLabel={worlds.data?.find((w) => String(w.id) === worldId)?.name ?? null}
          value={worldId}
          onChange={setWorldId}
          options={(worlds.data ?? []).map((w) => ({ value: String(w.id), label: w.name }))}
        />
        <MenuChip
          label="Archetype"
          allLabel="All archetypes"
          valueLabel={ARCHETYPE_OPTIONS.find(([v]) => v === archetype)?.[1] ?? null}
          value={archetype}
          onChange={setArchetype}
          options={ARCHETYPE_OPTIONS.map(([v, l]) => ({ value: v, label: l }))}
        />
        <input
          type="search"
          className="filters__search"
          aria-label="Search IGN"
          placeholder="Search IGN"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
