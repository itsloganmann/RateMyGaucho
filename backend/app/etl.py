"""ETL pipeline – loads courses_final_enrollment.csv into PostgreSQL and Elasticsearch,
and publishes Kafka events for every ingested course.
"""

import logging
import re
from pathlib import Path

import pandas as pd

from app.config import get_settings
from app.database import init_db, db_session
from app.es_service import ensure_indexes, bulk_index
from app.kafka_producer import publish_course_event, flush as kafka_flush
from app.models import Department, Professor, Course, Review

logger = logging.getLogger(__name__)

# ── helpers ──────────────────────────────────────────────────────────────────

GPA_MAP = {"A+": 4.0, "A": 4.0, "A-": 3.7, "B+": 3.3, "B": 3.0, "B-": 2.7,
           "C+": 2.3, "C": 2.0, "C-": 1.7, "D+": 1.3, "D": 1.0, "D-": 0.7, "F": 0.0}
GRADE_RE = re.compile(r"(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|F)\s*[:=]?\s*([\d.]+)%", re.I)


def _compute_gpa(grading_trend: str) -> float | None:
    """Weighted-average GPA from a grading-trend string like 'A 30%, B 40%, …'."""
    if not grading_trend or pd.isna(grading_trend):
        return None
    matches = GRADE_RE.findall(str(grading_trend))
    if not matches:
        return None
    total_weight = 0.0
    weighted_sum = 0.0
    for letter, pct in matches:
        gpa_val = GPA_MAP.get(letter.upper())
        if gpa_val is None:
            continue
        w = float(pct)
        weighted_sum += gpa_val * w
        total_weight += w
    if total_weight == 0:
        return None
    return round(weighted_sum / total_weight, 2)


def _extract_dept_code(course_name: str) -> str:
    """Pull department code from a course name like 'CMPSC 130A'."""
    m = re.match(r"([A-Z]+)", str(course_name).strip())
    return m.group(1) if m else "UNKN"


def _extract_course_number(course_name: str) -> str:
    m = re.match(r"[A-Z]+\s*([\w]+)", str(course_name).strip())
    return m.group(1) if m else ""


# ── main ETL ─────────────────────────────────────────────────────────────────

def run_etl(csv_path: str | None = None):
    """Read CSV, normalise, load into Postgres, index into ES, emit Kafka events."""
    settings = get_settings()
    csv_path = csv_path or settings.csv_path

    if not Path(csv_path).exists():
        logger.error("CSV file not found: %s", csv_path)
        return

    logger.info("Starting ETL from %s", csv_path)
    init_db()
    ensure_indexes()

    df = pd.read_csv(csv_path)
    df.columns = [c.strip().lower() for c in df.columns]

    required = {"course_name", "professor"}
    if not required.issubset(set(df.columns)):
        logger.error("CSV missing required columns. Found: %s", list(df.columns))
        return

    course_es_docs: list[dict] = []
    review_es_docs: list[dict] = []
    stats = {"departments": 0, "professors": 0, "courses": 0, "reviews": 0}

    with db_session() as session:
        dept_cache: dict[str, int] = {}
        prof_cache: dict[str, int] = {}

        for _, row in df.iterrows():
            course_name = str(row.get("course_name", "")).strip()
            if not course_name:
                continue

            dept_code = _extract_dept_code(course_name)
            course_number = _extract_course_number(course_name)
            prof_name = str(row.get("professor", "Staff")).strip()
            course_url = str(row.get("course_url", "")).strip()
            grading_trend = str(row.get("grading_trend", "")).strip()
            enrollment_trend = str(row.get("enrollment_trend", "")).strip()
            avg_gpa = _compute_gpa(grading_trend)

            # ── Department ──
            if dept_code not in dept_cache:
                dept = session.query(Department).filter_by(code=dept_code).first()
                if not dept:
                    dept = Department(code=dept_code, name=dept_code)
                    session.add(dept)
                    session.flush()
                    stats["departments"] += 1
                dept_cache[dept_code] = dept.id

            # ── Professor ──
            norm = prof_name.lower()
            if norm not in prof_cache:
                prof = session.query(Professor).filter_by(normalized_name=norm).first()
                if not prof:
                    prof = Professor(full_name=prof_name, normalized_name=norm)
                    session.add(prof)
                    session.flush()
                    stats["professors"] += 1
                prof_cache[norm] = prof.id

            # ── Course ──
            dept_id = dept_cache[dept_code]
            prof_id = prof_cache[norm]

            course = (
                session.query(Course)
                .filter_by(course_name=course_name, professor_id=prof_id)
                .first()
            )
            if course:
                course.avg_gpa = avg_gpa
                course.grading_trend = grading_trend
                course.enrollment_trend = enrollment_trend
                course.course_url = course_url
                course.course_number = course_number
            else:
                course = Course(
                    course_name=course_name,
                    course_number=course_number,
                    course_url=course_url or None,
                    department_id=dept_id,
                    professor_id=prof_id,
                    avg_gpa=avg_gpa,
                    grading_trend=grading_trend,
                    enrollment_trend=enrollment_trend,
                )
                session.add(course)
                stats["courses"] += 1
            session.flush()

            # ── Reviews ──
            reviews: list[str] = []
            for col in ("review_1", "review_2", "review_3"):
                val = str(row.get(col, "")).strip()
                if val and val.lower() != "nan":
                    reviews.append(val)

            for i, body in enumerate(reviews, start=1):
                existing = session.query(Review).filter_by(course_id=course.id, ordinal=i).first()
                if existing:
                    existing.body = body
                else:
                    session.add(Review(course_id=course.id, ordinal=i, body=body))
                    stats["reviews"] += 1

            session.flush()

            # ── ES docs ──
            course_doc = {
                "course_id": course.id,
                "course_name": course_name,
                "course_number": course_number,
                "department_code": dept_code,
                "department_name": dept_code,
                "professor_name": prof_name,
                "avg_gpa": avg_gpa,
                "enrollment_trend": enrollment_trend,
                "grading_trend": grading_trend,
                "course_url": course_url,
            }
            course_es_docs.append(course_doc)

            for i, body in enumerate(reviews, start=1):
                rev = session.query(Review).filter_by(course_id=course.id, ordinal=i).first()
                if rev:
                    review_es_docs.append({
                        "review_id": rev.id,
                        "course_id": course.id,
                        "course_name": course_name,
                        "department_code": dept_code,
                        "professor_name": prof_name,
                        "ordinal": i,
                        "body": body,
                    })

            # ── Kafka ──
            publish_course_event(
                "course.created",
                {
                    "course_id": course.id,
                    "course_name": course_name,
                    "course_number": course_number,
                    "department_code": dept_code,
                    "professor_name": prof_name,
                    "avg_gpa": avg_gpa,
                    "grading_trend": grading_trend,
                    "enrollment_trend": enrollment_trend,
                    "course_url": course_url,
                    "reviews": reviews,
                },
            )

        session.commit()

    # Bulk-index into Elasticsearch
    settings = get_settings()
    if course_es_docs:
        bulk_index(settings.es_index_courses, course_es_docs, id_field="course_id")
    if review_es_docs:
        bulk_index(settings.es_index_reviews, review_es_docs, id_field="review_id")

    kafka_flush()

    logger.info(
        "ETL complete – %d depts, %d profs, %d courses, %d reviews",
        stats["departments"],
        stats["professors"],
        stats["courses"],
        stats["reviews"],
    )
    return stats


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    run_etl()
