import os
import json
from pathlib import Path

import torch
from datasets import Dataset
from peft import LoraConfig, prepare_model_for_kbit_training
from sklearn.model_selection import train_test_split
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from transformers.trainer_utils import get_last_checkpoint
from trl import SFTConfig, SFTTrainer

from huggingface_hub import login
login()

# =========================
# CONFIG
# =========================

DATA_DIR = "/home/nhomk23/workspace/NCKH_25-26/Main/Llama/Dataset"

MODEL_NAME = "meta-llama/Llama-3.2-3B-Instruct"

OUTPUT_DIR = "/home/nhomk23/workspace/NCKH_25-26/Main/LLama/output_llama_asd_lora"

MAX_LENGTH = 1024
EPOCHS = 3
LEARNING_RATE = 2e-4

BATCH_SIZE = 1
GRAD_ACCUM = 8

EVAL_RATIO = 0.05
SEED = 42

# Checkpoint config
SAVE_STEPS = 50
EVAL_STEPS = 50
LOGGING_STEPS = 10
SAVE_TOTAL_LIMIT = 3


# =========================
# LOAD JSONL DATASET
# =========================

def load_jsonl_folder(data_dir):
    data_path = Path(data_dir)

    if not data_path.exists():
        raise FileNotFoundError(f"Không tìm thấy folder dữ liệu: {data_dir}")

    jsonl_files = sorted(data_path.glob("*.jsonl"))

    if not jsonl_files:
        raise FileNotFoundError(f"Không tìm thấy file .jsonl trong folder: {data_dir}")

    samples = []
    bad_lines = []

    for file_path in jsonl_files:
        with open(file_path, "r", encoding="utf-8") as f:
            for line_idx, line in enumerate(f, start=1):
                line = line.strip()

                if not line:
                    continue

                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    bad_lines.append((str(file_path), line_idx, "JSON decode error"))
                    continue

                instruction = str(item.get("instruction", "")).strip()
                input_text = str(item.get("input", "")).strip()
                output = str(item.get("output", "")).strip()

                if not instruction or not output:
                    bad_lines.append((str(file_path), line_idx, "Thiếu instruction hoặc output"))
                    continue

                samples.append(
                    {
                        "instruction": instruction,
                        "input": input_text,
                        "output": output,
                        "source_file": file_path.name,
                    }
                )

    print(f"Đã đọc {len(jsonl_files)} file .jsonl")
    print(f"Tổng sample hợp lệ: {len(samples)}")
    print(f"Tổng dòng lỗi/bị bỏ qua: {len(bad_lines)}")

    if bad_lines:
        print("Một số dòng lỗi đầu tiên:")
        for file_path, line_idx, reason in bad_lines[:10]:
            print(f"- {file_path}:{line_idx} - {reason}")

    if len(samples) < 10:
        raise ValueError("Dataset quá ít sample hợp lệ.")

    return samples


# =========================
# FORMAT CHAT TEMPLATE
# =========================

def build_text(example, tokenizer):
    instruction = example["instruction"]
    input_text = example.get("input", "")
    output = example["output"]

    if input_text:
        user_content = (
            f"{instruction}\n\n"
            f"Ngữ cảnh / tình huống:\n{input_text}"
        )
    else:
        user_content = instruction

    messages = [
        {
            "role": "system",
            "content": (
                "Bạn là trợ lý tiếng Việt hỗ trợ phụ huynh và chuyên viên trong chủ đề "
                "Rối loạn phổ tự kỷ ASD. Trả lời rõ ràng, thận trọng, dễ hiểu. "
                "Không thay thế chẩn đoán hoặc tư vấn y tế trực tiếp."
            ),
        },
        {
            "role": "user",
            "content": user_content,
        },
        {
            "role": "assistant",
            "content": output,
        },
    ]

    return tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=False,
    )


# =========================
# TRAIN
# =========================

os.makedirs(OUTPUT_DIR, exist_ok=True)

