const PROCESSED_PREFIX = 'processed-ids:';

const processedStore = new Map<string, Set<string>>();

export function normalizeTopic(topic: string): string {
  return topic.replace(/_/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
}

export function processedIdsKey(topic: string): string {
  return PROCESSED_PREFIX + normalizeTopic(topic);
}

export async function getProcessedIds(
  topic: string,
): Promise<{ ids: Set<string>; key: string }> {
  const key = processedIdsKey(topic);
  const set = processedStore.get(key);
  return { ids: set ? new Set(set) : new Set(), key };
}

export async function addProcessedIds(
  topic: string,
  ids: string[],
): Promise<{ added: number; key: string }> {
  const key = processedIdsKey(topic);
  const clean = Array.from(new Set(ids.map(id => String(id).trim()).filter(Boolean)));
  if (clean.length === 0) return { added: 0, key };
  let set = processedStore.get(key);
  if (!set) {
    set = new Set<string>();
    processedStore.set(key, set);
  }
  let added = 0;
  for (const id of clean) {
    if (!set.has(id)) {
      set.add(id);
      added++;
    }
  }
  return { added, key };
}
