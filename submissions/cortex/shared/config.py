"""Centralized configuration. All values are overridable via environment variables.
Copy .env.example to .env and fill in values before running anything.
"""

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env", override=False)
except ImportError:
    pass

# vLLM endpoints (running on Brev — override these with the Brev public address)
VLLM_TEXT_ENDPOINT   = os.getenv("VLLM_TEXT_ENDPOINT",   "http://localhost:8000/v1")
VLLM_VISION_ENDPOINT = os.getenv("VLLM_VISION_ENDPOINT", "http://localhost:8001/v1")

# Model names (must match what vLLM was started with)
TEXT_MODEL   = os.getenv("TEXT_MODEL",   "/models/llama-3.1-8b-instruct")
VISION_MODEL = os.getenv("VISION_MODEL", "/models/qwen2.5-vl-7b")

# ChromaDB
CHROMA_PERSIST_DIR = os.getenv("CHROMA_PERSIST_DIR", "./chroma_db")
CHROMA_COLLECTION  = os.getenv("CHROMA_COLLECTION",  "cortex_corpus")

# Corpus — local mirror synced from Google Drive and Slack before ingestion runs
CORPUS_DIR          = os.getenv("CORPUS_DIR",          "./data/corpus")
CORPUS_DRIVE_SUBDIR = os.getenv("CORPUS_DRIVE_SUBDIR", "drive")   # PDFs, images, docs
CORPUS_SLACK_SUBDIR = os.getenv("CORPUS_SLACK_SUBDIR", "slack")   # Slack export JSON

# Embedding model (runs locally via HuggingFace)
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")

# Derived paths (computed, not overridable — change the vars above instead)
CORPUS_DRIVE_DIR = str(Path(CORPUS_DIR) / CORPUS_DRIVE_SUBDIR)
CORPUS_SLACK_DIR = str(Path(CORPUS_DIR) / CORPUS_SLACK_SUBDIR)