if not torch.cuda.is_available():
    raise RuntimeError("Colab chưa bật GPU. Vào Runtime > Change runtime type > GPU.")

print("GPU:", torch.cuda.get_device_name(0))

os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

torch.backends.cuda.matmul.allow_tf32 = True

use_bf16 = torch.cuda.is_bf16_supported()
compute_dtype = torch.bfloat16 if use_bf16 else torch.float16

print("bf16 supported:", use_bf16)
print("compute dtype:", compute_dtype)

samples = load_jsonl_folder(DATA_DIR)

if len(samples) >= 20:
    train_samples, eval_samples = train_test_split(
        samples,
        test_size=EVAL_RATIO,
        random_state=SEED,
        shuffle=True,
    )
else:
    train_samples = samples
    eval_samples = samples[:2]

print("Train samples:", len(train_samples))
print("Eval samples:", len(eval_samples))

tokenizer = AutoTokenizer.from_pretrained(
    MODEL_NAME,
    use_fast=True,
    trust_remote_code=True,
)

if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

tokenizer.padding_side = "right"

train_dataset = Dataset.from_list(
    [
        {
            "text": build_text(example, tokenizer),
        }
        for example in train_samples
    ]
)

eval_dataset = Dataset.from_list(
    [
        {
            "text": build_text(example, tokenizer),
        }
        for example in eval_samples
    ]
)

bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=compute_dtype,
    bnb_4bit_use_double_quant=True,
)

model = AutoModelForCausalLM.from_pretrained(
    MODEL_NAME,
    quantization_config=bnb_config,
    device_map="auto",
    torch_dtype=compute_dtype,
    trust_remote_code=True,
)

model.config.use_cache = False
model = prepare_model_for_kbit_training(model)

model.enable_input_require_grads()

lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
    target_modules=[
        "q_proj",
        "k_proj",
        "v_proj",
        "o_proj",
        "gate_proj",
        "up_proj",
        "down_proj",
    ],
)

training_args = SFTConfig(
    output_dir=OUTPUT_DIR,
    dataset_text_field="text",
    max_length=MAX_LENGTH,

    num_train_epochs=EPOCHS,
    per_device_train_batch_size=BATCH_SIZE,
    per_device_eval_batch_size=1,
    gradient_accumulation_steps=GRAD_ACCUM,

    learning_rate=LEARNING_RATE,
    lr_scheduler_type="cosine",
    warmup_ratio=0.03,
    weight_decay=0.01,

    logging_steps=LOGGING_STEPS,

    eval_strategy="steps",
    eval_steps=EVAL_STEPS,

    save_strategy="steps",
    save_steps=SAVE_STEPS,
    save_total_limit=SAVE_TOTAL_LIMIT,

    fp16=not use_bf16,
    bf16=use_bf16,

    gradient_checkpointing=True,
    optim="paged_adamw_8bit",
    packing=False,

    report_to="none",
    seed=SEED,
)

trainer = SFTTrainer(
    model=model,
    args=training_args,
    train_dataset=train_dataset,
    eval_dataset=eval_dataset,
    peft_config=lora_config,
    processing_class=tokenizer,
)


# =========================
# AUTO RESUME CHECKPOINT
# =========================

last_checkpoint = None

if os.path.isdir(OUTPUT_DIR):
    last_checkpoint = get_last_checkpoint(OUTPUT_DIR)

if last_checkpoint is not None:
    print(f"Tìm thấy checkpoint cũ, resume từ: {last_checkpoint}")
    trainer.train(resume_from_checkpoint=last_checkpoint)
else:
    print("Không tìm thấy checkpoint cũ, train từ đầu.")
    trainer.train()


# =========================
# SAVE FINAL ADAPTER
# =========================

trainer.save_model(OUTPUT_DIR)
tokenizer.save_pretrained(OUTPUT_DIR)

print("Train xong.")
print("LoRA adapter đã lưu tại:", OUTPUT_DIR)