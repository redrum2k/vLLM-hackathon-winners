#!/bin/bash
# =============================================================================
# TOA vLLM/LLM-D Hackathon — Tier 1: App & Inference Builder
# Brev Launchable Setup Script
# GPU: 1x L40S (48GB VRAM)
# Model: Meta Llama 3.1 8B Instruct
# =============================================================================

set -euo pipefail

echo "============================================="
echo "  TOA Hackathon — App Builder Environment"
echo "  Setting up your GPU instance..."
echo "============================================="

# --- System basics ---
sudo apt-get update -qq
sudo apt-get install -y -qq git curl wget jq htop tmux tree

# --- Python environment ---
echo "[1/6] Setting up Python environment..."
pip install --upgrade pip --break-system-packages -q
# Pin numpy<2 first: numpy.distutils was removed in 2.0, breaking numexpr's source build
pip install --break-system-packages -q "numpy<2"
pip install --break-system-packages -q \
    vllm \
    torch \
    transformers \
    huggingface_hub \
    langchain \
    langchain-community \
    langchain-huggingface \
    chromadb \
    sentence-transformers \
    fastapi \
    uvicorn \
    httpx \
    gradio \
    guidellm \
    lm-eval \
    llmcompressor \
    trl \
    peft \
    datasets \
    jupyter \
    ipywidgets \
    pandas \
    rich

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
# Start vLLM serving Llama 3.1 8B on this GPU
# API will be available at http://localhost:8000
echo "Starting vLLM server with Llama 3.1 8B Instruct..."
echo "API docs: http://localhost:8000/docs"
echo "OpenAI-compatible endpoint: http://localhost:8000/v1"
python3 -m vllm.entrypoints.openai.api_server \
    --model /models/llama-3.1-8b-instruct \
    --host 0.0.0.0 \
    --port 8000 \
    --max-model-len 8192 \
    --gpu-memory-utilization 0.85 \
    --dtype auto
VLLM_SCRIPT
chmod +x /workspace/start_vllm_server.sh

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
check "Model weights present"     "test -d /models/llama-3.1-8b-instruct"
check "Embedding model present"   "test -d /models/bge-small-en"
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
echo "    1. bash /workspace/test_setup.sh     (validate)"
echo "    2. bash /workspace/start_vllm_server.sh  (start LLM)"
echo "    3. python3 /workspace/test_client.py     (test it)"
echo ""
echo "  Model: Llama 3.1 8B Instruct"
echo "  API:   http://localhost:8000/v1"
echo "============================================="
