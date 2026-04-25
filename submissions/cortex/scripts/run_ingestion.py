"""CLI wrapper for ingest_corpus(). Run this to populate ChromaDB from the local corpus mirror.

Usage:
    python scripts/run_ingestion.py
    python scripts/run_ingestion.py --corpus-dir /path/to/corpus
    python scripts/run_ingestion.py --corpus-dir ./data/corpus --dry-run

Prereqs:
    1. Both vLLM endpoints must be running (vision endpoint required for PDFs/images)
    2. Corpus synced to ./data/corpus/drive/ and ./data/corpus/slack/
    3. .env filled in (or env vars set)
"""

import argparse
import sys
import time
from pathlib import Path

# Load .env before importing anything that reads config
from dotenv import load_dotenv
load_dotenv()

from shared.config import CORPUS_DIR, VLLM_VISION_ENDPOINT
from pipeline.ingestion import ingest_corpus


def check_corpus(corpus_dir: str) -> bool:
    """Warn if expected subdirs are missing. Returns False if nothing to ingest."""
    root = Path(corpus_dir)
    if not root.exists():
        print(f"ERROR: Corpus directory not found: {corpus_dir}")
        print("  Sync it first:")
        print("    drive/ : rclone sync gdrive:CortexCorpus ./data/corpus/drive")
        print("    slack/ : extract the Slack export zip into ./data/corpus/slack/")
        return False

    found = []
    for subdir in ("drive", "slack"):
        p = root / subdir
        if p.exists():
            files = list(p.rglob("*"))
            found.append(f"  {subdir}/  ({len(files)} files)")
        else:
            print(f"  WARNING: {subdir}/ not found under {corpus_dir} — will be skipped")

    if not found:
        print("ERROR: Neither drive/ nor slack/ found. Nothing to ingest.")
        return False

    print("Corpus contents:")
    for line in found:
        print(line)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest the Cortex corpus into ChromaDB.")
    parser.add_argument(
        "--corpus-dir",
        default=CORPUS_DIR,
        help=f"Path to local corpus mirror (default: {CORPUS_DIR})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Check corpus and endpoints without actually ingesting",
    )
    args = parser.parse_args()

    print("=" * 50)
    print("  Cortex ingestion")
    print(f"  Corpus : {args.corpus_dir}")
    print(f"  Vision : {VLLM_VISION_ENDPOINT}")
    print("=" * 50)

    if not check_corpus(args.corpus_dir):
        sys.exit(1)

    if args.dry_run:
        print("\nDry run — exiting without ingesting.")
        sys.exit(0)

    print("\nStarting ingestion ... (this will take a while for large corpora)\n")
    t0 = time.time()
    try:
        n = ingest_corpus(corpus_dir=args.corpus_dir)
    except Exception as e:
        print(f"\nERROR: Ingestion failed — {e}")
        print("\nCommon causes:")
        print("  - Vision endpoint not running  → start vLLM on port 8001 first")
        print("  - ChromaDB permission error    → check CHROMA_PERSIST_DIR in .env")
        print("  - HuggingFace model not cached → check EMBEDDING_MODEL and network")
        raise

    elapsed = time.time() - t0
    print(f"\n{'=' * 50}")
    print(f"  Done. {n} chunks ingested in {elapsed:.1f}s")
    print(f"  Run eval: python -m evaluation.ragas_runner --method cosine")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    main()
