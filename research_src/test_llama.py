import torch
from peft import PeftModel 
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
import os
import glob


# =========================
# CONFIG 
# =========================

BASE_MODEL = "meta-llama/Llama-3.2-3B-Instruct"

ADAPTER_PATH = "/home/nhomk23/workspace/NCKH_25-26/Main/LLama/output_llama_asd_lora_1"

SYSTEM_PROMPT = (
    "Bạn là trợ lý tiếng Việt hỗ trợ phụ huynh và chuyên viên trong chủ đề "
    "Rối loạn phổ tự kỷ ASD. Trả lời rõ ràng, thận trọng, dễ hiểu. "
    "Không thay thế chẩn đoán hoặc tư vấn y tế trực tiếp."
)


# =========================
# LOAD MODEL
# =========================

if not torch.cuda.is_available():
    raise RuntimeError("Chưa bật GPU. Vào Runtime > Change runtime type > GPU.")

use_bf16 = torch.cuda.is_bf16_supported()
compute_dtype = torch.bfloat16 if use_bf16 else torch.float16

print("GPU:", torch.cuda.get_device_name(0))
print("Compute dtype:", compute_dtype)

checkpoint_folders = glob.glob(os.path.join(ADAPTER_PATH, "checkpoint-*"))
if checkpoint_folders:
    ADAPTER_PATH = max(checkpoint_folders, key=lambda x: int(x.split("-")[-1]))
print(f"--> Đang load checkpoint cao nhất tại: {ADAPTER_PATH}")

tokenizer = AutoTokenizer.from_pretrained(
    ADAPTER_PATH,
    use_fast=True,
    trust_remote_code=True,
)

if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=compute_dtype,
    bnb_4bit_use_double_quant=True,
)

base_model = AutoModelForCausalLM.from_pretrained(
    BASE_MODEL,
    quantization_config=bnb_config,
    device_map="auto",
    torch_dtype=compute_dtype,
    trust_remote_code=True,
)

model = PeftModel.from_pretrained(
    base_model,
    ADAPTER_PATH,
)

model.eval()

print("Load model + LoRA adapter xong.")


def ask_asd_assistant(question, context="", max_new_tokens=512):
    if context:
        user_content = (
            f"{question}\n\n"
            f"Ngữ cảnh / tình huống:\n{context}"
        )
    else:
        user_content = question

    messages = [
        {
            "role": "system",
            "content": SYSTEM_PROMPT,
        },
        {
            "role": "user",
            "content": user_content,
        },
    ]

    prompt = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )

    inputs = tokenizer(
        prompt,
        return_tensors="pt",
    ).to(model.device)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            temperature=0.6,
            top_p=0.9,
            do_sample=True,
            repetition_penalty=1.08,
            pad_token_id=tokenizer.eos_token_id,
        )

    full_text = tokenizer.decode(
        outputs[0],
        skip_special_tokens=True,
    )

    # Cách đơn giản để chỉ lấy phần trả lời cuối
    if "assistant" in full_text:
        answer = full_text.split("assistant")[-1].strip()
    else:
        answer = full_text.strip()

    return answer


# question = "Con tôi bị Github rồi giờ phải làm sao?"
question = "Github là gì?"

context = (
    "Bạn là trợ lý ảo hỗ trợ người dùng trong việc tìm hiểu về Rối loạn phổ tự kỷ ASD."
)

answer = ask_asd_assistant(question, context)

print(answer)