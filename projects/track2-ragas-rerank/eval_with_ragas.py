"""
Evaluate the RAG pipeline with RAGAs metrics.

RAGAs computes:
  - faithfulness: are answer claims grounded in retrieved context?
  - answer_relevancy: is the answer relevant to the question?
  - context_precision: how much of the retrieved context is actually used?
  - context_recall: did we retrieve everything needed?

The first three don't need ground-truth answers; context_recall does — we
provide a small curated Q/A set in-file so attendees can run the eval
immediately and then expand it.

Usage:
    python3 eval_with_ragas.py
"""

import os
from datasets import Dataset
from ragas import evaluate
from ragas.metrics.collections import (
    faithfulness,
    answer_relevancy,
    context_precision,
    context_recall,
)

from query_with_reranker import build_query_engine


# Curated evaluation set. Expand this with domain-specific questions.
EVAL_SET = [
    {
        "question": "What is KV-cache and why does vLLM manage it specially?",
        "ground_truth": "KV-cache stores the key-value tensors from attention so they don't need to be recomputed for each new token. vLLM manages it with PagedAttention, allocating fixed-size pages to reduce fragmentation and enable prefix sharing across requests.",
    },
    {
        "question": "How does speculative decoding speed up generation?",
        "ground_truth": "Speculative decoding uses a small 'draft' model to propose multiple tokens that a larger target model verifies in a single forward pass. Accepted tokens are emitted without the full cost of running the target model on each position.",
    },
    {
        "question": "What is the role of the Inference Gateway in llm-d?",
        "ground_truth": "The Inference Gateway routes incoming requests to vLLM replicas, supports multi-model deployment, and coordinates prefill/decode disaggregation. It acts as the front door for a Kubernetes-native LLM serving cluster.",
    },
]


def run_eval():
    print("Building query engine...")
    engine = build_query_engine("./chroma_db", "track2_docs")

    print(f"Running {len(EVAL_SET)} eval queries...")
    rows = []
    for item in EVAL_SET:
        q = item["question"]
        response = engine.query(q)
        rows.append({
            "question": q,
            "answer": str(response),
            "contexts": [n.node.get_content() for n in response.source_nodes],
            "ground_truth": item["ground_truth"],
        })

    dataset = Dataset.from_list(rows)

    print("\nScoring with RAGAs...")
    # Point RAGAs at vLLM via OPENAI_API_BASE env var (it uses OpenAI SDK).
    os.environ.setdefault("OPENAI_API_BASE",
                          os.getenv("VLLM_ENDPOINT", "http://localhost:8000/v1"))
    os.environ.setdefault("OPENAI_API_KEY", "not-needed")

    result = evaluate(
        dataset,
        metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
    )

    print("\n--- RAGAs results ---")
    print(result)

    # Also dump per-row for the demo
    df = result.to_pandas()
    df.to_csv("ragas_results.csv", index=False)
    print("\n✓ Full per-question scores saved to ragas_results.csv")


if __name__ == "__main__":
    run_eval()
