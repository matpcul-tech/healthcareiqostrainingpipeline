import { Redis } from '@upstash/redis';

const TOPIC_PREFIX = 'topic:';
const COUNTS_HASH = 'sovereign-counts';
const LEGACY_KEY = 'sovereign-health-master';
const LEGACY_COUNT_KEY = 'sovereign-health-master-count';

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

export function normalizeTopic(topic: string): string {
  return topic.replace(/_/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
}

export function topicKey(topic: string): string {
  return TOPIC_PREFIX + normalizeTopic(topic);
}

interface Totals {
  total: number;
  byTopic: Record<string, number>;
}

async function readTotals(redis: Redis): Promise<Totals> {
  const raw = (await redis.hgetall<Record<string, string>>(COUNTS_HASH)) || {};
  const byTopic: Record<string, number> = {};
  let total = 0;
  for (const [k, v] of Object.entries(raw)) {
    const n = Number(v) || 0;
    if (n <= 0) continue;
    byTopic[k] = n;
    total += n;
  }
  const legacyCountRaw = await redis.get<string>(LEGACY_COUNT_KEY);
  const legacyCount = Number(legacyCountRaw) || 0;
  if (legacyCount > 0) {
    byTopic['_legacy'] = legacyCount;
    total += legacyCount;
  }
  return { total, byTopic };
}

async function listTopicKeys(redis: Redis): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | number = 0;
  for (let i = 0; i < 50; i++) {
    const res = (await redis.scan(cursor, { match: TOPIC_PREFIX + '*', count: 200 })) as [
      string,
      string[],
    ];
    const [next, batch] = res;
    for (const k of batch) keys.push(k);
    if (!next || next === '0') break;
    cursor = next;
  }
  return Array.from(new Set(keys));
}

export async function appendTopicPairs(
  topic: string,
  jsonl: string,
  addedCount: number,
): Promise<{
  kvAvailable: boolean;
  topicTotal: number;
  masterTotal: number;
  topicKey: string;
}> {
  const redis = getRedis();
  const tKey = topicKey(topic);
  const normalized = normalizeTopic(topic);
  if (!redis) {
    return { kvAvailable: false, topicTotal: 0, masterTotal: 0, topicKey: tKey };
  }
  const trimmed = jsonl.trim();
  if (!trimmed || addedCount <= 0) {
    const totals = await readTotals(redis);
    return {
      kvAvailable: true,
      topicTotal: totals.byTopic[normalized] || 0,
      masterTotal: totals.total,
      topicKey: tKey,
    };
  }
  const chunk = trimmed + '\n';
  await redis.append(tKey, chunk);
  const topicTotalRaw = await redis.hincrby(COUNTS_HASH, normalized, addedCount);
  const totals = await readTotals(redis);
  return {
    kvAvailable: true,
    topicTotal: Number(topicTotalRaw) || 0,
    masterTotal: totals.total,
    topicKey: tKey,
  };
}

export async function getCount(): Promise<{
  kvAvailable: boolean;
  total: number;
  byTopic: Record<string, number>;
}> {
  const redis = getRedis();
  if (!redis) return { kvAvailable: false, total: 0, byTopic: {} };
  const totals = await readTotals(redis);
  return { kvAvailable: true, total: totals.total, byTopic: totals.byTopic };
}

export async function getMaster(): Promise<{
  kvAvailable: boolean;
  jsonl: string;
  total: number;
  byTopic: Record<string, number>;
  topicCount: number;
}> {
  const redis = getRedis();
  if (!redis) {
    return { kvAvailable: false, jsonl: '', total: 0, byTopic: {}, topicCount: 0 };
  }

  const keys = await listTopicKeys(redis);
  const parts: string[] = [];
  for (const key of keys) {
    const raw = await redis.get<string>(key);
    if (typeof raw === 'string' && raw.trim()) parts.push(raw.trim());
  }

  const legacyRaw = await redis.get<string>(LEGACY_KEY);
  if (typeof legacyRaw === 'string' && legacyRaw.trim()) parts.push(legacyRaw.trim());

  const jsonl = parts.join('\n');
  const totals = await readTotals(redis);
  let total = totals.total;
  if (!total && jsonl) total = jsonl.split('\n').filter(Boolean).length;

  return {
    kvAvailable: true,
    jsonl,
    total,
    byTopic: totals.byTopic,
    topicCount: keys.length,
  };
}
