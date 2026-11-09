import type { KeyboardEvent } from 'react';
import { EXPERIENCE_LABELS, classToArchetype, rarityFor } from '@pf/shared';
import type { CharacterDTO, RarityTierDTO } from '@pf/shared';
import { formatCp } from './format';
import './card.css';

export interface BossContextEntry {
  bossDifficultyId: number;
  label: string;
}

interface Props {
  character: CharacterDTO;
  tiers: RarityTierDTO[];
  bossContext?: BossContextEntry[];
  onOpen?: () => void;
}

export function CharacterCard({ character: c, tiers, bossContext, onOpen }: Props) {
  const archetype = classToArchetype(c.jobName);
  const rarity = rarityFor(c.combatPower, tiers);
  const classes = ['card', `card--${archetype}`];
  if (rarity) classes.push(`card--rank-${rarity.rank}`);
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

        {bossContext && bossContext.length > 0 && (
          <ul className="card__context">
            {bossContext.map((b) => {
              const exp = c.bosses.find((x) => x.bossDifficultyId === b.bossDifficultyId)?.experience;
              return (
                <li key={b.bossDifficultyId} className={exp ? `card__badge card__badge--${exp}` : 'card__badge'}>
                  {`${b.label}: ${exp ? EXPERIENCE_LABELS[exp] : 'not listed'}`}
                </li>
              );
            })}
          </ul>
        )}

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
