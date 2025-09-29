# Testing Instructions: Reviews Fix for Multiple Instructors

## Problem Fixed
When multiple instructors teach the same course (e.g., MATH 2A), all instructors were showing identical reviews from the first CSV record. Now each instructor shows reviews most relevant to them.

## Changes Made
1. **Course lookup now stores arrays**: Instead of overwriting duplicate course entries, we keep all records per course
2. **Added instructor-specific selection**: `pickCourseDataForInstructor()` chooses the best record based on instructor name mentions in reviews
3. **Enhanced logging**: Shows which record was chosen for each instructor

## Testing Steps

### 1. Reload Extension
1. Go to `chrome://extensions/`
2. Find "RateMyGaucho"  
3. Click reload button (🔄)

### 2. Test Course Lookup Arrays
In the GOLD console, run:
```javascript
testCourseDuplicates()
```

**Expected Output (FIXED):**
```
[RateMyGaucho] Testing course duplicates...
Lookup entry for MATH 2A : ARRAY with 3 records
  Record 0: 2 reviews
  Record 1: 1 reviews  
  Record 2: 0 reviews
Lookup entry for MATH 34A : ARRAY with 2 records
  Record 0: 1 reviews
  Record 1: 1 reviews
```

**Old Output (BROKEN):**
```
Lookup entry for MATH 2A : SINGLE OBJECT
  Reviews: 2
```

### 3. Monitor Enhanced Logs
Look for these new log patterns when instructors are matched:
```
[RateMyGaucho] Course data chosen for instructor: Matt Porter -> MATH 2A reviews: 2
[RateMyGaucho] Course data chosen for instructor: Raul Rodriguez -> MATH 2A reviews: 1
```

### 4. Visual Verification
For courses with multiple instructors (like MATH 2A, MATH 34A):

**Before Fix:**
- All instructors showed identical reviews
- Reviews mentioned the same professor name

**After Fix:**
- Each instructor shows reviews that mention their name when available
- If no name matches found, falls back to first record for that course
- Different instructors may show different review text

## Example Test Case

From your screenshots, MATH 2A has multiple instructors:
- PORTER M J (Matt Porter)
- RODRIGUEZ ANG (Raul Rodriguez)

**Before:** Both showed reviews mentioning "Professor Lam"
**After:** Each shows reviews mentioning their own name, or generic course reviews if no name match

## Verification Commands

```javascript
// Test course lookup structure
testCourseDuplicates()

// Test course data loading
testRMGCourseData()

// Manual lookup test
(async () => {
  const lu = await ensureCoursesLoaded();
  const records = lu.get('MATH 2A');
  console.log('MATH 2A records:', records.length);
  records.forEach((r, i) => {
    console.log(`Record ${i}:`, r.recentReviews.map(rev => rev.slice(0, 50) + '...'));
  });
})();
```

## Expected Results

### Console Logs
```
[RateMyGaucho] Built course lookup with 1834 course keys
[RateMyGaucho] Extracted course code: MATH 2A from prev row 0, text: MATH 2A - CALC W/ ALG & TRIG
[RateMyGaucho] Course data chosen for instructor: Matt Porter -> MATH 2A reviews: 2
[RateMyGaucho] Course data chosen for instructor: Raul Rodriguez -> MATH 2A reviews: 1
[RateMyGaucho] Summary: 93/250 instructors matched, 45/93 with course data
```

### Visual Cards
- Each instructor's card shows reviews that mention their name when possible
- Reviews are no longer identical across multiple instructors for the same course
- All other functionality (ratings, stars, grades, enrollment) unchanged

## Troubleshooting

### Still Showing Identical Reviews
1. Verify arrays: Run `testCourseDuplicates()` - should show "ARRAY with X records"
2. Check CSV data: Ensure the course actually has different review records
3. Check name matching: Instructor names should appear in review text for selection to work

### No Course Data
1. Ensure course codes are being extracted (should see "Extracted course code" logs)
2. Verify course lookup works: `testRMGCourseData()`
3. Check instructor matching is working (should see "MATCHED" logs)

### Performance Issues
- The fix adds minimal overhead (array lookup + scoring)
- If needed, we can optimize the scoring function

## Success Criteria
✅ Multiple instructors for same course show different reviews when available
✅ All existing functionality preserved (ratings, grades, enrollment, etc.)  
✅ Console shows "Course data chosen for instructor" with review counts
✅ Course lookup shows arrays instead of single objects
✅ No JavaScript errors in console
