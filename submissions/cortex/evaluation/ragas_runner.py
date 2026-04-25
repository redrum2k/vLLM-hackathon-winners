"""RAGAs evaluation harness. Owned by Evaluation Lead.

Runs the full eval set through any retrieval method and scores with RAGAs metrics:
  faithfulness, answer_relevancy, context_precision, context_recall

Usage:
  python -m evaluation.ragas_runner                     # cosine (default)
  python -m evaluation.ragas_runner --method hybrid
  python -m evaluation.ragas_runner --method hybrid_reranked

RAGAs uses an OpenAI-compatible LLM for scoring — it reads OPENAI_API_BASE and
OPENAI_API_KEY from the environment, which we set to point at the vLLM text
endpoint automatically.

Expand EVAL_SET with domain-specific questions before the demo.
"""

from __future__ import annotations

import argparse

from datasets import Dataset
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from ragas import evaluate
from ragas.embeddings import LangchainEmbeddingsWrapper
from ragas.llms import LangchainLLMWrapper
from ragas.metrics import (
    answer_relevancy,
    context_precision,
    context_recall,
    faithfulness,
)

from pipeline.retriever import query
from shared.config import EMBEDDING_MODEL, TEXT_MODEL, VLLM_TEXT_ENDPOINT

# ---------------------------------------------------------------------------
# Evaluation dataset
# Replace these placeholders with questions grounded in your actual corpus.
# "ground_truth" is needed only for context_recall — the other three metrics
# are reference-free and will still score without it.
# ---------------------------------------------------------------------------
EVAL_SET: list[dict] = [
    {
        "question": "PLACEHOLDER — replace with a real question from your corpus",
        "ground_truth": "PLACEHOLDER — replace with the expected answer",
    },
    {
        "question": "PLACEHOLDER — replace with a real question from your corpus",
        "ground_truth": "PLACEHOLDER — replace with the expected answer",
    },
    {
        "question": "PLACEHOLDER — replace with a real question from your corpus",
        "ground_truth": "PLACEHOLDER — replace with the expected answer",
    },
]

METRICS = [faithfulness, answer_relevancy, context_precision, context_recall]


def run_eval(method: str = "cosine", output_csv: str | None = None) -> dict:
    """Run RAGAs evaluation for a given retrieval method.

    Args:
        method:     "cosine" | "hybrid" | "hybrid_reranked"
        output_csv: path to save per-question scores CSV
                    (defaults to ragas_<method>.csv)
    Returns:
        dict of metric_name → aggregate score
    """
    # Wire RAGAs to use vLLM instead of OpenAI
    ragas_llm = LangchainLLMWrapper(ChatOpenAI(
        model=TEXT_MODEL,
        base_url=VLLM_TEXT_ENDPOINT,
        api_key="not-needed",
        temperature=0,
    ))
    ragas_embeddings = LangchainEmbeddingsWrapper(OpenAIEmbeddings(
        model="text-embedding-3-small",  # name ignored — vLLM serves its own embedding model
        base_url=VLLM_TEXT_ENDPOINT,
        api_key="not-needed",
    ))

    print(f"[eval] Method: {method}  |  Questions: {len(EVAL_SET)}")
    rows = []
    for i, item in enumerate(EVAL_SET, 1):
        q = item["question"]
        print(f"  [{i}/{len(EVAL_SET)}] {q[:80]}")
        answer = query(q, method=method)
        rows.append({
            "question":     q,
            "answer":       answer.text,
            "contexts":     [c.text for c in answer.retrieval.chunks],
            "ground_truth": item.get("ground_truth", ""),
        })

    dataset = Dataset.from_list(rows)

    print("\n[eval] Scoring with RAGAs ...")
    result = evaluate(dataset, metrics=METRICS, llm=ragas_llm, embeddings=ragas_embeddings)

    print("\n--- RAGAs results ---")
    print(result)

    csv_path = output_csv or f"ragas_{method}.csv"
    result.to_pandas().to_csv(csv_path, index=False)
    print(f"\n✓ Per-question scores saved to {csv_path}")

    return dict(result)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--method",
        choices=["cosine", "hybrid", "hybrid_reranked"],
        default="cosine",
        help="Retrieval method to evaluate",
    )
    parser.add_argument("--output-csv", default=None)
    args = parser.parse_args()
    run_eval(method=args.method, output_csv=args.output_csv)
