from __future__ import annotations

from difflib import get_close_matches

from langchain_core.tools import tool

_DOC_SNIPPETS = {
    "langgraph overview": (
        "LangGraph orchestrates stateful agent workflows with durable execution and tool integration."
    ),
    "persistence": (
        "Use checkpointers to persist graph state after each node. For Google Cloud, store checkpoints in Cloud Storage."
    ),
    "google cloud run": (
        "Google Cloud Run deploys containerized services with automatic scaling. Configure env vars and secrets per service."
    ),
}


@tool
def search_product_docs(query: str) -> dict:
    """Return a documentation snippet matching the query.

    Performs a fuzzy match against the curated snippet set to keep the tool deterministic.
    """

    key = query.strip().lower()
    if key in _DOC_SNIPPETS:
        match = key
    else:
        suggestions = get_close_matches(key, _DOC_SNIPPETS.keys(), n=1, cutoff=0.5)
        match = suggestions[0] if suggestions else None

    if not match:
        return {
            "query": query,
            "match": None,
            "content": (
                "No matching documentation snippet was found. "
                "Try asking about LangGraph overview, persistence, or Google Cloud Run."
            ),
        }

    return {"query": query, "match": match, "content": _DOC_SNIPPETS[match]}
