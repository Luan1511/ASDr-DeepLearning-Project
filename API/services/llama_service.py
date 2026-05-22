import glob
import os
from typing import Dict, List

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig


class LlamaBranch:
    def __init__(
        self,
        base_model: str,
        adapter_path: str,
        system_prompt: str,
    ):
        self.base_model = base_model
        self.adapter_path = self._resolve_latest_checkpoint(adapter_path)
        self.system_prompt = system_prompt

        self.tokenizer = None
        self.model = None

    def load(self):
        if self.model is not None and self.tokenizer is not None:
            return

        if not torch.cuda.is_available():
            raise RuntimeError("Chưa bật GPU để chạy Llama")

        use_bf16 = torch.cuda.is_bf16_supported()
        compute_dtype = torch.bfloat16 if use_bf16 else torch.float16

        self.tokenizer = AutoTokenizer.from_pretrained(
            self.adapter_path,
            use_fast=True,
            trust_remote_code=True,
        )

        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=compute_dtype,
            bnb_4bit_use_double_quant=True,
        )

        base = AutoModelForCausalLM.from_pretrained(
            self.base_model,
            quantization_config=bnb_config,
            device_map="auto",
            torch_dtype=compute_dtype,
            trust_remote_code=True,
        )

        self.model = PeftModel.from_pretrained(
            base,
            self.adapter_path,
        )

        self.model.eval()

    def ask(
        self,
        question: str,
        context: str = "",
        max_new_tokens: int = 512,
        temperature: float = 0.6,
        top_p: float = 0.9,
    ) -> str:
        self.load()

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
                "content": self.system_prompt,
            },
            {
                "role": "user",
                "content": user_content,
            },
        ]

        prompt = self.tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )

        inputs = self.tokenizer(
            prompt,
            return_tensors="pt",
        ).to(self.model.device)

        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
                top_p=top_p,
                do_sample=True,
                repetition_penalty=1.08,
                pad_token_id=self.tokenizer.eos_token_id,
            )

        input_len = inputs["input_ids"].shape[-1]
        generated_ids = outputs[0][input_len:]

        answer = self.tokenizer.decode(
            generated_ids,
            skip_special_tokens=True,
        )

        return answer.strip()

    def _resolve_latest_checkpoint(self, adapter_path: str) -> str:
        checkpoint_folders = glob.glob(
            os.path.join(adapter_path, "checkpoint-*")
        )

        if checkpoint_folders:
            return max(
                checkpoint_folders,
                key=lambda x: int(x.split("-")[-1]),
            )

        return adapter_path


class LlamaModelRegistry:
    def __init__(self, configs: Dict[str, dict]):
        self.branches = {}

        for name, cfg in configs.items():
            self.branches[name] = LlamaBranch(
                base_model=cfg["base_model"],
                adapter_path=cfg["adapter_path"],
                system_prompt=cfg["system_prompt"],
            )

    def model_names(self) -> List[str]:
        return list(self.branches.keys())

    def ask(
        self,
        model_name: str,
        question: str,
        context: str = "",
        max_new_tokens: int = 512,
        temperature: float = 0.6,
        top_p: float = 0.9,
    ) -> str:
        if model_name not in self.branches:
            raise KeyError(model_name)

        return self.branches[model_name].ask(
            question=question,
            context=context,
            max_new_tokens=max_new_tokens,
            temperature=temperature,
            top_p=top_p,
        )