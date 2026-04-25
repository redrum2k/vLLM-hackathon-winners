"""
Atlas RAG server — FastAPI wrapper around the ChromaDB + vLLM pipeline.

Run:
    py -3.11 -m uvicorn rag_server:app --port 8002

Env vars (all optional, override in .env):
    CHROMA_PERSIST_DIR   path to chroma_db   (default: ./chroma_db)
    CHROMA_COLLECTION    collection name      (default: cortex_corpus)
    VLLM_TEXT_ENDPOINT   LLM API base URL     (default: http://localhost:8000/v1)
    TEXT_MODEL           model name           (default: /models/llama-3.1-8b-instruct)
    EMBEDDING_MODEL      HF embedding model   (default: BAAI/bge-small-en-v1.5)
"""

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env", override=False)
except ImportError:
    pass

import chromadb
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from llama_index.core import VectorStoreIndex, StorageContext
from llama_index.core.postprocessor import SentenceTransformerRerank
from llama_index.core.prompts import PromptTemplate
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.llms.openai_like import OpenAILike
from llama_index.vector_stores.chroma import ChromaVectorStore

# ── Config ────────────────────────────────────────────────────────────────────
_here = Path(__file__).parent                     # .../submissions/cortex
_repo = _here.parent.parent                       # .../vLLM-hackathon-winners
CHROMA_DIR   = os.getenv("CHROMA_PERSIST_DIR", str(_here / "chroma_db"))
COLLECTION   = os.getenv("CHROMA_COLLECTION",  "cortex_corpus")
EMBED_MODEL  = os.getenv("EMBEDDING_MODEL",    "BAAI/bge-small-en-v1.5")
LLM_ENDPOINT = os.getenv("VLLM_TEXT_ENDPOINT", "http://localhost:8000/v1")
LLM_MODEL    = os.getenv("TEXT_MODEL",         "/models/llama-3.1-8b-instruct")

# ── System prompts ────────────────────────────────────────────────────────────
SYSTEM_PROMPTS = {
    "faculty": (
        "You are Atlas, a research and administrative assistant for Boston University faculty. "
        "You support professors, researchers, and staff with institutional knowledge, "
        "research context, policy questions, and cross-department coordination. "
        "Answer authoritatively and concisely using only the provided context from BU's "
        "internal documents and Slack channels. Cite specific sources where possible. "
        "If the context is insufficient, state that clearly rather than speculating."
    ),
    "student": (
        "You are Atlas, a helpful assistant for Boston University students. "
        "You help with academic questions, campus resources, course information, "
        "deadlines, events, and student life at BU. "
        "Answer clearly and accessibly using the provided context. "
        "Use plain, friendly language. If you don't have enough information to answer fully, "
        "acknowledge it and suggest the student contact the relevant BU office."
    ),
    "guest": (
        "You are Atlas, a public-facing information assistant for Boston University. "
        "You help visitors, prospective students, alumni, and external partners "
        "learn about BU programs, events, research, and campus life. "
        "Answer using the provided context. Be welcoming, concise, and avoid internal jargon. "
        "If you don't have enough information, provide general guidance and suggest "
        "visiting bu.edu for more details."
    ),
}

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="Atlas RAG Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared resources — loaded once on first request
_index = None
_reranker = None
_llm = None


def _load_resources():
    global _index, _reranker, _llm
    if _index is not None:
        return

    print(f"Loading ChromaDB from {CHROMA_DIR} / {COLLECTION} ...")
    embed_model = HuggingFaceEmbedding(model_name=EMBED_MODEL)
    client = chromadb.PersistentClient(path=CHROMA_DIR)
    collection_obj = client.get_or_create_collection(COLLECTION)
    vector_store = ChromaVectorStore(chroma_collection=collection_obj)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)
    _index = VectorStoreIndex.from_vector_store(vector_store, storage_context=storage_context, embed_model=embed_model)

    print("Loading reranker ...")
    _reranker = SentenceTransformerRerank(model="BAAI/bge-reranker-large", top_n=5)

    print(f"Connecting to LLM at {LLM_ENDPOINT} ...")
    _llm = OpenAILike(
        model=LLM_MODEL,
        api_base=LLM_ENDPOINT,
        api_key="not-needed",
        is_chat_model=True,
        temperature=0.2,
        max_tokens=512,
    )
    print("Ready.")


# ── Request / response models ─────────────────────────────────────────────────
class QueryRequest(BaseModel):
    question: str
    mode: str = "Hybrid + Reranker"   # "Cosine" | "Hybrid" | "Hybrid + Reranker"
    role: str = "student"             # "faculty" | "student" | "guest"


class ContextChunk(BaseModel):
    doc_title: str
    snippet: str
    score: float
    doc_type: str = "page"


class QueryResponse(BaseModel):
    answer: str
    contexts: list[ContextChunk]
    mode: str
    role: str


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "chroma_dir": CHROMA_DIR, "collection": COLLECTION}


@app.post("/query", response_model=QueryResponse)
def query(req: QueryRequest):
    try:
        _load_resources()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Failed to load RAG resources: {e}")

    system_prompt = SYSTEM_PROMPTS.get(req.role, SYSTEM_PROMPTS["student"])

    # Retrieval parameters per mode
    if req.mode == "Hybrid + Reranker":
        top_k = 50
        postprocessors = [_reranker]
    elif req.mode == "Hybrid":
        top_k = 15
        postprocessors = []
    else:  # Cosine
        top_k = 5
        postprocessors = []

    qa_prompt = PromptTemplate(
        system_prompt + "\n\n"
        "Context information is below:\n"
        "---------------------\n"
        "{context_str}\n"
        "---------------------\n"
        "Given the context above, answer the following question.\n"
        "Question: {query_str}\n"
        "Answer: "
    )

    try:
        engine = _index.as_query_engine(
            llm=_llm,
            similarity_top_k=top_k,
            node_postprocessors=postprocessors,
            text_qa_template=qa_prompt,
        )
        response = engine.query(req.question)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RAG query failed: {e}")

    contexts = []
    for node in (response.source_nodes or [])[:3]:
        meta = node.node.metadata or {}
        title = meta.get("source") or meta.get("file_name") or node.node.node_id[:24]
        doc_type = "pdf" if str(title).endswith(".pdf") else "page"
        contexts.append(ContextChunk(
            doc_title=title,
            snippet=node.node.get_content()[:220].replace("\n", " "),
            score=round(float(node.score or 0.0), 3),
            doc_type=doc_type,
        ))

    return QueryResponse(
        answer=str(response),
        contexts=contexts,
        mode=req.mode,
        role=req.role,
    )
