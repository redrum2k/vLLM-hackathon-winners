#!/usr/bin/env bash
# =============================================================================
# Cortex project setup — run once per team member after cloning
#
# Prereqs (all team members):
#   1. Install uv (if not already installed):
#        curl -LsSf https://astral.sh/uv/install.sh | sh
#        then restart your shell (or: source $HOME/.local/bin/env)
#   2. Python 3.11 or 3.12 must be available on PATH
#   3. Copy .env.example → .env and fill in your Brev endpoint addresses
#
# On Brev (tier1-app-builder launchable):
#   - Text model (Llama 3.1 8B) is pre-loaded at /models/llama-3.1-8b-instruct
#   - Start it:  bash /workspace/start_vllm_server.sh   (port 8000)
#   - Vision model must be started separately on port 8001 (see below)
# =============================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$PROJECT_DIR/.venv"
REQ_FILE="$PROJECT_DIR/requirements.txt"

echo ""
echo "============================================="
echo "  Cortex setup"
echo "  Project: $PROJECT_DIR"
echo "============================================="

# --- 0. Check uv ---
if ! command -v uv &>/dev/null; then
    echo ""
    echo "ERROR: uv not found."
    echo "Install it with:"
    echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
    echo "Then restart your shell and re-run this script."
    exit 1
fi
echo "[0/3] uv $(uv --version) found"

# --- 1. Create venv and install dependencies ---
echo "[1/3] Creating venv at $VENV_DIR ..."
uv venv "$VENV_DIR" --python 3.11

echo "      Installing dependencies from requirements.txt ..."
uv pip install --python "$VENV_DIR" -r "$REQ_FILE"
echo "      ✓ Dependencies installed"

# Load .env so endpoint checks below respect local overrides
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$PROJECT_DIR/.env"
    set +a
fi

TEXT_ENDPOINT="${VLLM_TEXT_ENDPOINT:-http://localhost:8000/v1}"
VISION_ENDPOINT="${VLLM_VISION_ENDPOINT:-http://localhost:8001/v1}"

# --- 2. Verify text endpoint (port 8000) ---
echo "[2/3] Checking text endpoint: $TEXT_ENDPOINT ..."
TEXT_RESP=$(curl -sf --max-time 5 "$TEXT_ENDPOINT/models" 2>/dev/null || echo "")
if [ -z "$TEXT_RESP" ]; then
    echo "      ✗ Not reachable — start it first:"
    echo "          On Brev : bash /workspace/start_vllm_server.sh"
    echo "          Locally : set VLLM_TEXT_ENDPOINT in .env to your Brev public address"
else
    LOADED=$(echo "$TEXT_RESP" \
        | python3 -c "import sys,json; print(', '.join(m['id'] for m in json.load(sys.stdin)['data']))" \
        2>/dev/null || echo "unknown")
    echo "      ✓ Reachable — loaded model(s): $LOADED"
fi

# --- 3. Verify vision endpoint (port 8001) ---
echo "[3/3] Checking vision endpoint: $VISION_ENDPOINT ..."
VISION_RESP=$(curl -sf --max-time 5 "$VISION_ENDPOINT/models" 2>/dev/null || echo "")
if [ -z "$VISION_RESP" ]; then
    echo "      ⚠  Not reachable (non-fatal — required only for ingestion)"
    echo "         Start it on Brev with:"
    echo ""
    echo "           bash /workspace/start_vllm_vision_server.sh"
    echo "         Or manually:"
    echo "           CUDA_VISIBLE_DEVICES=1 vllm serve meta-llama/Llama-3.2-11B-Vision-Instruct \\"
    echo "             --host 0.0.0.0 --port 8001 \\"
    echo "             --max-model-len 8192 \\"
    echo "             --gpu-memory-utilization 0.90 \\"
    echo "             --enable-prefix-caching"
    echo ""
    echo "         (uses ~22 GB VRAM; start this before running ingestion)"
else
    LOADED=$(echo "$VISION_RESP" \
        | python3 -c "import sys,json; print(', '.join(m['id'] for m in json.load(sys.stdin)['data']))" \
        2>/dev/null || echo "unknown")
    echo "      ✓ Reachable — loaded model(s): $LOADED"
fi

echo ""
echo "============================================="
echo "  Setup complete!"
echo ""
echo "  Activate the venv:"
echo "    source .venv/bin/activate"
echo ""
echo "  Next steps:"
echo "    1. Fill in .env (copy from .env.example)"
echo "    2. Sync corpus:  tar -xzf cortex-corpus.tar.gz  (from team chat)"
echo "    3. Run ingestion: python scripts/run_ingestion.py"
echo "============================================="
