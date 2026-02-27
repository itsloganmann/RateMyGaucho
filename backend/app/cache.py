"""Redis client singleton and cache helpers."""

import json
import logging
from typing import Optional

import redis

from app.config import get_settings

logger = logging.getLogger(__name__)

_pool: Optional[redis.ConnectionPool] = None


def get_redis() -> redis.Redis:
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = redis.ConnectionPool.from_url(settings.redis_url, decode_responses=True)
    return redis.Redis(connection_pool=_pool)


def cache_get(key: str) -> Optional[dict]:
    """Return cached JSON value or None."""
    try:
        r = get_redis()
        raw = r.get(key)
        if raw:
            return json.loads(raw)
    except Exception as exc:
        logger.debug("Cache miss (error): %s – %s", key, exc)
    return None


def cache_set(key: str, value, ttl: int = None):
    """Store a JSON-serialisable value in Redis."""
    try:
        settings = get_settings()
        r = get_redis()
        r.set(key, json.dumps(value, default=str), ex=ttl or settings.redis_cache_ttl)
    except Exception as exc:
        logger.debug("Cache write failed: %s – %s", key, exc)


def cache_invalidate(pattern: str = "rmg:*"):
    """Delete keys matching a glob pattern."""
    try:
        r = get_redis()
        keys = r.keys(pattern)
        if keys:
            r.delete(*keys)
            logger.info("Invalidated %d cache keys matching %s", len(keys), pattern)
    except Exception as exc:
        logger.debug("Cache invalidation failed: %s", exc)
