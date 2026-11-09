import type { CharacterDTO, PostDetailDTO } from '@pf/shared';
import { formatCp } from '../card/format';
import { overlaps } from './time';

interface Props {
  characters: CharacterDTO[];
  worldId: number;
  post: PostDetailDTO;
  myParties: PostDetailDTO[];
  onPick: (characterId: string) => void;
  disabled?: boolean;
}

export function CharacterPicker({ characters, worldId, post, myParties, onPick, disabled = false }: Props) {
  const eligible = characters.filter((c) => c.world.id === worldId);
  if (eligible.length === 0) return <p>{`None of your characters are on ${post.world.name}.`}</p>;

  const memberIds = new Set(post.members.map((m) => m.characterId));
  const pendingIds = new Set(post.myPending.map((r) => r.character.id));
  const activeParties = myParties.filter(
    (party) => !party.deleted && (party.status === 'open' || party.status === 'full'),
  );

  return (
    <ul aria-label="Pick a character" style={{ listStyle: 'none', padding: 0 }}>
      {eligible.map((c) => {
        const isMember = memberIds.has(c.id);
        const isPending = pendingIds.has(c.id);
        const lowCp = post.minCp !== null && c.combatPower < post.minCp;
        const conflict = activeParties.some(
          (party) => party.members.some((m) => m.characterId === c.id) && overlaps(post.scheduledAt, party.scheduledAt),
        );
        return (
          <li key={c.id}>
            <button type="button" disabled={disabled || isMember || isPending} onClick={() => onPick(c.id)}>
              {`${c.ign} · Lv. ${c.level} ${c.jobName} · CP ${formatCp(c.combatPower)}`}
              {isMember && ' (already in the party)'}
              {isPending && ' (request pending)'}
            </button>
            {lowCp && <span className="post-warn">Below the minimum CP — you can still apply</span>}
            {conflict && <span className="post-warn">Already in a party around this time</span>}
          </li>
        );
      })}
    </ul>
  );
}
