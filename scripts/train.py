"""Sovereign Health fine-tuning job.

Runs inside a Hugging Face Space (Docker SDK) on a GPU flavor. Uses the
Hugging Face Python SDK (`transformers`, `trl`, `peft`, `datasets`,
`huggingface_hub`) to fine-tune meta-llama/Llama-3.2-3B on the
SovereignShieldTechnologiesLLC/sovereign-health-training-data dataset and
pushes the resulting LoRA adapter to a model repo on the Hub.
"""

from __future__ import annotations

import json
import os
import sys

import torch
from datasets import load_dataset
from huggingface_hub import login, whoami
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from trl import SFTConfig, SFTTrainer


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None or value == "":
        print(f"Missing required environment variable: {name}", file=sys.stderr)
        sys.exit(2)
    return value


HF_TOKEN = env("HF_TOKEN")
BASE_MODEL = os.environ.get("BASE_MODEL", "meta-llama/Llama-3.2-3B")
DATASET_REPO = os.environ.get(
    "DATASET_REPO", "SovereignShieldTechnologiesLLC/sovereign-health-training-data"
)
TRAIN_SPLIT = os.environ.get("TRAIN_SPLIT", "train")
OUTPUT_REPO = os.environ.get("OUTPUT_REPO", "")

EPOCHS = int(os.environ.get("EPOCHS", "3"))
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "2"))
GRAD_ACCUM = int(os.environ.get("GRADIENT_ACCUMULATION", "4"))
LEARNING_RATE = float(os.environ.get("LEARNING_RATE", "2e-4"))
MAX_SEQ_LEN = int(os.environ.get("MAX_SEQ_LEN", "2048"))
LORA_R = int(os.environ.get("LORA_R", "16"))
LORA_ALPHA = int(os.environ.get("LORA_ALPHA", "32"))


def main() -> None:
    login(token=HF_TOKEN)
    me = whoami(token=HF_TOKEN)
    username = me.get("name") or me.get("preferred_username")
    if not username:
        raise RuntimeError("Could not resolve username from HF token.")

    output_repo = OUTPUT_REPO or f"{username}/sovereign-health-llama-3.2-3b"
    print(f"[train] base_model={BASE_MODEL}")
    print(f"[train] dataset={DATASET_REPO} split={TRAIN_SPLIT}")
    print(f"[train] output_repo={output_repo}")

    dataset = load_dataset(DATASET_REPO, split=TRAIN_SPLIT, token=HF_TOKEN)
    print(f"[train] dataset rows: {len(dataset)}")

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )

    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, token=HF_TOKEN)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        quantization_config=bnb_config,
        device_map="auto",
        token=HF_TOKEN,
        torch_dtype=torch.bfloat16,
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
        max_seq_length=MAX_SEQ_LEN,
        packing=False,
        logging_steps=10,
        save_strategy="epoch",
        save_total_limit=1,
        report_to="none",
        push_to_hub=True,
        hub_model_id=output_repo,
        hub_token=HF_TOKEN,
        hub_strategy="end",
    )

    trainer = SFTTrainer(
        model=model,
        args=sft_config,
        train_dataset=dataset,
        peft_config=peft_config,
        tokenizer=tokenizer,
    )

    trainer.train()
    trainer.push_to_hub()
    print(json.dumps({"status": "complete", "output_repo": output_repo}))


if __name__ == "__main__":
    main()
