# Waymark RAG

Waymark RAG is a vLLM-powered, role-aware retrieval-augmented generation system that helps users search across scattered enterprise knowledge sources and receive grounded answers with citations, confidence signals, and evaluation metrics.

For this hackathon prototype, we demonstrate Waymark RAG using a curated Boston University document corpus across PDFs, Word documents, spreadsheets, and other structured files.

---

## Problem

Enterprise knowledge is fragmented across platforms such as Google Drive, Slack, email, SharePoint, PDFs, spreadsheets, and internal documentation.

Employees waste time switching between tools to find the right answer. Even when AI tools are used, answers are hard to trust without citations, source grounding, or measurable evaluation.

Waymark RAG addresses this by creating a connected knowledge layer for enterprise search and question answering.

---

## Solution

Ask one question. Get a grounded answer from a mixed-format knowledge base.

- Retrieve relevant information from scattered documents
- Generate answers using vLLM
- Provide citations and source links for verification
- Support role-aware responses for different user personas
- Evaluate answer quality using RAGAs metrics
- Compare retrieval methods: cosine similarity, hybrid search, and reranking

---

## Key Features

**Mixed-format document retrieval**
Supports PDFs, Word documents, spreadsheets, and structured files.

**Grounded answer generation**
Uses retrieved document context to generate answers instead of relying on model memory alone.

**Citations and source verification**
Each answer includes source references so users can verify where information came from.

**Role-aware prompts**
Different user personas (engineering, marketing, operations) receive answers tailored to their workflow.

**Benchmark question set**
Includes verifiable questions with expected answers and source files for evaluation.

**RAGAs-based evaluation**
Evaluates answer quality using faithfulness, answer relevancy, context precision, and context recall.

**Retrieval method comparison**
Compares cosine similarity, hybrid search, and hybrid search with reranking.

---

## Demo Corpus

For the hackathon prototype, we curated 80+ Boston University-related files to simulate an internal organizational knowledge base.

The corpus includes PDFs, Word documents, Excel files, and public BU-related materials organized into the following categories:

- Academic and program information
- Student resources
- Policies and guidelines
- Events and conferences
- Career resources
- Administrative forms and operational materials

---

## Architecture

```text
Documents (PDFs / Word / Spreadsheets / Structured Files)
        |
        v
Ingestion + Chunking
        |
        v
Vector Store (ChromaDB)
        |
        v
Retriever
Cosine Similarity -> Hybrid Search -> Hybrid + Reranking
        |
        v
vLLM Generator (llama-3.1-8b-instruct)
        |
        v
Answer + Citations
        |
        v
RAGAs Evaluation
        |
        v
Dashboard / Demo UI
