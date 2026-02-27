"""Unit tests for ETL helpers."""

import pytest
from app.etl import _compute_gpa, _extract_dept_code, _extract_course_number


class TestComputeGpa:
    def test_typical_grading_trend(self):
        trend = "A 30%, B 40%, C 20%, D 10%"
        gpa = _compute_gpa(trend)
        assert gpa is not None
        assert 2.5 < gpa < 3.5

    def test_all_a(self):
        trend = "A 100%"
        gpa = _compute_gpa(trend)
        assert gpa == 4.0

    def test_empty_string(self):
        assert _compute_gpa("") is None

    def test_none(self):
        assert _compute_gpa(None) is None

    def test_nan(self):
        import math
        assert _compute_gpa(float("nan")) is None

    def test_mixed_grades(self):
        trend = "A+ 10%, A 20%, A- 15%, B+ 15%, B 20%, C 20%"
        gpa = _compute_gpa(trend)
        assert gpa is not None
        assert 3.0 < gpa < 4.0


class TestExtractDeptCode:
    def test_cmpsc(self):
        assert _extract_dept_code("CMPSC 130A") == "CMPSC"

    def test_math(self):
        assert _extract_dept_code("MATH 4A") == "MATH"

    def test_phys(self):
        assert _extract_dept_code("PHYS 1") == "PHYS"

    def test_empty(self):
        assert _extract_dept_code("") == "UNKN"


class TestExtractCourseNumber:
    def test_with_letter(self):
        assert _extract_course_number("CMPSC 130A") == "130A"

    def test_plain_number(self):
        assert _extract_course_number("MATH 4A") == "4A"

    def test_no_number(self):
        assert _extract_course_number("") == ""
