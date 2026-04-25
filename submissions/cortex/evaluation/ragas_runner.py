"""RAGAs evaluation harness. Owned by Evaluation Lead.

Runs the full eval set through any retrieval method and scores with RAGAs metrics:
  faithfulness, context_precision, context_recall

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
from langchain_openai import ChatOpenAI
from ragas import evaluate
from ragas.llms import LangchainLLMWrapper
from ragas.metrics import ContextPrecision, ContextRecall, Faithfulness

from pipeline.retriever import query
from shared.config import TEXT_MODEL, VLLM_TEXT_ENDPOINT

# ---------------------------------------------------------------------------
# Evaluation dataset
# Replace these placeholders with questions grounded in your actual corpus.
# "ground_truth" is needed only for context_recall — the other three metrics
# are reference-free and will still score without it.
# ---------------------------------------------------------------------------
EVAL_SET: list[dict] = [
    {
        "question": "How many total credits are required for the MBA+MSDT dual degree program?",
        "ground_truth": "84 credits",
    },
    {
        "question": "What is the phone number for the BU Office of Disability Services (ODS)?",
        "ground_truth": "617-353-3658.",
    },
    {
        "question": "What must accompany academic freedom in teaching and research?",
        "ground_truth": "Academic freedom must be accompanied by a commitment to accuracy and integrity.",
    },
    {
        "question": "How many courses must students complete for the BA in Economics major?",
        "ground_truth": "Students must complete a minimum of nine courses with grades of C or higher.",
    },
    {
        "question": "Which neighborhoods are listed as common student neighborhoods for off-campus housing?",
        "ground_truth": "Brighton, Allston, and Brookline are listed as common student neighborhoods for off-campus housing.",
    },
    {
        "question": "What CGPA must MBA/MBA+MSDT students maintain to be in good academic standing at Questrom, and what happens if they fall below 2.55 after 8 credits?",
        "ground_truth": "Students must maintain a cumulative Questrom GPA of at least 2.70. Students with a CGPA below 2.55 after 8 credits attempted will be flagged for withdrawal from the program. All withdrawal cases go to the PDC for final review.",
    },
    {
        "question": "Compare the course requirements structure for the three Questrom MBA programs: General Management, Health Sector Management, and Social Impact. How do their credit distributions differ?",
        "ground_truth": "All three require 64 credits minimum. General Management requires 34 core MBA credits and 30 elective credits. Health Sector Management requires 34 MBA core credits, 9 HSM core credits, 6 HSM elective credits, 15 general elective credits, and a health sector internship. Social Impact requires 34 MBA core credits, 3 Social Impact core credits, 9 Social Impact elective credits, 18 general elective credits, and a Social Impact internship.",
    },
    {
        "question": "What is the refund schedule for MBA students who drop all courses during the fall or spring semester at Questrom?",
        "ground_truth": "Prior to the first day of classes, students receive 100% tuition and fees. During the first two weeks, they receive 80% tuition. During the third week, 60% tuition. During the fourth week, 40% tuition. During the fifth week, 20% tuition. After the fifth week, 0% tuition.",
    },
    {
        "question": "An MBA+MSDT student at Questrom receives a 'W' in a Module One core course. What are the consequences and required actions?",
        "ground_truth": "The student cannot continue to Module Three unless the W is resolved before the start of the Spring semester, cannot be cohorted the following semester, is charged full tuition for the course, and the W appears on the transcript. W grades do not earn honor points, are not calculated in GPA, and cannot be used to satisfy MBA or MSDT degree requirements, so the course must be retaken with a passing grade. The student must still complete 40 MBA credits and 44 MSDT credits, meet residency requirements, maintain a 2.70 CGPA, and graduate within 6 years.",
    },
]


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

    # Instantiate metrics with the custom LLM — required in RAGAs 0.2+
    # AnswerRelevancy omitted: it requires an embeddings endpoint which vLLM
    # generation models don't expose.
    metrics = [
        Faithfulness(llm=ragas_llm),
        ContextPrecision(llm=ragas_llm),
        ContextRecall(llm=ragas_llm),
    ]

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
    result = evaluate(dataset, metrics=metrics, llm=ragas_llm)

    print("\n--- RAGAs results ---")
    print(result)

    csv_path = output_csv or f"ragas_{method}.csv"
    result.to_pandas().to_csv(csv_path, index=False)
    print(f"\n✓ Per-question scores saved to {csv_path}")

    return result.to_pandas().mean(numeric_only=True).to_dict()


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
