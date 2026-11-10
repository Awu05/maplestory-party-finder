import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCharacters, useDeleteCharacter, useMe, useRarityTiers, useRefreshCharacter } from '../api/hooks';
import { friendlyError } from '../api/errors';
import { CharacterCard } from '../components/card/CharacterCard';
import './characters.css';

function Actions({ id, onMessage }: { id: string; onMessage: (m: string) => void }) {
  const navigate = useNavigate();
  const refresh = useRefreshCharacter(id);
  const del = useDeleteCharacter();
  return (
    <div className="actions my-card__actions">
      <button type="button" className="btn btn--secondary" onClick={() => navigate(`/me/characters/${id}/edit`)}>
        Edit
      </button>
      <button
        type="button"
        className="btn btn--secondary"
        disabled={refresh.isPending}
        onClick={() => {
          onMessage('');
          refresh.mutate(undefined, {
            onSuccess: (c) =>
              onMessage(
                c.syncStatus === 'stale' ? "Couldn't reach Nexon — showing last known data" : 'Synced from Nexon',
              ),
            onError: (e) => onMessage(friendlyError(e)),
          });
        }}
      >
        Refresh from Nexon
      </button>
      <button
        type="button"
        className="btn btn--danger"
        disabled={del.isPending}
        onClick={() => {
          if (!window.confirm('Delete this character?')) return;
          del.mutate(id, { onError: (e) => onMessage(friendlyError(e)) });
        }}
      >
        Delete
      </button>
    </div>
  );
}

export function MyCharactersPage() {
  const me = useMe();
  const location = useLocation();
  const tiers = useRarityTiers();
  const characters = useCharacters({ mine: true });
  const [message, setMessage] = useState((location.state as { notice?: string } | null)?.notice ?? '');

  if (me.isPending) return <p>Loading…</p>;
  if (!me.data) {
    return (
      <section>
        <div className="page__head">
          <h1>My characters</h1>
        </div>
        <p>Log in with Discord to manage your characters.</p>
        <a className="btn btn--primary" href="/api/auth/discord">
          Log in with Discord
        </a>
      </section>
    );
  }

  return (
    <section>
      <div className="page__head">
        <h1>My characters</h1>
        <Link className="btn btn--primary" to="/me/characters/new">
          Add character
        </Link>
      </div>
      {message && <p role="alert">{message}</p>}
      {characters.data?.length === 0 && <p>You haven't added any characters yet.</p>}
      <div className="card-grid">
        {characters.data?.map((c) => (
          <div key={c.id} className="my-card">
            <CharacterCard character={c} tiers={tiers.data ?? []} />
            <Actions id={c.id} onMessage={setMessage} />
          </div>
        ))}
      </div>
    </section>
  );
}
