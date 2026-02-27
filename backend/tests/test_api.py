"""Tests for API routes using TestClient."""

import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


class TestHealthEndpoint:
    def test_health(self, client):
        resp = client.get("/api/v1/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "version" in data


class TestCourseSearch:
    @patch("app.routes.search_courses")
    @patch("app.routes.cache_get", return_value=None)
    @patch("app.routes.cache_set")
    def test_search_returns_results(self, mock_set, mock_get, mock_search, client):
        mock_search.return_value = {
            "total": 1,
            "took": 5,
            "hits": [
                {
                    "course_id": 1,
                    "course_name": "CMPSC 130A",
                    "course_number": "130A",
                    "department_code": "CMPSC",
                    "department_name": "CMPSC",
                    "professor_name": "Richert Wang",
                    "avg_gpa": 3.2,
                    "enrollment_trend": "Stable",
                    "grading_trend": "A 30%, B 40%",
                    "course_url": "",
                }
            ],
        }
        resp = client.post("/api/v1/search/courses", json={"query": "CMPSC"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert len(data["results"]) == 1
        assert data["results"][0]["course_name"] == "CMPSC 130A"

    @patch("app.routes.search_courses")
    @patch("app.routes.cache_get", return_value=None)
    @patch("app.routes.cache_set")
    def test_empty_search(self, mock_set, mock_get, mock_search, client):
        mock_search.return_value = {"total": 0, "took": 1, "hits": []}
        resp = client.post("/api/v1/search/courses", json={"query": "nonexistent"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 0


class TestAnalytics:
    def test_analytics_returns_structure(self, client):
        with patch("app.routes.cache_get") as mock_cache:
            mock_cache.return_value = {
                "department_averages": [
                    {"department_code": "CMPSC", "avg_gpa": 3.4, "course_count": 15}
                ],
                "top_professors": [
                    {"professor_name": "Test Prof", "avg_gpa": 3.5, "course_count": 5}
                ],
                "total_courses": 100,
                "total_reviews": 250,
                "total_departments": 10,
                "total_professors": 50,
            }
            resp = client.get("/api/v1/analytics")
            assert resp.status_code == 200
            data = resp.json()
            assert "department_averages" in data
            assert "top_professors" in data
            assert data["total_courses"] == 100
