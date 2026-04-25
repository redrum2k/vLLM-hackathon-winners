"""Retrieval and answer generation. Owned by Pipeline Lead.

Implements three retrieval methods:
  - retrieve_cosine()         — dense vector similarity (ChromaDB)
  - retrieve_hybrid()         — BM25 sparse + cosine dense, fused with RRF
  - retrieve_hybrid_reranked()— hybrid candidates reranked by cross-encoder

query() is the single entrypoint called by ui/ and evaluation/.
"""

from __future__ import annotations

import time

import chromadb
from llama_index.core import StorageContext, VectorStoreIndex
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.vector_stores.chroma import ChromaVectorStore
from openai import OpenAI
from rank_bm25 import BM25Okapi
from sentence_transformers import CrossEncoder

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

# Module-level caches — loaded once per process
_index_cache: VectorStoreIndex | None = None
_embed_cache: HuggingFaceEmbedding | None = None
_bm25_cache: BM25Okapi | None = None
_bm25_chunks: list[Chunk] | None = None
_reranker_cache: CrossEncoder | None = None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

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


def _get_bm25() -> tuple[BM25Okapi, list[Chunk]]:
    global _bm25_cache, _bm25_chunks
    if _bm25_cache is None:
        db = chromadb.PersistentClient(path=CHROMA_PERSIST_DIR)
        col = db.get_collection(CHROMA_COLLECTION)
        result = col.get(include=["documents", "metadatas", "ids"])
        chunks = [
            Chunk(
                text=doc,
                source=meta.get("source", ""),
                page=meta.get("page"),
                chunk_id=id_,
                is_visual=meta.get("is_visual", False),
                metadata=meta,
            )
            for doc, meta, id_ in zip(
                result["documents"], result["metadatas"], result["ids"]
            )
        ]
        tokenized = [c.text.lower().split() for c in chunks]
        _bm25_cache = BM25Okapi(tokenized)
        _bm25_chunks = chunks
    return _bm25_cache, _bm25_chunks


def _get_reranker() -> CrossEncoder:
    global _reranker_cache
    if _reranker_cache is None:
        _reranker_cache = CrossEncoder("BAAI/bge-reranker-base")
    return _reranker_cache


def _rrf_fuse(
    r1: RetrievalResult, r2: RetrievalResult, top_k: int, k: int = 60
) -> RetrievalResult:
    """Reciprocal Rank Fusion of two result lists."""
    scores: dict[str, float] = {}
    chunks_by_id: dict[str, Chunk] = {}
    for rank, chunk in enumerate(r1.chunks):
        scores[chunk.chunk_id] = scores.get(chunk.chunk_id, 0.0) + 1 / (k + rank + 1)
        chunks_by_id[chunk.chunk_id] = chunk
    for rank, chunk in enumerate(r2.chunks):
        scores[chunk.chunk_id] = scores.get(chunk.chunk_id, 0.0) + 1 / (k + rank + 1)
        chunks_by_id[chunk.chunk_id] = chunk
    sorted_ids = sorted(scores, key=lambda x: scores[x], reverse=True)[:top_k]
    return RetrievalResult(
        chunks=[chunks_by_id[i] for i in sorted_ids],
        scores=[scores[i] for i in sorted_ids],
        method="hybrid",
    )


# ---------------------------------------------------------------------------
# Public retrieval functions
# ---------------------------------------------------------------------------

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


def retrieve_bm25(question: str, top_k: int = 20) -> RetrievalResult:
    """Return top-k chunks by BM25 sparse keyword matching."""
    bm25, all_chunks = _get_bm25()
    scores = bm25.get_scores(question.lower().split())
    top_idx = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]
    return RetrievalResult(
        chunks=[all_chunks[i] for i in top_idx],
        scores=[float(scores[i]) for i in top_idx],
        method="bm25",
    )


def retrieve_hybrid(question: str, top_k: int = 5) -> RetrievalResult:
    """Hybrid retrieval: RRF fusion of cosine (dense) + BM25 (sparse)."""
    cosine = retrieve_cosine(question, top_k=top_k * 4)
    bm25 = retrieve_bm25(question, top_k=top_k * 4)
    return _rrf_fuse(cosine, bm25, top_k=top_k)


def retrieve_hybrid_reranked(question: str, top_k: int = 5) -> RetrievalResult:
    """Hybrid retrieval with cross-encoder reranking."""
    candidates = retrieve_hybrid(question, top_k=top_k * 10)
    reranker = _get_reranker()
    pairs = [[question, c.text] for c in candidates.chunks]
    rerank_scores = reranker.predict(pairs)
    ranked = sorted(
        zip(rerank_scores, candidates.chunks), key=lambda x: x[0], reverse=True
    )[:top_k]
    return RetrievalResult(
        chunks=[c for _, c in ranked],
        scores=[float(s) for s, _ in ranked],
        method="hybrid_reranked",
    )


# ---------------------------------------------------------------------------
# Main entrypoint
# ---------------------------------------------------------------------------

def query(question: str, role: str = "default", method: str = "cosine") -> Answer:
    """Single entrypoint called by ui/ and evaluation/.

    Args:
        question: natural-language question
        role:     "faculty" | "student" | "guest" | "default"
        method:   "cosine" | "hybrid" | "hybrid_reranked"
    """
    t0 = time.time()

    if method == "cosine":
        retrieval = retrieve_cosine(question)
    elif method == "hybrid":
        retrieval = retrieve_hybrid(question)
    elif method == "hybrid_reranked":
        retrieval = retrieve_hybrid_reranked(question)
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
