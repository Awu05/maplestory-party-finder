import type { PostBossDTO } from '@pf/shared';

/** "Hard Lucid" */
export const bossLabel = (b: PostBossDTO): string => `${b.difficulty} ${b.bossName}`;
