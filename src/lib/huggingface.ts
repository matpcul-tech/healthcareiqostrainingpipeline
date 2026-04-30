const HF_API_BASE = 'https://huggingface.co';
const HF_REPO_ID = 'SovereignShieldTechnologiesLLC/sovereign-health-training-data';
const HF_REPO_TYPE = 'dataset';

export interface HFPushResult {
  pushed: boolean;
  reason?: string;
  path?: string;
  commitUrl?: string;
  repo?: string;
}

function safeFileTopic(topic: string): string {
  return topic
    .replace(/_/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .toLowerCase()
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'topic';
}

async function ensureRepoExists(token: string): Promise<{ ok: boolean; reason?: string }> {
  const [namespace, name] = HF_REPO_ID.split('/');
  try {
    const head = await fetch(`${HF_API_BASE}/api/datasets/${HF_REPO_ID}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (head.ok) return { ok: true };
    if (head.status !== 404) {
      return { ok: false, reason: `HF lookup HTTP ${head.status}` };
    }
  } catch (err) {
    return { ok: false, reason: `HF lookup error: ${String(err)}` };
  }

  try {
    const create = await fetch(`${HF_API_BASE}/api/repos/create`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: HF_REPO_TYPE,
        name,
        organization: namespace,
        private: false,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (create.ok || create.status === 409) return { ok: true };
    const text = await create.text().catch(() => '');
    return { ok: false, reason: `HF create HTTP ${create.status}: ${text.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, reason: `HF create error: ${String(err)}` };
  }
}

export async function pushTopicToHuggingFace(
  topic: string,
  jsonl: string,
  pairCount: number,
): Promise<HFPushResult> {
  const token = process.env.HF_TOKEN;
  if (!token) {
    return { pushed: false, reason: 'HF_TOKEN not set', repo: HF_REPO_ID };
  }
  const trimmed = jsonl.trim();
  if (!trimmed || pairCount <= 0) {
    return { pushed: false, reason: 'No pairs to push', repo: HF_REPO_ID };
  }

  const ensured = await ensureRepoExists(token);
  if (!ensured.ok) {
    return { pushed: false, reason: ensured.reason || 'Repo unavailable', repo: HF_REPO_ID };
  }

  const safeTopic = safeFileTopic(topic);
  const timestamp = Date.now();
  const path = `data/topic-${safeTopic}-${timestamp}.jsonl`;

  const content = trimmed + '\n';
  const base64 = Buffer.from(content, 'utf-8').toString('base64');

  const header = JSON.stringify({
    key: 'header',
    value: {
      summary: `Add ${safeTopic} training pairs (${pairCount} samples)`,
      description:
        'Automated push from Sovereign Health Pipeline (PubMed peer-reviewed abstracts).',
    },
  });
  const fileOp = JSON.stringify({
    key: 'file',
    value: {
      path,
      content: base64,
      encoding: 'base64',
    },
  });
  const ndjson = header + '\n' + fileOp + '\n';

  const url = `${HF_API_BASE}/api/datasets/${HF_REPO_ID}/commit/main`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-ndjson',
      },
      body: ndjson,
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        pushed: false,
        reason: `HF commit HTTP ${res.status}: ${text.slice(0, 200)}`,
        path,
        repo: HF_REPO_ID,
      };
    }
    const data = (await res.json().catch(() => ({}))) as { commitUrl?: string };
    return {
      pushed: true,
      path,
      commitUrl: data?.commitUrl,
      repo: HF_REPO_ID,
    };
  } catch (err) {
    return {
      pushed: false,
      reason: `HF commit error: ${String(err)}`,
      path,
      repo: HF_REPO_ID,
    };
  }
}

export const HF_DATASET_REPO = HF_REPO_ID;
