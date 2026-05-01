"""Sovereign Health fine-tuning Space.

FastAPI app that runs inside the Hugging Face Space. The training job
executes in a daemon thread so the HTTP server stays responsive — the
Space's health check probe at GET / always returns 200 regardless of
training state, preventing the 30-minute health-check timeout from
killing the container mid-training.
"""

from __future__ import annotations

import json
import os
import threading
import time
import traceback
from typing import Any, Optional

import torch
from datasets import load_dataset
from fastapi import FastAPI
from huggingface_hub import login, whoami
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer
from trl import SFTConfig, SFTTrainer


HF_TOKEN = os.environ.get("HF_TOKEN", "")
BASE_MODEL = os.environ.get("BASE_MODEL", "meta-llama/Llama-3.2-3B")
DATASET_REPO = os.environ.get(
    "DATASET_REPO", "SovereignShieldTechnologiesLLC/sovereign-health-training-data"
)
TRAIN_SPLIT = os.environ.get("TRAIN_SPLIT", "train")
OUTPUT_REPO = os.environ.get("OUTPUT_REPO", "")

EPOCHS = int(os.environ.get("EPOCHS", "3"))
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "4"))
GRAD_ACCUM = int(os.environ.get("GRADIENT_ACCUMULATION", "4"))
LEARNING_RATE = float(os.environ.get("LEARNING_RATE", "2e-4"))
MAX_SEQ_LEN = int(os.environ.get("MAX_SEQ_LEN", "512"))
LORA_R = int(os.environ.get("LORA_R", "16"))
LORA_ALPHA = int(os.environ.get("LORA_ALPHA", "32"))


_state_lock = threading.Lock()
_state: dict[str, Any] = {
    "phase": "idle",
    "started_at": None,
    "completed_at": None,
    "error": None,
    "output_repo": None,
}
_training_thread: Optional[threading.Thread] = None


def _set_phase(phase: str, **extra: Any) -> None:
    with _state_lock:
        _state["phase"] = phase
        for k, v in extra.items():
            _state[k] = v


