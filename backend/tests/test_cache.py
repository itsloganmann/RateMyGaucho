"""Tests for the cache module."""

import pytest
from unittest.mock import patch, MagicMock

from app.cache import cache_get, cache_set, cache_invalidate


class TestCacheGet:
    @patch("app.cache.get_redis")
    def test_returns_parsed_json(self, mock_redis):
        mock_conn = MagicMock()
        mock_conn.get.return_value = '{"key": "value"}'
        mock_redis.return_value = mock_conn

        result = cache_get("test:key")
        assert result == {"key": "value"}
        mock_conn.get.assert_called_once_with("test:key")

    @patch("app.cache.get_redis")
    def test_returns_none_on_miss(self, mock_redis):
        mock_conn = MagicMock()
        mock_conn.get.return_value = None
        mock_redis.return_value = mock_conn

        result = cache_get("test:miss")
        assert result is None

    @patch("app.cache.get_redis")
    def test_returns_none_on_error(self, mock_redis):
        mock_redis.side_effect = Exception("Connection refused")
        result = cache_get("test:error")
        assert result is None


class TestCacheSet:
    @patch("app.cache.get_redis")
    def test_stores_value(self, mock_redis):
        mock_conn = MagicMock()
        mock_redis.return_value = mock_conn

        cache_set("test:key", {"a": 1}, ttl=60)
        mock_conn.set.assert_called_once()


class TestCacheInvalidate:
    @patch("app.cache.get_redis")
    def test_deletes_matching_keys(self, mock_redis):
        mock_conn = MagicMock()
        mock_conn.keys.return_value = ["rmg:a", "rmg:b"]
        mock_redis.return_value = mock_conn

        cache_invalidate("rmg:*")
        mock_conn.delete.assert_called_once_with("rmg:a", "rmg:b")
