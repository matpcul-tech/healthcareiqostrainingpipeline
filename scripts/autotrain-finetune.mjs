#!/usr/bin/env node
// Starts a Hugging Face AutoTrain LLM SFT fine-tuning job.
//
// Reads HF_TOKEN from the environment. On success, prints the AutoTrain
// project / Space id (the "job id") to stdout.

const HF_TOKEN = process.env.HF_TOKEN;
if (!HF_TOKEN) {
  console.error('HF_TOKEN environment variable is required.');
  process.exit(1);
}

const PROJECT_NAME = 'sovereign-health-v1';
const BASE_MODEL = 'meta-llama/Meta-Llama-3.1-8B';
const DATASET = 'SovereignShieldTechnologiesLLC/sovereign-health-training-data';
const TRAIN_SPLIT = 'train';
const HARDWARE = 'spaces-l4x1'; // AutoTrain identifier for an L4 GPU Space
const TASK = 'llm:sft';

const params = {
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
  username: null, // filled below
};

const columnMapping = {
  text_column: 'messages',
};

async function whoami(token) {
  const res = await fetch('https://huggingface.co/api/whoami-v2', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`whoami failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  const j = await res.json();
  return j.name || j.preferred_username || (j.orgs && j.orgs[0] && j.orgs[0].name);
}

async function createProject(token, username) {
  params.username = username;

  const body = {
    project_name: PROJECT_NAME,
    task: TASK,
    base_model: BASE_MODEL,
    hardware: HARDWARE,
    params: JSON.stringify(params),
    username,
    column_mapping: JSON.stringify(columnMapping),
    hub_dataset: DATASET,
    train_split: TRAIN_SPLIT,
    valid_split: null,
  };

  const res = await fetch('https://ui.autotrain.huggingface.co/api/create_project', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let parsed;
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

(async () => {
  try {
    const username = await whoami(HF_TOKEN);
    if (!username) throw new Error('Could not resolve HF username from token.');
    console.error(`Authenticated as: ${username}`);

    const result = await createProject(HF_TOKEN, username);
    const jobId =
      result.space_id ||
      result.job_id ||
      result.id ||
      result.project_id ||
      result.repo_id ||
      null;

    console.log(JSON.stringify(result, null, 2));
    if (jobId) {
      console.error(`\nJOB_ID=${jobId}`);
    } else {
      console.error('\nJob created, but no recognizable id field in response.');
    }
  } catch (err) {
    console.error(`ERROR: ${err.message || err}`);
    process.exit(2);
  }
})();
