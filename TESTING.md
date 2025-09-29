# RateMyGaucho Extension Testing Guide

## Review Filtering Fix Validation

### Prerequisites
1. Extension must be reloaded after implementing the gating fix
2. UCSB GOLD course results page must be open
3. DevTools console must be accessible

### Test 1: Debug Function Verification
```javascript
// Run in console to test filtering logic
testReviewFiltering()
```

**Expected Output:**
- Shows different review content for Porter vs Lam for MATH 2A
- Displays `_reviewsFiltered: true` when instructor-specific reviews found
- Shows `Would be gated (skipped): false` for instructors with specific reviews
- Shows `Would be gated (skipped): true` for instructors without specific reviews

### Test 2: Visual Card Verification
**Steps:**
1. Find MATH 2A course with multiple instructors (Porter, Rodriguez, etc.)
2. Compare the "Recent Reviews" sections between different instructors
3. Verify that some instructors may have no course data section at all

**Expected Results:**
- ✅ Porter's card shows reviews mentioning "Porter"
- ✅ Rodriguez's card shows reviews mentioning "Lam" or no course section
- ✅ Different instructors show different review content
- ✅ Some instructors show only rating stars (no course data)

### Test 3: Console Log Validation
**Look for these log patterns:**
```
[RateMyGaucho] Course data chosen for instructor: Matt Porter -> MATH 2A filteredReviews: 2 (filtered)
[RateMyGaucho] SKIPPED course data for Raul Rodriguez - no instructor-specific reviews found
```

**Expected Behaviors:**
- ✅ `(filtered)` appears when reviews mention the instructor
- ✅ `SKIPPED course data` appears when no instructor-specific reviews found
- ✅ No invalid course codes like "ANG 2", "KELVIN 3", "LINUS 2"

### Test 4: Edge Cases
**Test with instructors not in dataset:**
- Some instructors should show only rating cards (no course data)
- Console should show "SKIPPED" messages for these instructors
- No errors or crashes should occur

### Success Criteria
1. **No Duplicate Reviews**: Different instructors show different review content
2. **Proper Skipping**: Instructors without specific reviews show no course data
3. **Clean Extraction**: Only valid course codes are extracted
4. **Graceful Handling**: Extension works even when instructors aren't in dataset

### Troubleshooting
- If still seeing duplicate reviews: Check that gating logic is applied correctly
- If too many instructors skipped: Verify word boundary regex in `filterReviewsByInstructor`
- If invalid course codes appear: Check `findValidCourseCodeInText` validation
