"""Tests for Elasticsearch service functions."""

import pytest
from unittest.mock import patch, MagicMock

from app.es_service import search_courses, search_reviews, ensure_indexes


class TestSearchCourses:
    @patch("app.es_service.get_es")
    def test_search_with_query(self, mock_get_es):
        mock_es = MagicMock()
        mock_es.search.return_value = {
            "hits": {
                "total": {"value": 2},
                "hits": [
                    {"_source": {"course_id": 1, "course_name": "CMPSC 130A"}},
                    {"_source": {"course_id": 2, "course_name": "CMPSC 130B"}},
                ],
            },
            "took": 3,
        }
        mock_get_es.return_value = mock_es

        result = search_courses(query="CMPSC 130")
        assert result["total"] == 2
        assert len(result["hits"]) == 2
        assert result["took_ms"] == 3

    @patch("app.es_service.get_es")
    def test_search_with_department_filter(self, mock_get_es):
        mock_es = MagicMock()
        mock_es.search.return_value = {
            "hits": {"total": {"value": 0}, "hits": []},
            "took": 1,
        }
        mock_get_es.return_value = mock_es

        result = search_courses(query="", department="MATH")
        assert result["total"] == 0
        call_body = mock_es.search.call_args[1]["body"]
        filters = call_body["query"]["bool"]["filter"]
        assert any("term" in f for f in filters)


class TestSearchReviews:
    @patch("app.es_service.get_es")
    def test_search_reviews(self, mock_get_es):
        mock_es = MagicMock()
        mock_es.search.return_value = {
            "hits": {
                "total": {"value": 1},
                "hits": [
                    {"_source": {"review_id": 10, "body": "Great course!"}},
                ],
            },
            "took": 2,
        }
        mock_get_es.return_value = mock_es

        result = search_reviews(query="great")
        assert result["total"] == 1
        assert result["hits"][0]["body"] == "Great course!"


class TestEnsureIndexes:
    @patch("app.es_service.get_es")
    def test_creates_missing_indexes(self, mock_get_es):
        mock_es = MagicMock()
        mock_es.indices.exists.return_value = False
        mock_get_es.return_value = mock_es

        ensure_indexes()
        assert mock_es.indices.create.call_count == 2
