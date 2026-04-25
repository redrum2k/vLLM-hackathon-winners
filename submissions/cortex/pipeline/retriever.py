"""Cosine retrieval from ChromaDB and answer generation via vLLM. Owned by Pipeline Lead.

Currently implements:
  - retrieve_cosine()   — embedding similarity, top-k from ChromaDB
  - query()             — the single entrypoint called by ui/ and evaluation/

Hybrid and reranked retrieval are TODO — Pipeline Lead adds them here and updates
query() to dispatch on the `method` argument.
"""

from __future__ import annotations

import time

import chromadb
from llama_index.core import StorageContext, VectorStoreIndex
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.vector_stores.chroma import ChromaVectorStore
from openai import OpenAI

from shared.config import (
    CHROMA_COLLECTION,
    CHROMA_PERSIST_DIR,
    EMBEDDING_MODEL,
    TEXT_MODEL,
    VLLM_TEXT_ENDPOINT,
)
from shared.types import Answer, Chunk, RetrievalResult

_SYSTEM_PROMPTS: dict[str, str] = {
    "faculty": (
        "You are a knowledgeable academic assistant for faculty members. "
        "Provide detailed, technical answers with precise references to source materials. "
        "Include nuance, methodology, and supporting evidence where relevant."
    ),
    "student": (
        "You are a helpful academic assistant for students. "
        "Explain concepts clearly and accessibly, breaking down complex ideas into "
        "understandable steps. Use examples where helpful."
    ),
    "guest": (
        "You are a concise assistant for guests unfamiliar with this institution. "
        "Give brief, jargon-free overviews. Focus on the most important information only."
    ),
    "default": (
        "You are a helpful assistant. Answer the question using only the context provided. "
        "If the answer is not in the context, say so."
    ),
}

# Module-level cache so the embedding model and index are only loaded once per process
_index_cache: VectorStoreIndex | None = None
_embed_cache: HuggingFaceEmbedding | None = None


def _get_index() -> tuple[VectorStoreIndex, HuggingFaceEmbedding]:
    global _index_cache, _embed_cache
    if _index_cache is None:
        _embed_cache = HuggingFaceEmbedding(model_name=EMBEDDING_MODEL)
        db = chromadb.PersistentClient(path=CHROMA_PERSIST_DIR)
        collection = db.get_collection(CHROMA_COLLECTION)
        vector_store = ChromaVectorStore(chroma_collection=collection)
        StorageContext.from_defaults(vector_store=vector_store)
        _index_cache = VectorStoreIndex.from_vector_store(
            vector_store, embed_model=_embed_cache
        )
    return _index_cache, _embed_cache


def retrieve_cosine(question: str, top_k: int = 5) -> RetrievalResult:
    """Return top-k chunks by cosine similarity to the question embedding."""
    index, _ = _get_index()
    retriever = index.as_retriever(similarity_top_k=top_k)
    nodes = retriever.retrieve(question)

    chunks, scores = [], []
    for node in nodes:
        meta = node.node.metadata
        chunks.append(Chunk(
            text=node.node.get_content(),
            source=meta.get("source", ""),
            page=meta.get("page"),
            chunk_id=node.node.node_id,
            is_visual=meta.get("is_visual", False),
            metadata=meta,
        ))
        scores.append(float(node.score or 0.0))

    return RetrievalResult(chunks=chunks, scores=scores, method="cosine")


def query(question: str, role: str = "default", method: str = "cosine") -> Answer:
    """Single entrypoint called by ui/ and evaluation/.

    Args:
        question: natural-language question
        role:     reserved for future persona/system-prompt switching
        method:   "cosine" | "hybrid" | "hybrid_reranked"
    """
    t0 = time.time()

    if method == "cosine":
        retrieval = retrieve_cosine(question)
    elif method in ("hybrid", "hybrid_reranked"):
        # TODO: Pipeline Lead implements these and removes this error
        raise NotImplementedError(f"method '{method}' not yet implemented — see retriever.py")
    else:
        raise ValueError(f"Unknown method: {method!r}")

    system_prompt = _SYSTEM_PROMPTS.get(role, _SYSTEM_PROMPTS["default"])
    context = "\n\n".join(f"[{c.source}]\n{c.text}" for c in retrieval.chunks)
    prompt = (
        "Answer the question using only the context provided. "
        "If the answer is not in the context, say so.\n\n"
        f"Context:\n{context}\n\n"
        f"Question: {question}\n\nAnswer:"
    )

    client = OpenAI(base_url=VLLM_TEXT_ENDPOINT, api_key="not-needed")
    resp = client.chat.completions.create(
        model=TEXT_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": prompt},
        ],
        temperature=0.2,
        max_tokens=512,
    )
    answer_text = (resp.choices[0].message.content or "").strip()
    citations = list(dict.fromkeys(c.source for c in retrieval.chunks))

    return Answer(
        text=answer_text,
        citations=citations,
        retrieval=retrieval,
        latency_ms=(time.time() - t0) * 1000,
    )
