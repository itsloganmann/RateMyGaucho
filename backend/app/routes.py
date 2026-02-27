"""API routes – search, courses, analytics, health."""

from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.cache import cache_get, cache_set
from app.database import get_db
from app.es_service import search_courses, search_reviews
from app.models import Course, Department, Professor, Review, SearchLog
from app.schemas import (
    AnalyticsResponse,
    CourseOut,
    CourseSearchRequest,
    CourseSearchResponse,
    DepartmentAvg,
    HealthResponse,
    ProfessorStat,
    ReviewOut,
    ReviewSearchRequest,
    ReviewSearchResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Health ───────────────────────────────────────────────────────────────────

@router.get("/health", response_model=HealthResponse, tags=["health"])
def health():
    return HealthResponse()


# ── Course Search (Elasticsearch + Redis cache) ─────────────────────────────

def _search_cache_key(req: CourseSearchRequest) -> str:
    raw = json.dumps(req.model_dump(), sort_keys=True)
    return f"rmg:search:course:{hashlib.md5(raw.encode()).hexdigest()}"


@router.post("/search/courses", response_model=CourseSearchResponse, tags=["search"])
def search_courses_endpoint(req: CourseSearchRequest, db: Session = Depends(get_db)):
    cache_key = _search_cache_key(req)
    cached = cache_get(cache_key)
    if cached:
        return CourseSearchResponse(**cached, cached=True)

    t0 = time.perf_counter()
    es_result = search_courses(
        query=req.query,
        department=req.department,
        min_gpa=req.min_gpa,
        max_gpa=req.max_gpa,
        professor=req.professor,
        size=req.size,
        offset=req.offset,
    )
    latency_ms = int((time.perf_counter() - t0) * 1000)

    results = [CourseOut(course_id=h["course_id"], **{k: v for k, v in h.items() if k != "course_id"}) for h in es_result["hits"]]

    response_data = {
        "total": es_result["total"],
        "took_ms": latency_ms,
        "results": [r.model_dump() for r in results],
    }
    cache_set(cache_key, response_data)

    # Log search
    db.add(SearchLog(
        query_text=req.query,
        result_count=es_result["total"],
        latency_ms=latency_ms,
        source="elasticsearch",
    ))
    db.commit()

    return CourseSearchResponse(**response_data)


# ── Review Search ────────────────────────────────────────────────────────────

def _review_cache_key(req: ReviewSearchRequest) -> str:
    raw = json.dumps(req.model_dump(), sort_keys=True)
    return f"rmg:search:review:{hashlib.md5(raw.encode()).hexdigest()}"


@router.post("/search/reviews", response_model=ReviewSearchResponse, tags=["search"])
def search_reviews_endpoint(req: ReviewSearchRequest, db: Session = Depends(get_db)):
    cache_key = _review_cache_key(req)
    cached = cache_get(cache_key)
    if cached:
        return ReviewSearchResponse(**cached, cached=True)

    t0 = time.perf_counter()
    es_result = search_reviews(
        query=req.query,
        course_id=req.course_id,
        size=req.size,
        offset=req.offset,
    )
    latency_ms = int((time.perf_counter() - t0) * 1000)

    results = [ReviewOut(**h) for h in es_result["hits"]]

    response_data = {
        "total": es_result["total"],
        "took_ms": latency_ms,
        "results": [r.model_dump() for r in results],
    }
    cache_set(cache_key, response_data)

    db.add(SearchLog(
        query_text=req.query,
        result_count=es_result["total"],
        latency_ms=latency_ms,
        source="elasticsearch",
    ))
    db.commit()

    return ReviewSearchResponse(**response_data)


# ── Single Course ────────────────────────────────────────────────────────────

@router.get("/courses/{course_id}", response_model=CourseOut, tags=["courses"])
def get_course(course_id: int, db: Session = Depends(get_db)):
    cache_key = f"rmg:course:{course_id}"
    cached = cache_get(cache_key)
    if cached:
        return CourseOut(**cached)

    course = db.query(Course).filter_by(id=course_id).first()
    if not course:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Course not found")

    dept = db.query(Department).filter_by(id=course.department_id).first()
    prof = db.query(Professor).filter_by(id=course.professor_id).first()
    reviews = db.query(Review).filter_by(course_id=course.id).order_by(Review.ordinal).all()

    data = CourseOut(
        course_id=course.id,
        course_name=course.course_name,
        course_number=course.course_number,
        department_code=dept.code if dept else None,
        professor_name=prof.full_name if prof else None,
        avg_gpa=course.avg_gpa,
        enrollment_trend=course.enrollment_trend,
        grading_trend=course.grading_trend,
        course_url=course.course_url,
        reviews=[r.body for r in reviews],
    )
    cache_set(cache_key, data.model_dump())
    return data


# ── List Courses ─────────────────────────────────────────────────────────────

@router.get("/courses", response_model=list[CourseOut], tags=["courses"])
def list_courses(
    department: Optional[str] = Query(None),
    professor: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = db.query(Course)
    if department:
        dept = db.query(Department).filter_by(code=department.upper()).first()
        if dept:
            q = q.filter(Course.department_id == dept.id)
        else:
            return []
    if professor:
        prof = db.query(Professor).filter(Professor.normalized_name.contains(professor.lower())).first()
        if prof:
            q = q.filter(Course.professor_id == prof.id)
        else:
            return []

    courses = q.offset(offset).limit(limit).all()
    results = []
    for c in courses:
        dept = db.query(Department).filter_by(id=c.department_id).first()
        prof = db.query(Professor).filter_by(id=c.professor_id).first()
        reviews = db.query(Review).filter_by(course_id=c.id).order_by(Review.ordinal).all()
        results.append(
            CourseOut(
                course_id=c.id,
                course_name=c.course_name,
                course_number=c.course_number,
                department_code=dept.code if dept else None,
                professor_name=prof.full_name if prof else None,
                avg_gpa=c.avg_gpa,
                enrollment_trend=c.enrollment_trend,
                grading_trend=c.grading_trend,
                course_url=c.course_url,
                reviews=[r.body for r in reviews],
            )
        )
    return results


# ── Analytics ────────────────────────────────────────────────────────────────

@router.get("/analytics", response_model=AnalyticsResponse, tags=["analytics"])
def analytics(db: Session = Depends(get_db)):
    cache_key = "rmg:analytics"
    cached = cache_get(cache_key)
    if cached:
        return AnalyticsResponse(**cached)

    # Department averages
    dept_rows = (
        db.query(
            Department.code,
            func.avg(Course.avg_gpa).label("avg_gpa"),
            func.count(Course.id).label("cnt"),
        )
        .join(Course, Course.department_id == Department.id)
        .filter(Course.avg_gpa.isnot(None))
        .group_by(Department.code)
        .order_by(func.avg(Course.avg_gpa).desc())
        .all()
    )
    department_averages = [
        DepartmentAvg(department_code=r[0], avg_gpa=round(float(r[1]), 2), course_count=r[2])
        for r in dept_rows
    ]

    # Top professors
    prof_rows = (
        db.query(
            Professor.full_name,
            func.avg(Course.avg_gpa).label("avg_gpa"),
            func.count(Course.id).label("cnt"),
        )
        .join(Course, Course.professor_id == Professor.id)
        .group_by(Professor.full_name)
        .order_by(func.count(Course.id).desc())
        .limit(50)
        .all()
    )
    top_professors = [
        ProfessorStat(
            professor_name=r[0],
            avg_gpa=round(float(r[1]), 2) if r[1] else None,
            course_count=r[2],
        )
        for r in prof_rows
    ]

    total_courses = db.query(func.count(Course.id)).scalar() or 0
    total_reviews = db.query(func.count(Review.id)).scalar() or 0
    total_depts = db.query(func.count(Department.id)).scalar() or 0
    total_profs = db.query(func.count(Professor.id)).scalar() or 0

    data = AnalyticsResponse(
        department_averages=department_averages,
        top_professors=top_professors,
        total_courses=total_courses,
        total_reviews=total_reviews,
        total_departments=total_depts,
        total_professors=total_profs,
    )
    cache_set(cache_key, data.model_dump(), ttl=600)
    return data
