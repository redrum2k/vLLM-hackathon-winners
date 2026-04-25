"""Multimodal document ingestion via Llama 3.2 Vision into ChromaDB.

Sources:
  data/corpus/drive/  — PDFs, images, plain text (via Vision model for visual content)
  data/corpus/slack/  — Slack export JSON files (thread + windowed chunking)

Usage:
  from pipeline.ingestion import ingest_corpus
  n = ingest_corpus()
"""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

import chromadb
import fitz  # PyMuPDF
from llama_index.core import Document, StorageContext, VectorStoreIndex
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.schema import TextNode
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.vector_stores.chroma import ChromaVectorStore
from openai import OpenAI

from shared.config import (
    CHROMA_COLLECTION,
    CHROMA_PERSIST_DIR,
    CORPUS_DIR,
    EMBEDDING_MODEL,
    VISION_MODEL,
    VLLM_VISION_ENDPOINT,
)
from shared.types import Chunk

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
TEXT_EXTS  = {".txt", ".md", ".csv", ".rst", ".html"}

_SLACK_SKIP_SUBTYPES = {
    "channel_join", "channel_leave", "channel_archive",
    "channel_unarchive", "channel_purpose", "channel_topic",
    "channel_name", "bot_message",
}

_VISION_PROMPT = (
    "Transcribe all text on this page. Describe all charts, diagrams, and tables "
    "in detail, including specific numbers, labels, and visual structure. Be exhaustive "
    "— this description replaces the original page for downstream search."
)


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _chunk_id(source: str, page: int | None, text: str) -> str:
    key = f"{source}:{page}:{text[:64]}"
    return hashlib.md5(key.encode()).hexdigest()


def _describe_image(client: OpenAI, image_bytes: bytes) -> str:
    b64 = base64.b64encode(image_bytes).decode()
    resp = client.chat.completions.create(
        model=VISION_MODEL,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                {"type": "text", "text": _VISION_PROMPT},
            ],
        }],
        max_tokens=1024,
    )
    return resp.choices[0].message.content or ""


# ---------------------------------------------------------------------------
# drive/ — PDFs, images, text
# ---------------------------------------------------------------------------

def _ingest_pdf(path: Path, vision_client: OpenAI) -> list[Chunk]:
    chunks = []
    doc = fitz.open(str(path))
    for i, page in enumerate(doc):
        pix = page.get_pixmap(dpi=150)
        text = _describe_image(vision_client, pix.tobytes("png"))
        if not text.strip():
            continue
        chunks.append(Chunk(
            text=text,
            source=path.name,
            page=i + 1,
            chunk_id=_chunk_id(path.name, i + 1, text),
            is_visual=True,
            metadata={"file_path": str(path), "type": "pdf_page"},
        ))
    return chunks


def _ingest_image(path: Path, vision_client: OpenAI) -> list[Chunk]:
    text = _describe_image(vision_client, path.read_bytes())
    if not text.strip():
        return []
    return [Chunk(
        text=text,
        source=path.name,
        page=None,
        chunk_id=_chunk_id(path.name, None, text),
        is_visual=True,
        metadata={"file_path": str(path), "type": "image"},
    )]


def _ingest_text(path: Path) -> list[Chunk]:
    raw = path.read_text(errors="replace")
    splitter = SentenceSplitter(chunk_size=512, chunk_overlap=64)
    nodes = splitter.get_nodes_from_documents([Document(text=raw)])
    chunks = []
    for node in nodes:
        text = node.get_content()
        if not text.strip():
            continue
        chunks.append(Chunk(
            text=text,
            source=path.name,
            page=None,
            chunk_id=_chunk_id(path.name, None, text),
            is_visual=False,
            metadata={"file_path": str(path), "type": "text"},
        ))
    return chunks


def _ingest_drive(drive_dir: str, vision_client: OpenAI) -> list[Chunk]:
    chunks: list[Chunk] = []
    for path in sorted(Path(drive_dir).rglob("*")):
        if not path.is_file():
            continue
        ext = path.suffix.lower()
        if ext == ".pdf":
            print(f"  [pdf]   {path.relative_to(drive_dir)}")
            chunks.extend(_ingest_pdf(path, vision_client))
        elif ext in IMAGE_EXTS:
            print(f"  [img]   {path.relative_to(drive_dir)}")
            chunks.extend(_ingest_image(path, vision_client))
        elif ext in TEXT_EXTS:
            print(f"  [text]  {path.relative_to(drive_dir)}")
            chunks.extend(_ingest_text(path))
        else:
            print(f"  [skip]  {path.relative_to(drive_dir)}")
    return chunks


# ---------------------------------------------------------------------------
# slack/ — Slack export JSON
# ---------------------------------------------------------------------------

def _is_usable(msg: dict) -> bool:
    if msg.get("type") != "message":
        return False
    if msg.get("subtype", "") in _SLACK_SKIP_SUBTYPES:
        return False
    if msg.get("bot_id"):
        return False
    return bool(msg.get("text", "").strip())


def _render(msg: dict, users: dict[str, str]) -> str:
    uid = msg.get("user", "unknown")
    return f"{users.get(uid, uid)}: {msg.get('text', '').strip()}"


