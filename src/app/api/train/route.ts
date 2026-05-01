import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const maxDuration = 300;

const HF_API_BASE = 'https://huggingface.co';

const DEFAULTS = {
  baseModel: 'meta-llama/Llama-3.2-3B',
  dataset: 'SovereignShieldTechnologiesLLC/sovereign-health-training-data',
  trainSplit: 'train',
  spaceName: 'sovereign-health-trainer',
  hardware: 'a100-large',
  epochs: 3,
  batchSize: 4,
  gradientAccumulation: 4,
  learningRate: 2e-4,
  maxSeqLen: 512,
  loraR: 16,
  loraAlpha: 32,
};

interface WhoAmI {
  name?: string;
  preferred_username?: string;
}

async function whoami(token: string): Promise<string> {
  const res = await fetch(`${HF_API_BASE}/api/whoami-v2`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`whoami failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  const j = (await res.json()) as WhoAmI;
  const name = j.name || j.preferred_username;
  if (!name) throw new Error('Could not resolve HF username from token.');
  return name;
}

async function ensureSpace(
  token: string,
  namespace: string,
  repoName: string,
): Promise<{ created: boolean }> {
  const head = await fetch(`${HF_API_BASE}/api/spaces/${namespace}/${repoName}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (head.ok) return { created: false };
  if (head.status !== 404) {
    const body = await head.text().catch(() => '');
    throw new Error(`Space lookup HTTP ${head.status}: ${body.slice(0, 300)}`);
  }
  const create = await fetch(`${HF_API_BASE}/api/repos/create`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'space',
      name: repoName,
      organization: namespace,
      private: true,
      sdk: 'docker',
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!create.ok && create.status !== 409) {
    const body = await create.text().catch(() => '');
    throw new Error(`Space create HTTP ${create.status}: ${body.slice(0, 300)}`);
  }
  return { created: create.ok };
}

interface FilePayload {
  path: string;
  content: string;
}

async function commitFiles(
  token: string,
  namespace: string,
  repoName: string,
  files: FilePayload[],
  summary: string,
): Promise<void> {
  const lines: string[] = [];
  lines.push(
    JSON.stringify({
      key: 'header',
      value: { summary, description: 'Sovereign Health training job bootstrap.' },
    }),
  );
  for (const file of files) {
    lines.push(
      JSON.stringify({
        key: 'file',
        value: {
          path: file.path,
          content: Buffer.from(file.content, 'utf-8').toString('base64'),
          encoding: 'base64',
        },
      }),
    );
  }
  const ndjson = lines.join('\n') + '\n';
  const res = await fetch(
    `${HF_API_BASE}/api/spaces/${namespace}/${repoName}/commit/main`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-ndjson',
      },
      body: ndjson,
      signal: AbortSignal.timeout(120000),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Commit HTTP ${res.status}: ${body.slice(0, 400)}`);
  }
}

async function setSpaceSecret(
  token: string,
  namespace: string,
  repoName: string,
  key: string,
  value: string,
): Promise<void> {
  const res = await fetch(
    `${HF_API_BASE}/api/spaces/${namespace}/${repoName}/secrets`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key, value }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Set secret ${key} HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
}

async function setSpaceVariable(
  token: string,
  namespace: string,
  repoName: string,
  key: string,
  value: string,
): Promise<void> {
  const res = await fetch(
    `${HF_API_BASE}/api/spaces/${namespace}/${repoName}/variables`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key, value }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Set variable ${key} HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
}

async function setHardware(
  token: string,
  namespace: string,
  repoName: string,
  flavor: string,
): Promise<void> {
  const res = await fetch(
    `${HF_API_BASE}/api/spaces/${namespace}/${repoName}/hardware`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ flavor }),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Set hardware HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
}

async function restartSpace(
  token: string,
  namespace: string,
  repoName: string,
): Promise<void> {
  const res = await fetch(
    `${HF_API_BASE}/api/spaces/${namespace}/${repoName}/restart?factory=true`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!res.ok && res.status !== 409) {
    const body = await res.text().catch(() => '');
    throw new Error(`Restart HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
}

async function readScriptFile(name: string): Promise<string> {
  const filePath = path.join(process.cwd(), 'scripts', name);
  return fs.readFile(filePath, 'utf-8');
}

function readmeFor(namespace: string, repoName: string, hardware: string): string {
  return [
    '---',
    `title: ${repoName}`,
    `emoji: 🧬`,
    'colorFrom: indigo',
    'colorTo: green',
    'sdk: docker',
    'pinned: false',
    `hardware: ${hardware}`,
    '---',
    '',
    `# ${namespace}/${repoName}`,
    '',
    'Hugging Face Space that fine-tunes meta-llama/Llama-3.2-3B on the',
    'SovereignShieldTechnologiesLLC/sovereign-health-training-data dataset',
    'using the Hugging Face Python SDK (transformers + trl + peft).',
    '',
    'Triggered from the Vercel `/api/train` route.',
    '',
  ].join('\n');
}

interface TrainBody {
  baseModel?: unknown;
  dataset?: unknown;
  trainSplit?: unknown;
  spaceName?: unknown;
  hardware?: unknown;
  outputRepo?: unknown;
  epochs?: unknown;
  batchSize?: unknown;
  gradientAccumulation?: unknown;
  learningRate?: unknown;
  maxSeqLen?: unknown;
  loraR?: unknown;
  loraAlpha?: unknown;
}

function pickString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function pickNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

async function runTrainingJob(body: TrainBody) {
  const token = process.env.HF_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: 'HF_TOKEN environment variable is not set on the server.' },
      { status: 500 },
    );
  }

  const baseModel = pickString(body.baseModel, DEFAULTS.baseModel);
  const dataset = pickString(body.dataset, DEFAULTS.dataset);
  const trainSplit = pickString(body.trainSplit, DEFAULTS.trainSplit);
  const spaceName = pickString(body.spaceName, DEFAULTS.spaceName);
  const hardware = pickString(body.hardware, DEFAULTS.hardware);
  const epochs = pickNumber(body.epochs, DEFAULTS.epochs);
  const batchSize = pickNumber(body.batchSize, DEFAULTS.batchSize);
  const gradientAccumulation = pickNumber(
    body.gradientAccumulation,
    DEFAULTS.gradientAccumulation,
  );
  const learningRate = pickNumber(body.learningRate, DEFAULTS.learningRate);
  const maxSeqLen = pickNumber(body.maxSeqLen, DEFAULTS.maxSeqLen);
  const loraR = pickNumber(body.loraR, DEFAULTS.loraR);
  const loraAlpha = pickNumber(body.loraAlpha, DEFAULTS.loraAlpha);

  try {
    const username = await whoami(token);
    const outputRepo = pickString(
      body.outputRepo,
      `${username}/sovereign-health-llama-3.2-3b`,
    );

    const [trainPy, requirementsTxt, dockerfile] = await Promise.all([
      readScriptFile('train.py'),
      readScriptFile('requirements.txt'),
      readScriptFile('Dockerfile'),
    ]);

    await ensureSpace(token, username, spaceName);

    await commitFiles(
      token,
      username,
      spaceName,
      [
        { path: 'README.md', content: readmeFor(username, spaceName, hardware) },
        { path: 'Dockerfile', content: dockerfile },
        { path: 'requirements.txt', content: requirementsTxt },
        { path: 'train.py', content: trainPy },
      ],
      `Bootstrap training job for ${baseModel}`,
    );

    await setSpaceSecret(token, username, spaceName, 'HF_TOKEN', token);

    const variables: Record<string, string> = {
      BASE_MODEL: baseModel,
      DATASET_REPO: dataset,
      TRAIN_SPLIT: trainSplit,
      OUTPUT_REPO: outputRepo,
      EPOCHS: String(epochs),
      BATCH_SIZE: String(batchSize),
      GRADIENT_ACCUMULATION: String(gradientAccumulation),
      LEARNING_RATE: String(learningRate),
      MAX_SEQ_LEN: String(maxSeqLen),
      LORA_R: String(loraR),
      LORA_ALPHA: String(loraAlpha),
    };
    for (const [key, value] of Object.entries(variables)) {
      await setSpaceVariable(token, username, spaceName, key, value);
    }

    await setHardware(token, username, spaceName, hardware);
    await restartSpace(token, username, spaceName);

    const spaceId = `${username}/${spaceName}`;
    return NextResponse.json({
      success: true,
      jobId: spaceId,
      spaceUrl: `https://huggingface.co/spaces/${spaceId}`,
      logsUrl: `https://huggingface.co/spaces/${spaceId}/logs`,
      username,
      baseModel,
      dataset,
      trainSplit,
      hardware,
      outputRepo,
      params: {
        epochs,
        batchSize,
        gradientAccumulation,
        learningRate,
        maxSeqLen,
        loraR,
        loraAlpha,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  let body: TrainBody = {};
  const contentLength = req.headers.get('content-length');
  if (contentLength && contentLength !== '0') {
    try {
      body = (await req.json()) as TrainBody;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
  }
  return runTrainingJob(body);
}

export async function GET() {
  return runTrainingJob({});
}
