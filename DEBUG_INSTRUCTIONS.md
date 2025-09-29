# Course Code Extraction Debugging Instructions

## Overview
The extension has been enhanced with multiple strategies to extract course codes from UCSB GOLD pages. Follow these steps to test and debug.

## Testing Steps

### 1. Reload Extension
1. Go to `chrome://extensions/`
2. Find "RateMyGaucho"
3. Click reload button (🔄)

### 2. Test Course Data Loading
In the GOLD console, run:
```javascript
testRMGCourseData()
```
Expected output:
```
[RateMyGaucho] Course lookup loaded with 1834 entries
[RateMyGaucho] Test lookup for ITAL 1 : FOUND
  - Course: ITAL 1
  - Grading: Letter Grade
  - Grade trend: ["A", "A"]
  - Enrollment trend: [12, 20, 11, 8]
  - Reviews: 1 reviews
```

### 3. Inspect DOM Structure
Run:
```javascript
inspectInstructorDOM()
```
This shows where course codes are located relative to instructor cells.

### 4. Test Course Info Button Extraction
Run:
```javascript
testCourseInfoButtons()
```
This shows if course codes can be extracted from "Course Info" button attributes.

### 5. Monitor Enhanced Extraction Logs
Look for these new log patterns:
- `[RateMyGaucho] Extracted course code: MATH 6B from same row, text: ...`
- `[RateMyGaucho] Extracted course code: MATH 6B from prev row 2, text: ...`
- `[RateMyGaucho] Extracted course code: MATH 6B from ancestor walk level 1 sibling 3, text: ...`
- `[RateMyGaucho] Extracted course code: MATH 6B from table search, text: ...`
- `[RateMyGaucho] Extracted course code: MATH 6B from Course Info href: ...`
- `[RateMyGaucho] Course data found for: MATH 6B -> MATH 6B`

### 6. Check Summary Statistics
Look for improved summary:
```
[RateMyGaucho] Summary: 93/250 instructors matched, 45/93 with course data
```
Instead of: `0/93 with course data`

## Enhanced Extraction Strategies

### Strategy 1: Same Row (Enhanced)
- Now searches: `td, th, div, span, a, strong, b`
- Normalizes NBSPs: `\u00a0` → space
- Should catch course codes in headers, links, bold text

### Strategy 2: Previous Sibling Rows (Enhanced)
- Searches up to 30 previous rows (was 6)
- Includes anchors and bold elements
- Should catch section headers above instructor rows

### Strategy 3: Ancestor Walk (NEW)
- Climbs up to 5 ancestor levels
- Searches up to 30 previous siblings at each level
- Should catch course codes outside the table structure

### Strategy 4: Table Search (Enhanced)
- Now includes anchors and bold elements
- Should catch course codes in table headers

### Strategy 5: Course Info Button (NEW)
- Extracts from `href` attributes: `subject=MATH&catalogNbr=6B`
- Extracts from `onclick` attributes: `subject: "MATH", catalogNbr: "6B"`
- Fallback when text parsing fails

## Expected Results

### Before Fix
```
[RateMyGaucho] No course code found for instructor: PORTER M J
[RateMyGaucho] No course code found for instructor: RAMIREZ A
[RateMyGaucho] Summary: 93/250 instructors matched, 0/93 with course data
```

### After Fix
```
[RateMyGaucho] Extracted course code: MATH 6B from prev row 1, text: MATH 6B – VECTOR CALCULUS 2
[RateMyGaucho] Course data found for: MATH 6B -> MATH 6B
[RateMyGaucho] Extracted course code: HSSB 1210 from Course Info href: ...subject=HSSB&catalogNbr=1210...
[RateMyGaucho] Course data found for: HSSB 1210 -> HSSB 1210
[RateMyGaucho] Summary: 93/250 instructors matched, 45/93 with course data
```

## Visual Verification

Cards should now show:
- ✅ Rating badge and stars (existing)
- ✅ "X reviews" (existing)
- ✅ **NEW**: Gray course info section with:
  - Course name (e.g., "MATH 6B")
  - Grading basis (e.g., "Letter Grade")
  - Grade trend (e.g., "A, A")
  - Enrollment trend (e.g., "350 → 350 → 241")
  - Recent reviews (quoted, truncated)
  - "Course Info" link

## Troubleshooting

### Still No Course Codes Found
1. Run `inspectInstructorDOM()` to see actual DOM structure
2. Check if course codes are in unexpected locations
3. Look for different text patterns or encoding

### Course Codes Found But No Data
1. Run `testRMGCourseData()` to verify lookup works
2. Check normalization - both extracted and CSV keys use `normalizeCourseCode()`
3. Verify CSV course names match extracted codes exactly

### Performance Issues
1. The enhanced search is more thorough but may be slower
2. Monitor console for excessive logging
3. Consider reducing search depths if needed

## Debug Commands Summary

```javascript
// Test course data loading
testRMGCourseData()

// Inspect DOM structure around instructors
inspectInstructorDOM()

// Test Course Info button extraction
testCourseInfoButtons()

// Manual course lookup test
const courseLookup = await ensureCoursesLoaded();
courseLookup.get('MATH 6B')  // Should return course object
```
