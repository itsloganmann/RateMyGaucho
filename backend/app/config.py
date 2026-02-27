"""RateMyGaucho backend – configuration via environment variables."""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # ── Postgres ──
    database_url: str = "postgresql://rmg:rmg_dev_secret@localhost:5432/ratemygaucho"

    # ── Redis ──
    redis_url: str = "redis://localhost:6379/0"
    redis_cache_ttl: int = 300  # seconds

    # ── Elasticsearch ──
    elasticsearch_url: str = "http://localhost:9200"
    es_index_courses: str = "courses"
    es_index_reviews: str = "reviews"

    # ── Kafka ──
    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_topic_courses: str = "course-events"
    kafka_consumer_group: str = "rmg-indexer"

    # ── Observability ──
    otlp_endpoint: str = "http://localhost:4317"
    service_name: str = "ratemygaucho-api"

    # ── CSV data path ──
    csv_path: str = "/app/data/courses_final_enrollment.csv"

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
