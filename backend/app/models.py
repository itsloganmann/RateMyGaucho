"""SQLAlchemy models – normalised PostgreSQL schema for courses, professors, and reviews."""

from sqlalchemy import (
    Column, Integer, String, Float, Text, DateTime, ForeignKey,
    Index, UniqueConstraint, func,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True)
    code = Column(String(16), unique=True, nullable=False, index=True)
    name = Column(String(128))

    courses = relationship("Course", back_populates="department")


class Professor(Base):
    __tablename__ = "professors"

    id = Column(Integer, primary_key=True)
    full_name = Column(String(256), nullable=False)
    normalized_name = Column(String(256), nullable=False, index=True)

    courses = relationship("Course", back_populates="professor")

    __table_args__ = (
        Index("ix_professors_normalized", "normalized_name"),
    )


class Course(Base):
    __tablename__ = "courses"

    id = Column(Integer, primary_key=True)
    course_name = Column(String(32), nullable=False)
    course_number = Column(String(16))
    course_url = Column(Text)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False)
    professor_id = Column(Integer, ForeignKey("professors.id"))

    # Pre-computed analytics
    avg_gpa = Column(Float)
    grading_trend = Column(Text)          # raw string from CSV
    enrollment_trend = Column(Text)       # raw string from CSV

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    department = relationship("Department", back_populates="courses")
    professor = relationship("Professor", back_populates="courses")
    reviews = relationship("Review", back_populates="course", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_courses_dept_name", "department_id", "course_name"),
        Index("ix_courses_avg_gpa", "avg_gpa"),
    )


class Review(Base):
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True)
    course_id = Column(Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)
    ordinal = Column(Integer, nullable=False)          # 1, 2, 3
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    course = relationship("Course", back_populates="reviews")

    __table_args__ = (
        UniqueConstraint("course_id", "ordinal", name="uq_review_course_ordinal"),
    )


class SearchLog(Base):
    """Tracks every search request for analytics / tracing."""
    __tablename__ = "search_logs"

    id = Column(Integer, primary_key=True)
    query_text = Column(Text, nullable=False)
    result_count = Column(Integer, default=0)
    latency_ms = Column(Float)
    source = Column(String(32))   # 'api' | 'extension'
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_search_logs_created", "created_at"),
    )
