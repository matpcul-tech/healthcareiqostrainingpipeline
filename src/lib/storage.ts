import { Redis } from '@upstash/redis';

const KEY = 'sovereign-health-master';
const COUNT_KEY = 'sovereign-health-master-count';

let cached: Redis | null | undefined;

function getRedis(): Redis | null {
  if (cached !== undefined) return cached;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    cached = null;
    return null;
  }
  cached = new Redis({ url, token, automaticDeserialization: false });
  return cached;
}

async function readCount(redis: Redis): Promise<number> {
  const raw = await redis.get<string>(COUNT_KEY);
  const parsed = typeof raw === 'string' ? Number(raw) : Number(raw ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function appendPairs(
  jsonl: string,
  addedCount: number,
): Promise<{ kvAvailable: boolean; masterTotal: number }> {
  const redis = getRedis();
  if (!redis) return { kvAvailable: false, masterTotal: 0 };
  const trimmed = jsonl.trim();
  if (!trimmed || addedCount <= 0) {
    return { kvAvailable: true, masterTotal: await readCount(redis) };
  }
  const chunk = trimmed + '\n';
  await redis.append(KEY, chunk);
  const total = await redis.incrby(COUNT_KEY, addedCount);
  return { kvAvailable: true, masterTotal: Number(total) || 0 };
}

export async function getCount(): Promise<{ kvAvailable: boolean; total: number }> {
  const redis = getRedis();
  if (!redis) return { kvAvailable: false, total: 0 };
  return { kvAvailable: true, total: await readCount(redis) };
}

export async function getMaster(): Promise<{
  kvAvailable: boolean;
  jsonl: string;
  total: number;
}> {
  const redis = getRedis();
  if (!redis) return { kvAvailable: false, jsonl: '', total: 0 };
  const raw = await redis.get<string>(KEY);
  const jsonl = typeof raw === 'string' ? raw : raw == null ? '' : JSON.stringify(raw);
  let total = await readCount(redis);
  if (!total && jsonl) {
    total = jsonl.split('\n').filter(Boolean).length;
    if (total) await redis.set(COUNT_KEY, String(total));
  }
  return { kvAvailable: true, jsonl, total };
}
