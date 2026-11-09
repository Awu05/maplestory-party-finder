import { z } from 'zod';

export interface NexonCharacter {
  ign: string;
  level: number;
  jobName: string;
  imageUrl: string;
  nexonWorldId: number;
}

export interface NexonClient {
  /** Exact case-insensitive name matches (possibly several worlds); [] when not found. */
  findByName(ign: string): Promise<NexonCharacter[]>;
}

export class NexonUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NexonUnavailableError';
  }
}

const responseSchema = z.object({
  ranks: z.array(
    z.object({
      characterName: z.string(),
      level: z.number(),
      jobName: z.string(),
      worldID: z.number(),
      characterImgURL: z.string(),
    }),
  ),
});

const ENDPOINT = 'https://www.nexon.com/api/maplestory/no-auth/ranking/v2/na';

export class HttpNexonClient implements NexonClient {
  private readonly fetchFn: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, { expires: number; value: NexonCharacter[] }>();

  constructor(opts: { fetch?: typeof fetch; cacheTtlMs?: number; now?: () => number; timeoutMs?: number }) {
    this.fetchFn = opts.fetch ?? fetch;
    this.cacheTtlMs = opts.cacheTtlMs ?? 600_000;
    this.now = opts.now ?? Date.now;
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  async findByName(ign: string): Promise<NexonCharacter[]> {
    const key = ign.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && hit.expires > this.now()) return hit.value;

    const value = await this.fetchCharacters(ign);
    this.cache.set(key, { expires: this.now() + this.cacheTtlMs, value });
    return value;
  }

  private async fetchCharacters(ign: string): Promise<NexonCharacter[]> {
    const url = `${ENDPOINT}?type=overall&id=weekly&reboot_index=0&page_index=1&character_name=${encodeURIComponent(ign)}`;
    let body: unknown;
    try {
      const res = await this.fetchFn(url, {
        headers: { 'User-Agent': 'party-finder/1.0' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new NexonUnavailableError(`Nexon responded ${res.status}`);
      body = await res.json();
    } catch (err) {
      if (err instanceof NexonUnavailableError) throw err;
      throw new NexonUnavailableError('Nexon request failed', { cause: err });
    }

    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) {
      throw new NexonUnavailableError('Unexpected Nexon response shape', { cause: parsed.error });
    }
    const lower = ign.toLowerCase();
    return parsed.data.ranks
      .filter((r) => r.characterName.toLowerCase() === lower)
      .map((r) => ({
        ign: r.characterName,
        level: r.level,
        jobName: r.jobName,
        imageUrl: r.characterImgURL,
        nexonWorldId: r.worldID,
      }));
  }
}
