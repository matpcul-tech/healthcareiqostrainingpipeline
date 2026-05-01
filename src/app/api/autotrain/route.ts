import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

const PROJECT_NAME = 'sovereign-health-v1';
const BASE_MODEL = 'meta-llama/Meta-Llama-3.1-8B';
const DATASET = 'SovereignShieldTechnologiesLLC/sovereign-health-training-data';
const TRAIN_SPLIT = 'train';
const HARDWARE = 'spaces-l4x1';
const TASK = 'llm:sft';

const DEFAULT_PARAMS = {
  block_size: 1024,
  model_max_length: 2048,
  epochs: 3,
  batch_size: 2,
  lr: 0.0002,
  peft: true,
  quantization: 'int4',
  target_modules: 'all-linear',
  padding: 'right',
  optimizer: 'adamw_torch',
  scheduler: 'linear',
  gradient_accumulation: 4,
  mixed_precision: 'bf16',
  chat_template: 'chatml',
  merge_adapter: false,
};

const COLUMN_MAPPING = {
  text_column: 'messages',
};

interface WhoAmIResponse {
  name?: string;
  preferred_username?: string;
  orgs?: Array<{ name?: string }>;
}

async function whoami(token: string): Promise<string | null> {
  const res = await fetch('https://huggingface.co/api/whoami-v2', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`whoami failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  const j = (await res.json()) as WhoAmIResponse;
  return j.name || j.preferred_username || j.orgs?.[0]?.name || null;
}

interface CreateProjectInput {
  token: string;
  username: string;
  projectName: string;
  baseModel: string;
  dataset: string;
  trainSplit: string;
  hardware: string;
  task: string;
  params: Record<string, unknown>;
  columnMapping: Record<string, unknown>;
}

async function createProject(input: CreateProjectInput): Promise<unknown> {
  const body = {
    project_name: input.projectName,
    task: input.task,
    base_model: input.baseModel,
    hardware: input.hardware,
    params: JSON.stringify({ ...input.params, username: input.username }),
    username: input.username,
    column_mapping: JSON.stringify(input.columnMapping),
    hub_dataset: input.dataset,
    train_split: input.trainSplit,
    valid_split: null,
  };

  const res = await fetch('https://ui.autotrain.huggingface.co/api/create_project', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const detail = parsed ? JSON.stringify(parsed) : text.slice(0, 600);
    throw new Error(`AutoTrain create_project failed: HTTP ${res.status} ${detail}`);
  }

  return parsed ?? { raw: text };
}

function extractJobId(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const candidates = ['space_id', 'job_id', 'id', 'project_id', 'repo_id'];
  for (const key of candidates) {
    const v = r[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

interface AutotrainBody {
  projectName?: unknown;
  baseModel?: unknown;
  dataset?: unknown;
  trainSplit?: unknown;
  hardware?: unknown;
  task?: unknown;
  params?: unknown;
  columnMapping?: unknown;
}

async function runAutotrainJob(body: AutotrainBody) {
  const token = process.env.HF_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: 'HF_TOKEN environment variable is not set on the server.' },
      { status: 500 },
    );
  }

  const projectName = typeof body.projectName === 'string' && body.projectName ? body.projectName : PROJECT_NAME;
  const baseModel = typeof body.baseModel === 'string' && body.baseModel ? body.baseModel : BASE_MODEL;
  const dataset = typeof body.dataset === 'string' && body.dataset ? body.dataset : DATASET;
  const trainSplit = typeof body.trainSplit === 'string' && body.trainSplit ? body.trainSplit : TRAIN_SPLIT;
  const hardware = typeof body.hardware === 'string' && body.hardware ? body.hardware : HARDWARE;
  const task = typeof body.task === 'string' && body.task ? body.task : TASK;
  const params =
    body.params && typeof body.params === 'object' && !Array.isArray(body.params)
      ? { ...DEFAULT_PARAMS, ...(body.params as Record<string, unknown>) }
      : { ...DEFAULT_PARAMS };
  const columnMapping =
    body.columnMapping && typeof body.columnMapping === 'object' && !Array.isArray(body.columnMapping)
      ? (body.columnMapping as Record<string, unknown>)
      : { ...COLUMN_MAPPING };

  try {
    const username = await whoami(token);
    if (!username) {
      return NextResponse.json({ error: 'Could not resolve HF username from token.' }, { status: 502 });
    }

    const result = await createProject({
      token,
      username,
      projectName,
      baseModel,
      dataset,
      trainSplit,
      hardware,
      task,
      params,
      columnMapping,
    });

    const jobId = extractJobId(result);

    return NextResponse.json({
      success: true,
      username,
      jobId,
      projectName,
      baseModel,
      dataset,
      hardware,
      task,
      result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  let body: AutotrainBody = {};
  const contentLength = req.headers.get('content-length');
  if (contentLength && contentLength !== '0') {
    try {
      body = (await req.json()) as AutotrainBody;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
  }
  return runAutotrainJob(body);
}

export async function GET() {
  return NextResponse.json({
    status: 'AutoTrain endpoint active',
    runtime: 'nodejs',
    maxDuration: 300,
    method: 'POST to start an AutoTrain LLM SFT fine-tuning job. Body fields are all optional and override the defaults below.',
    defaults: {
      projectName: PROJECT_NAME,
      baseModel: BASE_MODEL,
      dataset: DATASET,
      trainSplit: TRAIN_SPLIT,
      hardware: HARDWARE,
      task: TASK,
      params: DEFAULT_PARAMS,
      columnMapping: COLUMN_MAPPING,
    },
    requires: 'HF_TOKEN environment variable on the server.',
  });
}
