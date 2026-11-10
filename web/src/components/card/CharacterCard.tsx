import type { KeyboardEvent } from 'react';
import { rarityFor } from '@pf/shared';
import type { CharacterDTO, RarityTierDTO } from '@pf/shared';
import { formatCp } from './format';
import './card.css';

interface Props {
  character: CharacterDTO;
  tiers: RarityTierDTO[];
  onOpen?: () => void;
}

export function CharacterCard({ character: c, tiers, onOpen }: Props) {
  const archetype = c.archetype;
  const rarity = rarityFor(c.combatPower, tiers);
  const classes = ['card', `card--${archetype}`];
  if (rarity) classes.push(`card--rank-${rarity.rank}`);
  // Count-independent hook so every rank >= 3 gets the highest non-top finish, however many tiers exist.
  if (rarity && rarity.rank >= 3) classes.push('card--rank-high');
  if (rarity?.isTop) classes.push('card--foil');

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen?.();
    }
  };
  const interactive = onOpen
    ? { role: 'button', tabIndex: 0, onClick: onOpen, onKeyDown }
    : { role: 'figure' };

  return (
    <div className={classes.join(' ')} aria-label={`${c.ign}, level ${c.level} ${c.jobName}`} {...interactive}>
      <div className="card__inner">
        <header className="card__name-bar">
          <span className="card__ign">{c.ign}</span>
          <span className="card__level">Lv. {c.level}</span>
        </header>

        <div className="card__art">
          <img className="card__sprite" src={c.imageUrl} alt={c.ign} loading="lazy" />
          {rarity && <span className="card__rarity">{rarity.tier.name}</span>}
        </div>

        <dl className="card__stats">
          <div className="card__attack">
            <dt className="card__job">
              <span className="card__energy" aria-hidden="true" />
              {c.jobName}
            </dt>
            <dd className="card__cp">
              <span>{formatCp(c.combatPower)}</span>
              <small>CP</small>
            </dd>
          </div>
          <div className="card__meta">
            <dt>Guild</dt>
            <dd>{c.guild.name}</dd>
          </div>
          <div className="card__meta">
            <dt>World</dt>
            <dd>{c.world.name}</dd>
          </div>
        </dl>

        <footer className="card__footer">
          <span className="card__footer-label">Discord</span> <span className="card__discord">{c.owner.discordUsername}</span>
        </footer>
      </div>
    </div>
  );
}
