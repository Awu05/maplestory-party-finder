import { beforeEach, describe, expect, it } from 'vitest';
import { addMember, buildTestApp, loginAs, makeBossDifficulty, makeCharacter, makePost, prisma, resetDb } from './helpers.js';

beforeEach(resetDb);

describe('posts schema', () => {
  it('two pending requests for same post+character violate Request_one_pending', async () => {
    const post = await makePost();
    const applicant = await makeCharacter();
    const data = { kind: 'join_request' as const, postId: post.id, characterId: applicant.id, createdByUserId: applicant.ownerId };
    await prisma.request.create({ data });
    await expect(prisma.request.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('a declined request does not block a new pending one', async () => {
    const post = await makePost();
    const applicant = await makeCharacter();
    const data = { kind: 'join_request' as const, postId: post.id, characterId: applicant.id, createdByUserId: applicant.ownerId };
    await prisma.request.create({ data: { ...data, status: 'declined' } });
    await expect(prisma.request.create({ data })).resolves.toMatchObject({ status: 'pending' });
  });

  it('deleting a character nulls PostMember.characterId and Post.posterCharacterId but keeps rows and snapshot', async () => {
    const post = await makePost();
    const joiner = await makeCharacter();
    const member = await addMember(post.id, joiner.id);
    await prisma.character.delete({ where: { id: joiner.id } });
    await prisma.character.delete({ where: { id: post.posterCharacterId! } });
    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id }, include: { members: true } });
    expect(after.posterCharacterId).toBeNull();
    expect(after.members).toHaveLength(2);
    expect(after.members.every((m) => m.characterId === null)).toBe(true);
    const kept = after.members.find((m) => m.id === member.id)!;
    expect(kept.snapshot).toMatchObject({ ign: joiner.ign, jobName: 'Hero' });
    expect(after.members.find((m) => m.role === 'poster')!.cpAtJoin).toBe(1_000_000n);
  });

  it('deleting a boss difficulty used by a post → 409 IN_USE', async () => {
    const { app } = await buildTestApp();
    const admin = await loginAs(app, 'admin-1', 'boss');
    const bd = await makeBossDifficulty();
    await makePost({ bossDifficultyIds: [bd.id] });
    const del = await app.inject({ method: 'DELETE', url: `/api/admin/bosses/${bd.bossId}`, headers: { cookie: admin } });
    expect(del.statusCode).toBe(409);
    expect(del.json().error.code).toBe('IN_USE');
    const patch = await app.inject({ method: 'PATCH', url: `/api/admin/bosses/${bd.bossId}`, headers: { cookie: admin }, payload: { difficulties: [{ difficulty: 'Other', partyCap: 6, sortOrder: 0 }] } });
    expect(patch.statusCode).toBe(409);
    await app.close();
  });
});
