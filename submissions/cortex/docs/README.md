# Cortex — Multimodal RAG

Multimodal RAG system built on vLLM + LlamaIndex + ChromaDB for the TOA vLLM/LLM-D Hackathon (April 25, 2026).

---

## Quick start

```bash
git clone https://github.com/redrum2k/vLLM-hackathon-winners
cd vLLM-hackathon-winners/submissions/cortex

# Install uv if you don't have it
curl -LsSf https://astral.sh/uv/install.sh | sh && source $HOME/.local/bin/env

# Set up venv and install dependencies
cp .env.example .env          # then fill in your Brev endpoint addresses
bash scripts/setup.sh

# Activate venv
source .venv/bin/activate

# Sync corpus (get the tarball from team chat)
tar -xzf cortex-corpus.tar.gz

# Ingest
python scripts/run_ingestion.py

# Query
python -c "from pipeline.retriever import query; a = query('your question'); print(a.text)"

# Evaluate
python -m evaluation.ragas_runner --method cosine
```

---

## NVIDIA Brev setup

> One person on the team does this. Everyone else joins via SSH sharing (see below).

### 1. Create account and org

1. Go to [brev.nvidia.com](http://brev.nvidia.com) → create an account
2. Navigate to the **Team** tab → click **Generate Invite Link** → send to all teammates
3. Each teammate creates their own account and clicks the invite link to join your org

### 2. Redeem NVIDIA credits

Each team member redeems their code individually via the QR code or link shared at the hackathon.
**Important:** redeem *after* joining the org — codes are locked to one redemption per user and one org.

### 3. Launch the GPU instance

In the Brev Console:

- **Runtime:** VM Mode (Ubuntu 22.04)
- **GPU:** 2× H100 (80GB VRAM each — one GPU per model)
- **Disk:** 100 GB
- **Setup script:** paste the full contents of `launchable-configs/tier1-app-builder/setup.sh` from this repo
- **Expose ports:**
  - `8000` — vLLM text endpoint
  - `8001` — vLLM vision endpoint
  - `8888` — Jupyter

Provisioning takes **10–15 minutes** (downloads ~16 GB of model weights automatically).

### 4. Share access with teammates

Once the instance shows **Running**:

1. **SSH access:** GPU tab → click your instance → scroll to **Share SSH Access** → add each teammate's email → **Share**
2. **Jupyter access:** same page → **Using Secure Links** → **Edit Access** → add each teammate's email

### 5. Start both vLLM endpoints

SSH in and run in `tmux` so servers keep running after you disconnect:

```bash
# Start a new tmux session
tmux new -s models

# --- GPU 0: text model (port 8000) ---
# The launchable pre-created this script:
CUDA_VISIBLE_DEVICES=0 bash /workspace/start_vllm_server.sh
# Ctrl+B then " to split pane

# --- GPU 1: vision model (port 8001) ---
# HF_TOKEN must be set — Llama 3.2 Vision is a gated model
export HF_TOKEN=hf_YOUR_TOKEN_HERE
CUDA_VISIBLE_DEVICES=1 vllm serve meta-llama/Llama-3.2-11B-Vision-Instruct \
  --host 0.0.0.0 \
  --port 8001 \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.90 \
  --enable-prefix-caching \
  --dtype auto

# Ctrl+B then D to detach (servers keep running)
```

### 6. Verify both endpoints are up

```bash
curl http://localhost:8000/v1/models | python3 -m json.tool
curl http://localhost:8001/v1/models | python3 -m json.tool
```

Both should return a JSON list with their respective model IDs.

---

## Local development

You don't need a local GPU. Point your `.env` at the Brev instance's public address
and run ingestion/eval/UI from your laptop.

```bash
# .env
# ⚠ Replace YOUR_BREV_INSTANCE with your actual Brev public hostname
# (find it in the Brev Console under the instance's "Secure Links" section)
VLLM_TEXT_ENDPOINT=https://YOUR_BREV_INSTANCE.brevlab.com:8000/v1
VLLM_VISION_ENDPOINT=https://YOUR_BREV_INSTANCE.brevlab.com:8001/v1
```

Then run `bash scripts/setup.sh` — it will check both endpoints and tell you if they're reachable.

---

## Corpus sync

The corpus has two sources. Both are synced to `./data/corpus/` locally before ingestion runs.
`./data/corpus/` is gitignored — never commit it.

### Google Drive (PDFs, images, business docs)

```bash
# Install rclone (once)
brew install rclone          # macOS
# or: sudo apt install rclone   (Linux/Brev)

# Configure Drive remote (once — OAuth flow in browser)
rclone config
# → New remote → name it "gdrive" → type: drive → follow OAuth prompts

# Sync to local mirror
rclone sync gdrive:CortexCorpus ./data/corpus/drive

# Re-sync anytime the Drive folder changes
rclone sync gdrive:CortexCorpus ./data/corpus/drive
```

### Slack export (channel messages, threads)

Slack exports are generated once by a workspace admin — not a live API call.

1. Workspace admin: **Settings → Workspace settings → Import/Export Data → Export**
2. Download the resulting zip
3. Extract into `./data/corpus/slack/`:

```bash
unzip slack-export.zip -d ./data/corpus/slack/
```

Expected structure after extraction:
```
./data/corpus/slack/
├── channels.json
├── users.json
└── <channel-name>/
    ├── 2026-04-01.json
    └── 2026-04-02.json
```

### Sharing the corpus across the team

Only one person needs to do the Drive sync and Slack export. Then:

```bash
# Pack it
tar -czf cortex-corpus.tar.gz ./data/corpus/

# Share via team chat — everyone else:
tar -xzf cortex-corpus.tar.gz
```

---

## Git workflow

| Rule | Detail |
|---|---|
| One branch per person | `nick/pipeline`, `alex/evaluation`, `sam/ui`, `jordan/docs` |
| Pull before every commit | `git pull --rebase origin main` |
| Own your directory | Only edit your assigned folder — see Project structure below |
| `shared/types.py` is frozen | No edits after hour 1 without a team huddle |
| `requirements.txt` | Only Pipeline Lead edits it — others post requests in chat |
| Merging to main | One PR at a time, one teammate reviews before merge |
| Conflicts | Stop immediately and ask in team chat — do not auto-resolve |
| Never commit | `.env`, `chroma_db/`, `data/corpus/`, `*.tar.gz` |

```bash
# Daily flow
git checkout nick/pipeline
git pull --rebase origin main
# ... make changes in pipeline/ only ...
git add pipeline/some_file.py
git commit -m "Add hybrid retrieval to retriever.py"
git push origin nick/pipeline
# Open PR → ask one teammate to review → merge
```

---

## Project structure

```
submissions/cortex/
├── pipeline/          ← Pipeline Lead
│   ├── ingestion.py   # multimodal ingest (drive + slack → ChromaDB)
│   ├── retriever.py   # cosine → hybrid → reranked retrieval + query()
│   └── generator.py   # (TODO: Pipeline Lead)
├── evaluation/        ← Evaluation Lead
│   ├── ragas_runner.py  # RAGAs eval for all three retrieval methods
│   └── benchmark.py     # (TODO: Evaluation Lead)
├── ui/                ← UI Lead
│   └── app.py         # (TODO: UI Lead)
├── docs/              ← Docs/Slides Lead
│   ├── README.md      # this file
│   ├── DEMO_SCRIPT.md
│   └── slides/
├── shared/            ← frozen after hour 1
│   ├── types.py       # Chunk, RetrievalResult, Answer, query() signature
│   └── config.py      # all env vars and derived paths
├── scripts/
│   ├── setup.sh           # one-shot environment setup
│   └── run_ingestion.py   # CLI wrapper for ingestion
├── main.py            ← Pipeline Lead (integration entrypoint)
├── requirements.txt   ← Pipeline Lead
├── .env.example       # copy to .env and fill in
└── .gitignore
```
