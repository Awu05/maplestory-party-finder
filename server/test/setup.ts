import { afterAll } from 'vitest';
import { prisma } from './helpers.js';

afterAll(async () => {
  await prisma.$disconnect();
});
