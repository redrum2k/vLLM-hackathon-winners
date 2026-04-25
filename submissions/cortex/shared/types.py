# DO NOT EDIT after hour 1 without team agreement. This is the contract
# between pipeline/, evaluation/, and ui/.

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Chunk:
    text: str
    source: str          # filename, doc id, or "slack:#channel-name"
    page: int | None     # for PDFs; None for images, text files, and Slack
    chunk_id: str
    is_visual: bool = False  # True if extracted from image/chart by vision model
    metadata: dict = field(default_factory=dict)


@dataclass
class RetrievalResult:
    chunks: list[Chunk]
    scores: list[float]
    method: str          # "cosine" | "hybrid" | "hybrid_reranked"


@dataclass
class Answer:
    text: str
    citations: list[str]   # source filenames / slack channel strings
    retrieval: RetrievalResult
    latency_ms: float


# Implemented in pipeline/retriever.py + pipeline/generator.py
def query(question: str, role: str = "default", method: str = "cosine") -> Answer:
    """The single entrypoint the UI and evaluation harness call."""
    raise NotImplementedError
