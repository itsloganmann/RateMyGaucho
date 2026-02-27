"""Elasticsearch index management and search service."""

import logging
from typing import Optional

from elasticsearch import Elasticsearch

from app.config import get_settings

logger = logging.getLogger(__name__)

_client: Optional[Elasticsearch] = None

COURSE_MAPPING = {
    "mappings": {
        "properties": {
            "course_id": {"type": "integer"},
            "course_name": {
                "type": "text",
                "analyzer": "standard",
                "fields": {"keyword": {"type": "keyword"}},
            },
            "course_number": {"type": "keyword"},
            "department_code": {"type": "keyword"},
            "department_name": {
                "type": "text",
                "fields": {"keyword": {"type": "keyword"}},
            },
            "professor_name": {
                "type": "text",
                "fields": {"keyword": {"type": "keyword"}},
            },
            "avg_gpa": {"type": "float"},
            "enrollment_trend": {"type": "text"},
            "grading_trend": {"type": "text"},
            "course_url": {"type": "keyword", "index": False},
        }
    },
    "settings": {
        "number_of_shards": 1,
        "number_of_replicas": 0,
        "analysis": {
            "analyzer": {
                "course_analyzer": {
                    "type": "custom",
                    "tokenizer": "standard",
                    "filter": ["lowercase", "asciifolding"],
                }
            }
        },
    },
}

REVIEW_MAPPING = {
    "mappings": {
        "properties": {
            "review_id": {"type": "integer"},
            "course_id": {"type": "integer"},
            "course_name": {"type": "keyword"},
            "department_code": {"type": "keyword"},
            "professor_name": {"type": "keyword"},
            "ordinal": {"type": "integer"},
            "body": {"type": "text", "analyzer": "standard"},
        }
    },
    "settings": {"number_of_shards": 1, "number_of_replicas": 0},
}


def get_es() -> Elasticsearch:
    global _client
    if _client is None:
        settings = get_settings()
        _client = Elasticsearch(settings.elasticsearch_url)
    return _client


def ensure_indexes():
    """Create Elasticsearch indexes if they do not exist."""
    settings = get_settings()
    es = get_es()
    for idx, mapping in [
        (settings.es_index_courses, COURSE_MAPPING),
        (settings.es_index_reviews, REVIEW_MAPPING),
    ]:
        if not es.indices.exists(index=idx):
            es.indices.create(index=idx, body=mapping)
            logger.info("Created ES index: %s", idx)
        else:
            logger.info("ES index already exists: %s", idx)


def index_course(doc: dict):
    """Index a single course document."""
    settings = get_settings()
    es = get_es()
    es.index(index=settings.es_index_courses, id=doc["course_id"], document=doc)


def index_review(doc: dict):
    """Index a single review document."""
    settings = get_settings()
    es = get_es()
    es.index(index=settings.es_index_reviews, id=doc["review_id"], document=doc)


def bulk_index(index_name: str, docs: list[dict], id_field: str = "course_id"):
    """Bulk-index documents using the Elasticsearch bulk API."""
    from elasticsearch.helpers import bulk as es_bulk

    es = get_es()
    actions = [
        {"_index": index_name, "_id": d[id_field], "_source": d} for d in docs
    ]
    success, errors = es_bulk(es, actions, raise_on_error=False)
    logger.info("Bulk indexed %d docs into %s (%d errors)", success, index_name, len(errors))
    return success, errors


def search_courses(
    query: str,
    department: Optional[str] = None,
    min_gpa: Optional[float] = None,
    max_gpa: Optional[float] = None,
    professor: Optional[str] = None,
    size: int = 25,
    offset: int = 0,
) -> dict:
    """Full-text search for courses with optional filters.

    Returns dict with ``total``, ``hits`` (list of source docs), and ``took_ms``.
    """
    settings = get_settings()
    es = get_es()

    must = []
    filter_clauses = []

    if query:
        must.append(
            {
                "multi_match": {
                    "query": query,
                    "fields": [
                        "course_name^3",
                        "professor_name^2",
                        "department_name",
                        "course_number^2",
                    ],
                    "fuzziness": "AUTO",
                }
            }
        )
    else:
        must.append({"match_all": {}})

    if department:
        filter_clauses.append({"term": {"department_code": department.upper()}})

    if min_gpa is not None or max_gpa is not None:
        range_q: dict = {}
        if min_gpa is not None:
            range_q["gte"] = min_gpa
        if max_gpa is not None:
            range_q["lte"] = max_gpa
        filter_clauses.append({"range": {"avg_gpa": range_q}})

    if professor:
        filter_clauses.append(
            {"match": {"professor_name": {"query": professor, "fuzziness": "AUTO"}}}
        )

    body = {
        "query": {"bool": {"must": must, "filter": filter_clauses}},
        "from": offset,
        "size": size,
        "sort": [{"_score": "desc"}, {"avg_gpa": "desc"}],
    }

    resp = es.search(index=settings.es_index_courses, body=body)

    return {
        "total": resp["hits"]["total"]["value"],
        "took_ms": resp["took"],
        "hits": [h["_source"] for h in resp["hits"]["hits"]],
    }


def search_reviews(
    query: str,
    course_id: Optional[int] = None,
    size: int = 25,
    offset: int = 0,
) -> dict:
    """Full-text search over review text."""
    settings = get_settings()
    es = get_es()

    must = []
    filter_clauses = []

    if query:
        must.append({"match": {"body": {"query": query, "fuzziness": "AUTO"}}})
    else:
        must.append({"match_all": {}})

    if course_id is not None:
        filter_clauses.append({"term": {"course_id": course_id}})

    body = {
        "query": {"bool": {"must": must, "filter": filter_clauses}},
        "from": offset,
        "size": size,
    }

    resp = es.search(index=settings.es_index_reviews, body=body)

    return {
        "total": resp["hits"]["total"]["value"],
        "took_ms": resp["took"],
        "hits": [h["_source"] for h in resp["hits"]["hits"]],
    }
