import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/http/errors.js';
import { loadPostForUpdate } from '../src/posts/service.js';
import { addMember, makeBossDifficulty, makeCharacter, makePost, prisma, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('loadPostForUpdate', () => {
  it('returns the post with members inside a transaction', async () => {
    const bd = await makeBossDifficulty();
    const p = await makePost({ bossDifficultyIds: [bd.id] });
    await addMember(p.id, (await makeCharacter()).id);
    const row = await prisma.$transaction((tx) => loadPostForUpdate(tx, p.id));
    expect(row.id).toBe(p.id);
    expect(row.members).toHaveLength(2);
    expect(row.bosses).toHaveLength(1);
  });

  it('unknown id -> 404 NOT_FOUND', async () => {
    const err = await prisma.$transaction((tx) => loadPostForUpdate(tx, 'nope')).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('blocks a second locker until the first transaction commits', async () => {
    const p = await makePost();
    const order: string[] = [];
    let aLocked!: () => void;
    const locked = new Promise<void>((r) => (aLocked = r));
    const opts = { timeout: 15_000, maxWait: 15_000 };

    const a = prisma.$transaction(async (tx) => {
      await loadPostForUpdate(tx, p.id);
      order.push('A locked');
      aLocked();
      await sleep(500);
      order.push('A done');
    }, opts);
    await locked;
    const b = prisma.$transaction(async (tx) => {
      await loadPostForUpdate(tx, p.id);
      order.push('B locked');
    }, opts);
    await Promise.all([a, b]);
    expect(order).toEqual(['A locked', 'A done', 'B locked']);
  });
});