def _run_training() -> None:
    try:
        _set_phase("starting", started_at=time.time(), error=None)

        if not HF_TOKEN:
            raise RuntimeError("HF_TOKEN is not set; cannot train.")
        login(token=HF_TOKEN)

        me = whoami(token=HF_TOKEN)
        username = me.get("name") or me.get("preferred_username")
        if not username:
            raise RuntimeError("Could not resolve username from HF token.")

        output_repo = OUTPUT_REPO or f"{username}/sovereign-health-llama-3.2-3b"
        _set_phase("loading_dataset", output_repo=output_repo)
        print(f"[train] base_model={BASE_MODEL}")
        print(f"[train] dataset={DATASET_REPO} split={TRAIN_SPLIT}")
        print(f"[train] output_repo={output_repo}")

        data_glob = f"hf://datasets/{DATASET_REPO}/data/*.jsonl"
        print(f"[train] data_files={data_glob}")
        dataset = load_dataset(
            "json",
            data_files={TRAIN_SPLIT: data_glob},
            split=TRAIN_SPLIT,
            token=HF_TOKEN,
            features=None,
        )
        print(f"[train] dataset rows: {len(dataset)}")
        print(f"[train] dataset columns: {dataset.column_names}")
        if "messages" not in dataset.column_names:
            raise RuntimeError(
                f"Dataset missing required 'messages' column. Got: {dataset.column_names}"
            )
        drop_cols = [c for c in dataset.column_names if c != "messages"]
        if drop_cols:
            dataset = dataset.remove_columns(drop_cols)
            print(f"[train] dropped columns: {drop_cols}")

        _set_phase("loading_model")
        tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, token=HF_TOKEN)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token
        tokenizer.padding_side = "right"
        if not tokenizer.chat_template:
            tokenizer.chat_template = (
                "{% set loop_messages = messages %}"
                "{% for message in loop_messages %}"
                "{% set content = '<|start_header_id|>' + message['role'] + "
                "'<|end_header_id|>\n\n' + message['content'] | trim + '<|eot_id|>' %}"
                "{% if loop.index0 == 0 %}{% set content = bos_token + content %}{% endif %}"
                "{{ content }}"
                "{% endfor %}"
                "{% if add_generation_prompt %}"
                "{{ '<|start_header_id|>assistant<|end_header_id|>\n\n' }}"
                "{% endif %}"
            )
            print("[train] applied default Llama-3 chat template to tokenizer")

        model = AutoModelForCausalLM.from_pretrained(
            BASE_MODEL,
            device_map="auto",
            token=HF_TOKEN,
            dtype=torch.bfloat16,
        )

        peft_config = LoraConfig(
            r=LORA_R,
            lora_alpha=LORA_ALPHA,
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
            target_modules="all-linear",
        )

        sft_config = SFTConfig(
            output_dir="/tmp/sovereign-health-output",
            num_train_epochs=EPOCHS,
            per_device_train_batch_size=BATCH_SIZE,
            gradient_accumulation_steps=GRAD_ACCUM,
            learning_rate=LEARNING_RATE,
            bf16=True,
            optim="adamw_torch",
            lr_scheduler_type="linear",
            warmup_ratio=0.03,
            max_length=MAX_SEQ_LEN,
            gradient_checkpointing=False,
            packing=False,
            logging_steps=10,
            save_strategy="steps",
            save_steps=500,
            save_total_limit=2,
            report_to="none",
            push_to_hub=True,
            hub_model_id=output_repo,
            hub_token=HF_TOKEN,
            hub_strategy="every_save",
        )

        trainer = SFTTrainer(
            model=model,
            args=sft_config,
            train_dataset=dataset,
            peft_config=peft_config,
            processing_class=tokenizer,
        )

        has_checkpoint = os.path.isdir(sft_config.output_dir) and any(
            name.startswith("checkpoint-")
            for name in os.listdir(sft_config.output_dir)
        )
        if has_checkpoint:
            print("[train] resuming from existing checkpoint in output_dir")
        else:
            print("[train] no existing checkpoint found; starting fresh")

        _set_phase("training")
        trainer.train(resume_from_checkpoint=True if has_checkpoint else None)
        trainer.push_to_hub()
        _set_phase("complete", completed_at=time.time())
        print(json.dumps({"status": "complete", "output_repo": output_repo}))
    except Exception as e:
        traceback.print_exc()
        _set_phase("failed", error=str(e), completed_at=time.time())


def _start_training_thread() -> tuple[bool, str]:
    """Start the training thread if one isn't already running. Idempotent."""
    global _training_thread
    with _state_lock:
        if _training_thread is not None and _training_thread.is_alive():
            return False, f"already running (phase={_state['phase']})"
        thread = threading.Thread(target=_run_training, daemon=True, name="trainer")
        _training_thread = thread
        _state["phase"] = "queued"
        _state["error"] = None
    thread.start()
    return True, "started"


app = FastAPI(title="sovereign-health-trainer")


@app.on_event("startup")
def _on_startup() -> None:
    print("[startup] FastAPI app online; auto-launching training thread")
    started, msg = _start_training_thread()
    print(f"[startup] training thread: {msg}")


@app.get("/")
def health() -> dict[str, Any]:
    """Health check — always returns 200 regardless of training status."""
    with _state_lock:
        snapshot = dict(_state)
    snapshot["thread_alive"] = bool(
        _training_thread is not None and _training_thread.is_alive()
    )
    return {"status": "ok", "training": snapshot}


@app.get("/api/status")
def status() -> dict[str, Any]:
    with _state_lock:
        snapshot = dict(_state)
    snapshot["thread_alive"] = bool(
        _training_thread is not None and _training_thread.is_alive()
    )
    return snapshot


@app.post("/api/train")
def post_train() -> dict[str, Any]:
    """Kick off training in a background thread. Returns immediately."""
    started, message = _start_training_thread()
    with _state_lock:
        phase = _state["phase"]
    return {"started": started, "message": message, "phase": phase}
