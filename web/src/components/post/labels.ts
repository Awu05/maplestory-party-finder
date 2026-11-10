import type { PostBossDTO, PostSummaryDTO } from '@pf/shared';
import { formatWhen } from './time';

/** "Hard Lucid" */
export const bossLabel = (b: PostBossDTO): string => `${b.difficulty} ${b.bossName}`;

/** "Hard Lucid, Normal Will · Dec 1, 8:00 PM · 2/4" */
export const postLabel = (p: PostSummaryDTO): string =>
  `${p.bosses.map(bossLabel).join(', ')} · ${formatWhen(p.scheduledAt)} · ${p.memberCount}/${p.partySize}`;
