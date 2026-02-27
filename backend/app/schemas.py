"""Pydantic schemas for request / response validation."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ── Shared ───────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "1.0.0"


# ── Course ───────────────────────────────────────────────────────────────────

class CourseBase(BaseModel):
    course_name: str
    course_number: Optional[str] = None
    department_code: Optional[str] = None
    professor_name: Optional[str] = None
    avg_gpa: Optional[float] = None
    enrollment_trend: Optional[str] = None
    grading_trend: Optional[str] = None
    course_url: Optional[str] = None


class CourseOut(CourseBase):
    course_id: int
    reviews: list[str] = Field(default_factory=list)

    class Config:
        from_attributes = True


class CourseSearchRequest(BaseModel):
    query: str = ""
    department: Optional[str] = None
    professor: Optional[str] = None
    min_gpa: Optional[float] = None
    max_gpa: Optional[float] = None
    size: int = Field(default=25, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class CourseSearchResponse(BaseModel):
    total: int
    took_ms: int
    results: list[CourseOut]
    cached: bool = False


# ── Review ───────────────────────────────────────────────────────────────────

class ReviewOut(BaseModel):
    review_id: int
    course_id: int
    course_name: Optional[str] = None
    department_code: Optional[str] = None
    professor_name: Optional[str] = None
    ordinal: int
    body: str

    class Config:
        from_attributes = True


class ReviewSearchRequest(BaseModel):
    query: str = ""
    course_id: Optional[int] = None
    size: int = Field(default=25, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class ReviewSearchResponse(BaseModel):
    total: int
    took_ms: int
    results: list[ReviewOut]
    cached: bool = False


# ── Analytics ────────────────────────────────────────────────────────────────

class DepartmentAvg(BaseModel):
    department_code: str
    avg_gpa: float
    course_count: int


class ProfessorStat(BaseModel):
    professor_name: str
    avg_gpa: Optional[float]
    course_count: int


class AnalyticsResponse(BaseModel):
    department_averages: list[DepartmentAvg]
    top_professors: list[ProfessorStat]
    total_courses: int
    total_reviews: int
    total_departments: int
    total_professors: int
