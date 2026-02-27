"""Kafka producer – publishes course events for downstream consumers."""

import json
import logging
from typing import Optional

from confluent_kafka import Producer

from app.config import get_settings

logger = logging.getLogger(__name__)

_producer: Optional[Producer] = None


def get_producer() -> Producer:
    global _producer
    if _producer is None:
        settings = get_settings()
        _producer = Producer(
            {
                "bootstrap.servers": settings.kafka_bootstrap_servers,
                "client.id": "rmg-api-producer",
                "acks": "all",
                "retries": 3,
                "linger.ms": 50,
            }
        )
    return _producer


def _delivery_report(err, msg):
    if err:
        logger.error("Kafka delivery failed: %s", err)
    else:
        logger.debug("Kafka message delivered: %s [%d]", msg.topic(), msg.partition())


def publish_course_event(event_type: str, payload: dict):
    """Publish a course event to Kafka.

    event_type: 'course.created' | 'course.updated' | 'course.deleted'
    payload: JSON-serialisable dict with course data.
    """
    settings = get_settings()
    producer = get_producer()
    message = {"event": event_type, "data": payload}
    producer.produce(
        topic=settings.kafka_topic_courses,
        key=str(payload.get("course_id", "")),
        value=json.dumps(message, default=str),
        callback=_delivery_report,
    )
    producer.poll(0)  # trigger delivery callbacks


def flush(timeout: float = 5.0):
    """Flush outstanding Kafka messages (call on shutdown)."""
    producer = get_producer()
    remaining = producer.flush(timeout)
    if remaining:
        logger.warning("Kafka flush: %d messages still in queue", remaining)
