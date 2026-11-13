import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../http/errors.js';
import { AttemptLimiter, createAuthRequestGuard } from './localAuth.js';
import { email, password } from './passwords.js';
import { hashPassword } from './passwordHash.js';
import type { PasswordResetMailer } from './resetMailer.js';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const RESET_REQUESTED = 'If an account uses that email, a reset link will arrive shortly. Check your spam folder too.';
const invalid = () => new AppError(400, 'RESET_INVALID', 'This reset link is invalid or has expired. Request a new one.');

class ResetDelivery {
  private readonly pending: string[] = [];
  private running: Promise<void> | undefined;

  constructor(private readonly db: PrismaClient, private readonly mailer: PasswordResetMailer, private readonly origin: string, private readonly failed: () => void) {}

  enqueue(address: string): void {
    if (this.pending.length >= 25) throw new AppError(429, 'RESET_BUSY', 'Please try requesting a reset link again shortly.');
    this.pending.push(address);
    if (!this.running) this.running = this.run().finally(() => { this.running = undefined; });
  }

  async close(): Promise<void> {
    this.pending.length = 0;
    await this.running;
  }

  private async run(): Promise<void> {
    while (this.pending.length) {
      const address = this.pending.shift()!;
      let tokenHash: string | undefined;
      try {
        await this.db.passwordResetToken.deleteMany({ where: { expiresAt: { lte: new Date() } } });
        const credential = await this.db.passwordCredential.findUnique({ where: { email: address }, include: { user: true } });
        if (!credential || credential.user.banned || credential.user.deletedAt) continue;
        const token = randomBytes(32).toString('base64url');
        tokenHash = digest(token);
        const data = { tokenHash, expiresAt: new Date(Date.now() + 30 * 60_000), sessionVersion: credential.user.sessionVersion };
        await this.db.passwordResetToken.upsert({ where: { userId: credential.userId }, create: { userId: credential.userId, ...data }, update: data });
        const url = new URL('/reset-password', this.origin);
        url.hash = `token=${token}`;
        await this.mailer.send(address, url.href);
      } catch {
        if (tokenHash) await this.db.passwordResetToken.deleteMany({ where: { tokenHash } }).catch(() => {});
        this.failed();
      }
    }
  }
}

export async function passwordResetRoutes(api: FastifyInstance): Promise<void> {
  const { prisma, config, passwordResetMailer } = api.deps;
  const guard = createAuthRequestGuard(api, 10, true);
  // Reset emails per address per 10 minutes.
  const addresses = new AttemptLimiter(3);
  const delivery = passwordResetMailer ? new ResetDelivery(prisma, passwordResetMailer, new URL(config.webOrigin).origin, () => api.log.warn('Password reset email delivery failed')) : undefined;
  api.addHook('onClose', async () => { await delivery?.close(); });

  api.post('/auth/password/forgot', { bodyLimit: 4096 }, async (req) => {
    await guard(req);
    const input = z.object({ email }).strict().parse(req.body);
    if (!delivery) throw new AppError(503, 'RESET_UNAVAILABLE', 'Password reset email is not available yet. Please contact the administrator.');
    // Over the per-address cap (which stops email-bombing someone), skip sending but answer exactly as
    // usual, so the response never hints at the cap or at whether the email is registered.
    if (addresses.tryTake(input.email)) delivery.enqueue(input.email);
    return { message: RESET_REQUESTED };
  });

  api.post('/auth/password/reset', { bodyLimit: 4096 }, async (req, reply) => {
    await guard(req);
    const input = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password }).strict().parse(req.body);
    const tokenHash = digest(input.token);
    const token = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!token || token.expiresAt <= new Date()) throw invalid();
    const passwordHash = await hashPassword(input.password);
    await prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.deleteMany({ where: { tokenHash, expiresAt: { gt: new Date() } } });
      if (consumed.count !== 1) throw invalid();
      const updated = await tx.user.updateMany({ where: { id: token.userId, sessionVersion: token.sessionVersion, banned: false, deletedAt: null }, data: { sessionVersion: { increment: 1 } } });
      if (updated.count !== 1) throw invalid();
      await tx.passwordCredential.update({ where: { userId: token.userId }, data: { passwordHash } });
    });
    req.session.delete();
    return reply.status(204).send();
  });
}
