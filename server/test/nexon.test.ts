import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { HttpNexonClient, NexonUnavailableError } from '../src/nexon/client.js';

const fixture = readFileSync(new URL('./fixtures/nexon-lily.json', import.meta.url), 'utf8');

const jsonResponse = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'application/json' } });

const stub = (body: string, status = 200) =>
  vi.fn<typeof fetch>(async () => jsonResponse(body, status));

const rank = (characterName: string) => ({
  characterName,
  level: 200,
  worldID: 1,
  characterImgURL: 'https://msavatar1.nexon.net/x.png',
  jobName: 'Hero',
});

describe('HttpNexonClient', () => {
  it('parses fixture', async () => {
    const fetchStub = stub(fixture);
    const client = new HttpNexonClient({ fetch: fetchStub });
    const result = await client.findByName('lily');
    expect(result).toEqual([
      {
        ign: 'Lily',
        level: 279,
        jobName: 'Angelic Buster',
        nexonWorldId: 1,
        imageUrl: expect.stringMatching(/^https:\/\/msavatar1\.nexon\.net\//),
      },
    ]);
    const [url, init] = fetchStub.mock.calls[0]!;
    expect(String(url)).toContain('reboot_index=0');
    expect(String(url)).toContain('character_name=lily');
    expect((init?.headers as Record<string, string>)['User-Agent']).toBe('party-finder/1.0');
  });

  it('uses the region in the ranking path (default na)', async () => {
    const naStub = stub(JSON.stringify({ ranks: [] }));
    await new HttpNexonClient({ fetch: naStub }).findByName('lily');
    expect(String(naStub.mock.calls[0]![0])).toContain('/ranking/v2/na?');
    const euStub = stub(JSON.stringify({ ranks: [] }));
    await new HttpNexonClient({ fetch: euStub, region: 'eu' }).findByName('lily');
    expect(String(euStub.mock.calls[0]![0])).toContain('/ranking/v2/eu?');
  });

  it('url-encodes the ign', async () => {
    const fetchStub = stub(JSON.stringify({ ranks: [] }));
    await new HttpNexonClient({ fetch: fetchStub }).findByName('a b&c');
    expect(String(fetchStub.mock.calls[0]![0])).toContain('character_name=a%20b%26c');
  });

  it('filters non-exact matches', async () => {
    const client = new HttpNexonClient({
      fetch: stub(JSON.stringify({ ranks: [rank('Lily'), rank('Lilyy')] })),
    });
    const result = await client.findByName('LILY');
    expect(result.map((c) => c.ign)).toEqual(['Lily']);
  });

  it('empty ranks → []', async () => {
    const client = new HttpNexonClient({ fetch: stub(JSON.stringify({ ranks: [] })) });
    expect(await client.findByName('nobody')).toEqual([]);
  });

  it('500 → throws NexonUnavailableError', async () => {
    const client = new HttpNexonClient({ fetch: stub('oops', 500) });
    await expect(client.findByName('lily')).rejects.toBeInstanceOf(NexonUnavailableError);
  });

  it('network error → throws NexonUnavailableError', async () => {
    const client = new HttpNexonClient({
      fetch: vi.fn<typeof fetch>(async () => {
        throw new TypeError('fetch failed');
      }),
    });
    await expect(client.findByName('lily')).rejects.toBeInstanceOf(NexonUnavailableError);
  });

  it('times out a hung request → throws NexonUnavailableError', async () => {
    const hang = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    const client = new HttpNexonClient({ fetch: hang, timeoutMs: 20 });
    await expect(client.findByName('lily')).rejects.toBeInstanceOf(NexonUnavailableError);
  });

  it('wrong-shaped body → throws NexonUnavailableError', async () => {
    const client = new HttpNexonClient({ fetch: stub('{"unexpected":true}') });
    await expect(client.findByName('lily')).rejects.toBeInstanceOf(NexonUnavailableError);
  });

  it('caches within the TTL', async () => {
    const fetchStub = vi.fn<typeof fetch>(async () => jsonResponse(fixture));
    let t = 1_000;
    const client = new HttpNexonClient({ fetch: fetchStub, now: () => t });
    await client.findByName('Lily');
    await client.findByName('LILY');
    expect(fetchStub).toHaveBeenCalledTimes(1);
    t += 600_001;
    await client.findByName('lily');
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });
});

describe('HttpNexonClient fresh option', () => {
  it('fresh:true bypasses the cache read (2 fetches) but still writes it', async () => {
    const fetchStub = stub(JSON.stringify({ ranks: [rank('Lily')] }));
    const client = new HttpNexonClient({ fetch: fetchStub });
    await client.findByName('lily');
    await client.findByName('lily', { fresh: true });
    expect(fetchStub).toHaveBeenCalledTimes(2);
    await client.findByName('lily');
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });
});
