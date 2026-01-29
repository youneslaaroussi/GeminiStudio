"""Tests for the docs tool."""

from __future__ import annotations

import pytest

from langgraph_server.tools.docs_tool import search_product_docs


class TestSearchProductDocs:
    """Tests for search_product_docs tool."""

    def test_exact_match(self):
        """Should return content for exact query match."""
        result = search_product_docs.invoke({"query": "langgraph overview"})
        
        assert result["match"] == "langgraph overview"
        assert result["content"] is not None
        assert len(result["content"]) > 0

    def test_fuzzy_match(self):
        """Should fuzzy match similar queries."""
        result = search_product_docs.invoke({"query": "langgraph"})
        
        # Should find a close match
        assert result["match"] is not None or "No matching" in result["content"]

    def test_no_match_returns_helpful_message(self):
        """Should return helpful message when no match found."""
        result = search_product_docs.invoke({"query": "completely unrelated topic xyz123"})
        
        assert result["match"] is None
        assert "No matching" in result["content"]
        assert "LangGraph" in result["content"] or "persistence" in result["content"]

    def test_persistence_query(self):
        """Should find persistence documentation."""
        result = search_product_docs.invoke({"query": "persistence"})
        
        assert result["match"] == "persistence"
        assert "checkpoint" in result["content"].lower()

    def test_cloud_run_query(self):
        """Should find Google Cloud Run documentation."""
        result = search_product_docs.invoke({"query": "google cloud run"})
        
        assert result["match"] == "google cloud run"
        assert "Cloud Run" in result["content"]

    def test_returns_query_in_response(self):
        """Should include original query in response."""
        query = "some test query"
        result = search_product_docs.invoke({"query": query})
        
        assert result["query"] == query

    def test_case_insensitive(self):
        """Should handle case-insensitive queries."""
        result1 = search_product_docs.invoke({"query": "PERSISTENCE"})
        result2 = search_product_docs.invoke({"query": "persistence"})
        
        assert result1["match"] == result2["match"]
