import json
import shutil
import subprocess
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from pydantic import BaseModel

from services.llama_service import LlamaModelRegistry

# =========================
# APP
# =========================

app = FastAPI(
    title="Llama API",
    version="1.0.0",
)

    
llama_registry: Optional[LlamaModelRegistry] = None


# =========================
# REQUEST MODELS
# =========================

class ChatRequest(BaseModel):
    question: str
    context: str = ""
    max_new_tokens: int = 512
    temperature: float = 0.6
    top_p: float = 0.9


# =========================
# STARTUP
# =========================

@app.on_event("startup")
def startup():
    global llama_registry

    llama_registry = LlamaModelRegistry(
        configs={
            "asd_lora_1": {
                "base_model": "meta-llama/Llama-3.2-3B-Instruct",
                "adapter_path": "LLama/output_llama_asd_lora_1",
                "system_prompt": (
                    "Bạn là trợ lý tiếng Việt hỗ trợ phụ huynh và chuyên viên trong chủ đề "
                    "Rối loạn phổ tự kỷ ASD. Trả lời rõ ràng, thận trọng, dễ hiểu. "
                    "Không thay thế chẩn đoán hoặc tư vấn y tế trực tiếp."
                ),
            },
            "asd_lora_2": {
                "base_model": "meta-llama/Llama-3.2-3B-Instruct",
                "adapter_path": "LLama/output_llama_asd_lora_2",
                "system_prompt": (
                    "Bạn là trợ lý tiếng Việt chỉ hỗ trợ trong phạm vi Rối loạn phổ tự kỷ ASD. "
                    "Nếu câu hỏi không liên quan ASD, hãy từ chối ngắn gọn và điều hướng người dùng "
                    "quay lại các nội dung liên quan ASD. Không thay thế chẩn đoán hoặc tư vấn y tế trực tiếp."
                ),
            },
        }
    )


# =========================
# HEALTH
# =========================

@app.get("/")
def root():
    return {
        "message": "ASD API is running",
        "routes": [
            "POST /chat/{model_name}",
            "POST /chat",
            "GET /chat/models",
        ],
    }


# =========================
# CHAT ROUTES
# =========================

@app.get("/chat/models")
def list_chat_models():
    if llama_registry is None:
        raise HTTPException(
            status_code=500,
            detail="Llama registry is not loaded",
        )

    return {
        "models": llama_registry.model_names(),
    }


@app.post("/chat/{model_name}")
def chat_with_model(model_name: str, payload: ChatRequest):
    if llama_registry is None:
        raise HTTPException(
            status_code=500,
            detail="Llama registry is not loaded",
        )

    try:
        answer = llama_registry.ask(
            model_name=model_name,
            question=payload.question,
            context=payload.context,
            max_new_tokens=payload.max_new_tokens,
            temperature=payload.temperature,
            top_p=payload.top_p,
        )

        return {
            "model": model_name,
            "question": payload.question,
            "answer": answer,
        }

    except KeyError:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown model branch: {model_name}",
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )


@app.post("/chat")
def compare_chat_models(payload: ChatRequest):
    if llama_registry is None:
        raise HTTPException(
            status_code=500,
            detail="Llama registry is not loaded",
        )

    results = {}

    for model_name in llama_registry.model_names():
        try:
            answer = llama_registry.ask(
                model_name=model_name,
                question=payload.question,
                context=payload.context,
                max_new_tokens=payload.max_new_tokens,
                temperature=payload.temperature,
                top_p=payload.top_p,
            )

            results[model_name] = {
                "answer": answer,
            }

        except Exception as e:
            results[model_name] = {
                "error": str(e),
            }

    return {
        "question": payload.question,
        "results": results,
    }