def _group_messages(messages: list[dict], channel: str, users: dict[str, str]) -> list[Chunk]:
    source = f"slack:#{channel}"

    # Separate threaded from non-threaded usable messages
    threads: dict[str, list[dict]] = {}   # thread_ts → all msgs in thread
    non_threaded: list[dict] = []

    for msg in messages:
        if not _is_usable(msg):
            continue
        ts = msg.get("ts", "")
        thread_ts = msg.get("thread_ts")

        if thread_ts and thread_ts != ts:
            threads.setdefault(thread_ts, []).append(msg)       # reply
        elif msg.get("reply_count", 0) > 0 or (thread_ts and thread_ts == ts):
            threads.setdefault(ts, [msg])                        # thread parent
        else:
            non_threaded.append(msg)

    chunks: list[Chunk] = []

    # Thread-based chunks (parent + all replies = one Chunk)
    for thread_ts, thread_msgs in threads.items():
        parent = next((m for m in messages if m.get("ts") == thread_ts), None)
        all_msgs = ([parent] if parent and parent not in thread_msgs else []) + thread_msgs
        seen: set[str] = set()
        deduped = [m for m in all_msgs if _is_usable(m) and not seen.__contains__(m.get("ts")) and not seen.add(m.get("ts"))]  # type: ignore[func-returns-value]
        text = "\n".join(_render(m, users) for m in deduped)
        if not text.strip():
            continue
        chunks.append(Chunk(
            text=text,
            source=source,
            page=None,
            chunk_id=_chunk_id(source, None, text),
            is_visual=False,
            metadata={"channel": channel, "thread_ts": thread_ts, "type": "slack_thread"},
        ))

    # Non-threaded: sliding window of 5 messages, step=3
    window, step = 5, 3
    for i in range(0, max(1, len(non_threaded) - window + 1), step):
        batch = non_threaded[i : i + window]
        text = "\n".join(_render(m, users) for m in batch)
        if not text.strip():
            continue
        chunks.append(Chunk(
            text=text,
            source=source,
            page=None,
            chunk_id=_chunk_id(source, None, text),
            is_visual=False,
            metadata={"channel": channel, "first_ts": batch[0].get("ts", ""), "type": "slack_window"},
        ))

    return chunks


def _load_users(slack_dir: str) -> dict[str, str]:
    p = Path(slack_dir) / "users.json"
    if not p.exists():
        return {}
    users_data = json.loads(p.read_text())
    return {
        u["id"]: u.get("profile", {}).get("display_name") or u.get("name", u["id"])
        for u in users_data
    }


def _ingest_slack(slack_dir: str) -> list[Chunk]:
    slack_path = Path(slack_dir)
    if not slack_path.exists():
        print(f"  [slack] {slack_dir} not found — skipping")
        return []

    users = _load_users(slack_dir)
    chunks: list[Chunk] = []

    for channel_dir in sorted(p for p in slack_path.iterdir() if p.is_dir()):
        all_msgs: list[dict] = []
        for day_file in sorted(channel_dir.glob("*.json")):
            try:
                day_msgs = json.loads(day_file.read_text())
                if isinstance(day_msgs, list):
                    all_msgs.extend(day_msgs)
            except json.JSONDecodeError:
                print(f"  [warn]  Could not parse {day_file.name}")

        channel_chunks = _group_messages(all_msgs, channel_dir.name, users)
        print(f"  [slack] #{channel_dir.name}: {len(channel_chunks)} chunks")
        chunks.extend(channel_chunks)

    return chunks


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def ingest_corpus(corpus_dir: str = CORPUS_DIR) -> int:
    """Ingest all documents in corpus_dir into ChromaDB.
    Returns the number of chunks ingested."""
    corpus_path = Path(corpus_dir)
    drive_dir = str(corpus_path / "drive")
    slack_dir = str(corpus_path / "slack")

    vision_client = OpenAI(base_url=VLLM_VISION_ENDPOINT, api_key="not-needed")

    chunks: list[Chunk] = []

    if Path(drive_dir).exists():
        print(f"\n[drive] Ingesting {drive_dir} ...")
        drive_chunks = _ingest_drive(drive_dir, vision_client)
        print(f"  → {len(drive_chunks)} chunks from drive/")
        chunks.extend(drive_chunks)
    else:
        print(f"\n[drive] {drive_dir} not found — skipping")

    print(f"\n[slack] Ingesting {slack_dir} ...")
    slack_chunks = _ingest_slack(slack_dir)
    print(f"  → {len(slack_chunks)} chunks from slack/")
    chunks.extend(slack_chunks)

    if not chunks:
        print("\nNo chunks produced — nothing to ingest.")
        return 0

    # Convert our Chunks to LlamaIndex TextNodes
    nodes = [
        TextNode(
            text=c.text,
            id_=c.chunk_id,
            metadata={
                "source":    c.source,
                "page":      c.page,
                "is_visual": c.is_visual,
                **c.metadata,
            },
        )
        for c in chunks
    ]

    print(f"\n[embed]  Loading {EMBEDDING_MODEL} ...")
    embed_model = HuggingFaceEmbedding(model_name=EMBEDDING_MODEL)

    print(f"[chroma] Opening {CHROMA_PERSIST_DIR} / {CHROMA_COLLECTION} ...")
    db = chromadb.PersistentClient(path=CHROMA_PERSIST_DIR)
    collection = db.get_or_create_collection(CHROMA_COLLECTION)
    vector_store = ChromaVectorStore(chroma_collection=collection)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)

    print(f"[index]  Embedding and storing {len(nodes)} nodes ...")
    VectorStoreIndex(nodes, storage_context=storage_context, embed_model=embed_model)

    total = collection.count()
    print(f"\n✓ Done. {total} total chunks in '{CHROMA_COLLECTION}'")
    return len(chunks)
