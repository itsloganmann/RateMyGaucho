"""Kafka consumer – reads course events, writes to PostgreSQL + Elasticsearch.

Run as a standalone process:
    python -m app.kafka_consumer
"""

import json
import logging
import signal
import sys

from confluent_kafka import Consumer, KafkaError

from app.config import get_settings
from app.database import init_db, db_session
from app.es_service import ensure_indexes, index_course, index_review
from app.models import Department, Professor, Course, Review

logger = logging.getLogger(__name__)

_running = True


def _shutdown(signum, _frame):
    global _running
    logger.info("Received signal %s – shutting down consumer", signum)
    _running = False


def _upsert_department(session, dept_code: str) -> int:
    dept = session.query(Department).filter_by(code=dept_code).first()
    if not dept:
        dept = Department(code=dept_code, name=dept_code)
        session.add(dept)
        session.flush()
    return dept.id


def _upsert_professor(session, full_name: str) -> int:
    normalized = full_name.strip().lower()
    prof = session.query(Professor).filter_by(normalized_name=normalized).first()
    if not prof:
        prof = Professor(full_name=full_name.strip(), normalized_name=normalized)
        session.add(prof)
        session.flush()
    return prof.id


def _handle_course_created(data: dict):
    """Insert or update a course record and index into ES."""
    with db_session() as session:
        dept_code = data.get("department_code", "UNKN")
        dept_id = _upsert_department(session, dept_code)
        prof_name = data.get("professor_name", "Staff")
        prof_id = _upsert_professor(session, prof_name)

        existing = (
            session.query(Course)
            .filter_by(course_name=data["course_name"], professor_id=prof_id)
            .first()
        )
        if existing:
            existing.avg_gpa = data.get("avg_gpa")
            existing.grading_trend = data.get("grading_trend")
            existing.enrollment_trend = data.get("enrollment_trend")
            existing.course_url = data.get("course_url")
            course_id = existing.id
        else:
            c = Course(
                course_name=data["course_name"],
                course_number=data.get("course_number"),
                course_url=data.get("course_url"),
                department_id=dept_id,
                professor_id=prof_id,
                avg_gpa=data.get("avg_gpa"),
                grading_trend=data.get("grading_trend"),
                enrollment_trend=data.get("enrollment_trend"),
            )
            session.add(c)
            session.flush()
            course_id = c.id

        # Upsert reviews
        reviews = data.get("reviews", [])
        for i, body in enumerate(reviews, start=1):
            if not body:
                continue
            existing_review = (
                session.query(Review)
                .filter_by(course_id=course_id, ordinal=i)
                .first()
            )
            if existing_review:
                existing_review.body = body
            else:
                session.add(Review(course_id=course_id, ordinal=i, body=body))

        session.commit()

        # ES indexing
        es_doc = {
            "course_id": course_id,
            "course_name": data["course_name"],
            "course_number": data.get("course_number"),
            "department_code": dept_code,
            "department_name": dept_code,
            "professor_name": prof_name,
            "avg_gpa": data.get("avg_gpa"),
            "enrollment_trend": data.get("enrollment_trend"),
            "grading_trend": data.get("grading_trend"),
            "course_url": data.get("course_url"),
        }
        index_course(es_doc)

        for i, body in enumerate(reviews, start=1):
            if not body:
                continue
            rev_rec = (
                session.query(Review)
                .filter_by(course_id=course_id, ordinal=i)
                .first()
            )
            if rev_rec:
                index_review(
                    {
                        "review_id": rev_rec.id,
                        "course_id": course_id,
                        "course_name": data["course_name"],
                        "department_code": dept_code,
                        "professor_name": prof_name,
                        "ordinal": i,
                        "body": body,
                    }
                )

    logger.info("Processed course.created for %s", data.get("course_name"))


EVENT_HANDLERS = {
    "course.created": _handle_course_created,
    "course.updated": _handle_course_created,  # same upsert logic
}


def run():
    settings = get_settings()
    init_db()
    ensure_indexes()

    consumer = Consumer(
        {
            "bootstrap.servers": settings.kafka_bootstrap_servers,
            "group.id": settings.kafka_consumer_group,
            "auto.offset.reset": "earliest",
            "enable.auto.commit": True,
        }
    )
    consumer.subscribe([settings.kafka_topic_courses])
    logger.info(
        "Kafka consumer started – topic=%s group=%s",
        settings.kafka_topic_courses,
        settings.kafka_consumer_group,
    )

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    try:
        while _running:
            msg = consumer.poll(1.0)
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                logger.error("Kafka error: %s", msg.error())
                continue

            try:
                envelope = json.loads(msg.value())
                event_type = envelope.get("event")
                data = envelope.get("data", {})
                handler = EVENT_HANDLERS.get(event_type)
                if handler:
                    handler(data)
                else:
                    logger.warning("Unknown event type: %s", event_type)
            except Exception:
                logger.exception("Failed to process Kafka message")
    finally:
        consumer.close()
        logger.info("Kafka consumer stopped")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    run()
