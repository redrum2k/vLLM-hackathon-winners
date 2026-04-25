#!/bin/bash
# =============================================================================
# TOA vLLM/LLM-D Hackathon — Tier 1: App & Inference Builder
# Brev Launchable Setup Script
# GPU: 2x H100 (80GB VRAM each, one per model)
# Models: Llama 3.1 8B Instruct (text, port 8000)
#         Llama 3.2 11B Vision Instruct (vision/ingestion, port 8001)
# NOTE: Set HF_TOKEN in your Brev environment before launching —
#       Llama 3.2 Vision is a gated model and requires it to download.
# =============================================================================

set -euo pipefail

echo "============================================="
echo "  TOA Hackathon — App Builder Environment"
echo "  Setting up your GPU instance..."
echo "============================================="

# --- System basics ---
sudo apt-get update -qq
sudo apt-get install -y -qq git curl wget jq htop tmux tree

# --- Create /models dir with correct ownership ---
sudo mkdir -p /models
sudo chown "$(whoami):$(whoami)" /models

# --- Python environment ---
echo "[1/6] Setting up Python environment..."
PIP="pip install --break-system-packages -q --timeout 300 --retries 5"

$PIP --upgrade pip

# Pin numpy<2 first: numpy.distutils was removed in 2.0, breaking numexpr's source build
$PIP "numpy<2"

# Install in small batches — if one package times out it won't kill everything
echo "      [1a] Core ML stack..."
$PIP vllm torch transformers huggingface_hub
# Fix dependency conflict: vllm requires a specific compressed-tensors version
$PIP "compressed-tensors==0.15.0.1"

echo "      [1b] LangChain..."
$PIP langchain langchain-community langchain-huggingface

echo "      [1c] Vector store + embeddings..."
$PIP chromadb sentence-transformers

echo "      [1d] Serving + HTTP..."
$PIP fastapi uvicorn httpx gradio

echo "      [1e] Eval + training..."
$PIP guidellm lm-eval llmcompressor trl peft datasets

echo "      [1f] Notebooks + utilities..."
$PIP jupyter ipywidgets pandas rich

# --- Download model weights (critical for saving hack time) ---
echo "[2/6] Downloading Llama 3.1 8B Instruct weights..."
echo "      This is pre-cached so you don't lose hacking time."
python3 -c "
from huggingface_hub import snapshot_download
snapshot_download(
    'meta-llama/Llama-3.1-8B-Instruct',
    local_dir='/models/llama-3.1-8b-instruct',
    ignore_patterns=['*.pth', 'original/**']
)
"

# --- Download Llama 3.2 11B Vision Instruct (gated — requires HF_TOKEN) ---
echo "[2b/6] Downloading Llama 3.2 11B Vision Instruct weights..."
if [ -z "${HF_TOKEN:-}" ]; then
    echo "  WARNING: HF_TOKEN not set — skipping vision model download."
    echo "  Set HF_TOKEN and re-run: python3 -c \""
    echo "    from huggingface_hub import snapshot_download"
    echo "    snapshot_download('meta-llama/Llama-3.2-11B-Vision-Instruct', local_dir='/models/llama-3.2-11b-vision-instruct')\""
else
    python3 -c "
from huggingface_hub import snapshot_download
snapshot_download(
    'meta-llama/Llama-3.2-11B-Vision-Instruct',
    local_dir='/models/llama-3.2-11b-vision-instruct',
    ignore_patterns=['*.pth', 'original/**']
)
"
fi

# --- Download a small embedding model for RAG track ---
echo "[3/6] Downloading embedding model for RAG..."
python3 -c "
from huggingface_hub import snapshot_download
snapshot_download(
    'BAAI/bge-small-en-v1.5',
    local_dir='/models/bge-small-en'
)
"

# --- Create starter notebooks directory ---
echo "[4/6] Setting up starter notebooks..."
mkdir -p /workspace/notebooks
mkdir -p /workspace/app-scaffold

# --- Write a quick-start vLLM serving script ---
cat > /workspace/start_vllm_server.sh << 'VLLM_SCRIPT'
#!/bin/bash
# Start vLLM serving Llama 3.1 8B Instruct on GPU 0 (port 8000)
echo "Starting vLLM text server (Llama 3.1 8B) on GPU 0..."
echo "OpenAI-compatible endpoint: http://localhost:8000/v1"
CUDA_VISIBLE_DEVICES=0 python3 -m vllm.entrypoints.openai.api_server \
    --model /models/llama-3.1-8b-instruct \
    --host 0.0.0.0 \
    --port 8000 \
    --max-model-len 32768 \
    --gpu-memory-utilization 0.90 \
    --enable-prefix-caching \
    --dtype auto
VLLM_SCRIPT
chmod +x /workspace/start_vllm_server.sh

# --- Write vision model serving script ---
cat > /workspace/start_vllm_vision_server.sh << 'VISION_SCRIPT'
#!/bin/bash
# Start vLLM serving Llama 3.2 11B Vision Instruct on GPU 1 (port 8001)
# Used during corpus ingestion to transcribe PDFs and images.
echo "Starting vLLM vision server (Llama 3.2 11B Vision) on GPU 1..."
echo "OpenAI-compatible endpoint: http://localhost:8001/v1"
CUDA_VISIBLE_DEVICES=1 python3 -m vllm.entrypoints.openai.api_server \
    --model /models/llama-3.2-11b-vision-instruct \
    --host 0.0.0.0 \
    --port 8001 \
    --max-model-len 8192 \
    --gpu-memory-utilization 0.90 \
    --enable-prefix-caching \
    --dtype auto
VISION_SCRIPT
chmod +x /workspace/start_vllm_vision_server.sh

# --- Write a quick test client ---
cat > /workspace/test_client.py << 'TEST_CLIENT'
"""Quick test: verify vLLM is serving correctly."""
import httpx, sys, json

BASE = "http://localhost:8000/v1"

def test():
    # Health check
    r = httpx.get("http://localhost:8000/health", timeout=10)
    assert r.status_code == 200, f"Health check failed: {r.status_code}"
    print("✓ Health check passed")

    # Model list
    r = httpx.get(f"{BASE}/models", timeout=10)
    models = r.json()["data"]
    print(f"✓ Models available: {[m['id'] for m in models]}")

    # Chat completion
    r = httpx.post(f"{BASE}/chat/completions", json={
        "model": models[0]["id"],
        "messages": [{"role": "user", "content": "Say 'hackathon ready!' in exactly 3 words."}],
        "max_tokens": 20,
        "temperature": 0.1
    }, timeout=30)
    msg = r.json()["choices"][0]["message"]["content"]
    print(f"✓ Chat completion: {msg}")
    print("\n🎉 Environment is ready! Happy hacking!")

if __name__ == "__main__":
    try:
        test()
    except httpx.ConnectError:
        print("✗ Cannot connect to vLLM server.")
        print("  Run: bash /workspace/start_vllm_server.sh")
        print("  Then wait ~30s for model to load, and retry.")
        sys.exit(1)
TEST_CLIENT

# --- Write a FastAPI app scaffold for BYOP track ---
cat > /workspace/app-scaffold/main.py << 'APP_SCAFFOLD'
"""
Starter FastAPI app scaffold for the BYOP / App Builder track.
Connects to the local vLLM server as an OpenAI-compatible backend.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

app = FastAPI(title="TOA Hackathon App", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

VLLM_BASE = "http://localhost:8000/v1"

class ChatRequest(BaseModel):
    message: str
    system_prompt: str = "You are a helpful assistant."
    max_tokens: int = 512

@app.post("/chat")
async def chat(req: ChatRequest):
    async with httpx.AsyncClient() as client:
        r = await client.post(f"{VLLM_BASE}/chat/completions", json={
            "model": "/models/llama-3.1-8b-instruct",
            "messages": [
                {"role": "system", "content": req.system_prompt},
                {"role": "user", "content": req.message}
            ],
            "max_tokens": req.max_tokens
        }, timeout=60)
        return r.json()

@app.get("/health")
async def health():
    return {"status": "ok", "backend": VLLM_BASE}
APP_SCAFFOLD

cat > /workspace/app-scaffold/run.sh << 'RUN_APP'
#!/bin/bash
echo "Starting app on http://localhost:8080"
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
RUN_APP
chmod +x /workspace/app-scaffold/run.sh

# --- Environment validation script ---
echo "[5/6] Creating environment validation script..."
cat > /workspace/test_setup.sh << 'VALIDATE'
#!/bin/bash
echo "============================================="
echo "  Environment Validation"
echo "============================================="
PASS=0; FAIL=0

check() {
    if eval "$2" > /dev/null 2>&1; then
        echo "  ✓ $1"; ((PASS++))
    else
        echo "  ✗ $1"; ((FAIL++))
    fi
}

check "NVIDIA GPU detected"       "nvidia-smi"
check "CUDA available"            "python3 -c 'import torch; assert torch.cuda.is_available()'"
check "vLLM installed"            "python3 -c 'import vllm'"
check "Text model weights present"   "test -d /models/llama-3.1-8b-instruct"
check "Vision model weights present" "test -d /models/llama-3.2-11b-vision-instruct"
check "Embedding model present"      "test -d /models/bge-small-en"
check "LangChain installed"       "python3 -c 'import langchain'"
check "ChromaDB installed"        "python3 -c 'import chromadb'"
check "TRL installed"             "python3 -c 'import trl'"
check "PEFT installed"            "python3 -c 'import peft'"
check "guidellm installed"        "python3 -c 'import guidellm'"
check "llm-compressor installed"  "python3 -c 'import llmcompressor'"

echo "---------------------------------------------"
echo "  Results: $PASS passed, $FAIL failed"
if [ $FAIL -eq 0 ]; then
    echo "  🎉 All checks passed — you're ready to hack!"
else
    echo "  ⚠  Some checks failed. Ask a mentor for help."
fi
echo "============================================="
VALIDATE
chmod +x /workspace/test_setup.sh

# --- Final summary ---
echo "[6/6] Setup complete!"
echo ""
echo "============================================="
echo "  ✅ Environment ready!"
echo ""
echo "  Quick start:"
echo "    1. bash /workspace/test_setup.sh               (validate)"
echo "    2. bash /workspace/start_vllm_server.sh        (text model,   GPU 0, port 8000)"
echo "    3. bash /workspace/start_vllm_vision_server.sh (vision model, GPU 1, port 8001)"
echo "    4. python3 /workspace/test_client.py           (test text endpoint)"
echo ""
echo "  Text model  : Llama 3.1 8B Instruct → http://localhost:8000/v1"
echo "  Vision model: Llama 3.2 11B Vision  → http://localhost:8001/v1"
echo "============================================="
