# Testing Guide: final.csv Migration

**Purpose:** Verify that the RateMyGaucho extension correctly loads and displays data from `final.csv` with all new fields working properly.

---

## Pre-Testing Checklist

✅ All items completed:
- [x] Manifest JSON is valid
- [x] content.js syntax is valid  
- [x] final.csv is present (2,976 records)
- [x] final.csv declared in web_accessible_resources
- [x] Distribution ZIP created with all files
- [x] No changes pushed to git (as requested)

---

## Step 1: Load Extension in Chrome

### Instructions:

1. **Open Chrome** and navigate to: `chrome://extensions/`

2. **Enable Developer Mode:**
   - Toggle switch in top-right corner

3. **Load Unpacked Extension:**
   - Click "Load unpacked" button
   - Navigate to: `/Users/logan/RateMyGaucho`
   - Click "Select" (or "Open")

4. **Verify Extension Loaded:**
   - Look for "RateMyGaucho" card in extension list
   - Check that no errors appear
   - Status should show "Enabled"

**Expected Result:** ✅ Extension loads without errors

**Troubleshooting:**
- If manifest error appears → Check manifest.json syntax
- If content script error → Check content.js syntax
- If permissions error → Review host_permissions in manifest

---

## Step 2: Open DevTools and Navigate to GOLD

### Instructions:

1. **Open Chrome DevTools:**
   - Press `F12` or `Cmd+Option+I` (Mac) or `Ctrl+Shift+I` (Windows)
   - Go to "Console" tab

2. **Navigate to UCSB GOLD:**
   - Go to: https://my.sa.ucsb.edu/gold/
   - Log in if prompted

3. **Search for Courses:**
   - Use GOLD's search functionality
   - Search for any course (e.g., "ANTH", "CHEM", "CS")
   - View course results page

**Expected Result:** ✅ Course search results appear

---

## Step 3: Verify Console Logs

### What to Look For:

Check the Console tab for these log messages (in order):

```
[RateMyGaucho] content v1.0.4 at https://my.sa.ucsb.edu/...
[RateMyGaucho] Attempting to load primary course data: final.csv
[RateMyGaucho] ✅ Successfully loaded final.csv
[RateMyGaucho] Parsing course data from: final.csv
[RateMyGaucho] Parsed 2976 course records
[RateMyGaucho] Sample course records (first 3):
  [1] ANTH 3: { courseUrl: ✓, csvProfessor: "Stuart Smith", ... }
  [2] ANTH 5: { courseUrl: ✓, csvProfessor: "Unknown Professor", ... }
  [3] ANTH 99: { courseUrl: ✓, csvProfessor: "Unknown Professor", ... }
[RateMyGaucho] Built course lookup with XXX course keys
[RateMyGaucho] ✅ Course data loaded and indexed successfully
```

### Validation Checklist:

- [ ] `✅ Successfully loaded final.csv` appears (not fallback file)
- [ ] Shows "Parsed 2976 course records" (new count, not 2422)
- [ ] Sample records show `csvProfessor` field
- [ ] Sample records show `expectedReviews` and `foundReviews`
- [ ] Sample records show `verification` field
- [ ] No error messages in red
- [ ] No "Failed to load" messages

**Expected Result:** ✅ All logs indicate successful loading of final.csv with new fields

**If Fallback Occurs:**
```
[RateMyGaucho] Failed to load final.csv: ...
[RateMyGaucho] Falling back to legacy course data: ucsb_courses_final_corrected.csv
```
This indicates final.csv couldn't be loaded. Check:
- File is in project root
- Declared in manifest.json web_accessible_resources
- Extension was reloaded after changes

---

## Step 4: Verify UI Display

### What to Look For:

On the GOLD course results page, you should see:

1. **Professor Rating Cards** appear below instructor names
   - Gaucho star ratings (visual stars, not generic stars)
   - Rating number badge (e.g., "4.5" in colored badge)
   - Number of reviews
   - "UCSB Plat" link

2. **Course Information Section** (when available):
   - Course name (e.g., "ANTH 3")
   - Grade Trend (e.g., "Grade Trend: A, A")
   - Enrollment numbers
   - **NEW:** Professor (PLAT): [name]
   - **NEW:** Verification: [MATCH/MISMATCH/FLAG] • Reviews: [found]/[expected]
   - Recent Reviews (up to 2, truncated)
   - "Course Info" link

### Visual Inspection Checklist:

- [ ] Star ratings render correctly (Gaucho images, not broken links)
- [ ] Cards have UCSB color scheme (navy blue accent)
- [ ] New "Professor (PLAT)" line appears when data available
- [ ] New "Verification" line appears with review counts
- [ ] All links are clickable and properly formatted
- [ ] No layout issues or overlapping elements
- [ ] Cards animate smoothly on page load

**Expected Result:** ✅ All UI elements display correctly with new fields visible

---

## Step 5: Test Specific Courses

### Test Cases:

Search for these specific courses to verify different data scenarios:

#### Test Case 1: Course with MATCH verification
**Search:** "ANTH 113"  
**Expected:**
- Professor: Emiko Saldivar (if shown on GOLD)
- Course card should show:
  - Professor (PLAT): Emiko Saldivar
  - Verification: MATCH • Reviews: 9/9
  - 3 recent reviews

#### Test Case 2: Course with MISMATCH verification  
**Search:** "ANTH 3"  
**Expected:**
- Professor: Stuart Smith
- Course card should show:
  - Professor (PLAT): Stuart Smith
  - Verification: MISMATCH • Reviews: 122/6
  - Multiple reviews

#### Test Case 3: Course with FLAG verification
**Search:** "ANTH 5"  
**Expected:**
- Professor: Unknown Professor
- Course card should show:
  - Professor (PLAT): Unknown Professor
  - Verification: ⚠ FLAG • Reviews: 0/5
  - No recent reviews (empty)

#### Test Case 4: Course with many enrollment data points
**Search:** "ANTH 3"  
**Expected:**
- Enrollment trend shows many numbers separated by →
- All numbers parsed correctly (not "0|0|9" as raw text)

### Validation:

- [ ] All test cases display correctly
- [ ] No parsing errors (no raw pipe characters like "A|A")
- [ ] Review counts match expected values
- [ ] Verification status shows correctly

**Expected Result:** ✅ All test cases pass with correct data display

---

## Step 6: Test Review Filtering (Advanced)

### Instructions:

1. **Open Console** (if not already open)

2. **Run Test Command:**
   ```javascript
   window.testReviewFiltering()
   ```

3. **Review Output:**
   - Should test several instructors (Matt Porter, Raul Rodriguez, Kelvin Lam)
   - For each, shows selected course data and review filtering results
   - Indicates whether reviews were filtered for that instructor

### Expected Output Example:

```
[RateMyGaucho] Testing review filtering...
[RateMyGaucho] Found 1 records for MATH 2A

=== Testing Matt Porter ===
Selected course data: MATH 2A
Reviews filtered: true
Review count: 3
Sample reviews:
  1: "Porter is an amazing professor..."
  2: "Matt really knows his stuff..."
Would be gated (skipped): false

=== Testing Raul Rodriguez ===
...
```

### Validation:

- [ ] Test function runs without errors
- [ ] Shows instructor-specific reviews when available
- [ ] "Would be gated" correctly indicates when data would be hidden
- [ ] Review filtering logic works as expected

**Expected Result:** ✅ Review filtering test completes successfully

---

## Step 7: Performance Check

### Monitor:

1. **Initial Load Time:**
   - Check Network tab in DevTools
   - Look for final.csv request
   - Should complete in <500ms

2. **Memory Usage:**
   - Open Chrome Task Manager (`Shift+Esc`)
   - Find "Extension: RateMyGaucho"
   - Memory should be <20MB

3. **Page Responsiveness:**
   - GOLD page should remain responsive
   - No lag when scrolling
   - Cards should animate smoothly

### Benchmarks:

| Metric | Target | Notes |
|--------|--------|-------|
| CSV Load Time | <500ms | Network dependent |
| Parse Time | <100ms | Should be instant |
| Memory Usage | <20MB | Includes all data |
| UI Render | <50ms per card | Should be smooth |

**Expected Result:** ✅ Performance is acceptable

---

## Step 8: Error Handling

### Test Error Scenarios:

1. **Test with No Internet:** (optional)
   - Disable network in DevTools
   - Reload page
   - Extension should still work (local data)

2. **Test with Missing Course:**
   - Search for obscure course not in CSV
   - Should not show course info card
   - Should not throw errors

3. **Test with Invalid Professor Name:**
   - Look for courses with special characters
   - Name matching should handle gracefully

### Validation:

- [ ] No JavaScript errors in any scenario
- [ ] Graceful degradation when data missing
- [ ] Console logs remain informative, not spammy

**Expected Result:** ✅ No errors in any test scenario

---

## Step 9: Backward Compatibility Test (Optional)

### Simulate Fallback:

1. **Temporarily rename final.csv:**
   ```bash
   cd /Users/logan/RateMyGaucho
   mv final.csv final.csv.backup
   ```

2. **Reload extension** in Chrome (`chrome://extensions/` → click reload icon)

3. **Navigate to GOLD** and search for courses

4. **Check Console:**
   ```
   [RateMyGaucho] Failed to load final.csv: ...
   [RateMyGaucho] Falling back to legacy course data: ucsb_courses_final_corrected.csv
   [RateMyGaucho] Parsed 2422 course records
   ```

5. **Verify:**
   - Extension still works with old CSV
   - UI still displays (without new fields)
   - No errors occur

6. **Restore final.csv:**
   ```bash
   mv final.csv.backup final.csv
   ```

7. **Reload extension** again

**Expected Result:** ✅ Fallback works correctly, then returns to normal

---

## Step 10: Final Verification

### Complete Checklist:

- [ ] Extension loads without errors
- [ ] final.csv loads successfully (2,976 records)
- [ ] Console shows detailed parsing logs
- [ ] All new fields appear in UI
- [ ] Professor (PLAT) displays correctly
- [ ] Verification status shows correctly
- [ ] Review counts display accurately
- [ ] Test cases all pass
- [ ] Review filtering works
- [ ] Performance is acceptable
- [ ] No errors in any scenario
- [ ] Fallback mechanism works (if tested)

**Overall Status:** ✅ All tests passed - Migration successful!

---

## Troubleshooting Guide

### Issue: final.csv not loading

**Symptoms:**
- Console shows fallback message
- Old record count (2,422) instead of new (2,976)

**Solutions:**
1. Check file exists: `ls -lh /Users/logan/RateMyGaucho/final.csv`
2. Check manifest declares it: `grep final.csv manifest.json`
3. Reload extension: `chrome://extensions/` → reload button
4. Clear Chrome cache: DevTools → Network → "Disable cache"

---

### Issue: New fields not displaying

**Symptoms:**
- Cards show but no "Professor (PLAT)" or "Verification" lines

**Solutions:**
1. Check course has data: Look at console sample records
2. Check gating logic: Only shows for instructor-specific reviews
3. Try different course: Some courses may not have new data
4. Check console for errors: Look for parsing warnings

---

### Issue: Parsing errors

**Symptoms:**
- Raw pipe characters in UI: "A|A" instead of "A, A"
- Console warnings about parsing failures

**Solutions:**
1. Check parseFlexibleArray function implementation
2. Verify CSV format is correct: `head -5 final.csv`
3. Test parser standalone: `open test_parsing.html`
4. Check for CSV corruption: Line endings, encoding issues

---

### Issue: Performance problems

**Symptoms:**
- Page loads slowly
- High memory usage
- UI lag

**Solutions:**
1. Check file size: `ls -lh final.csv` (should be ~1.6MB)
2. Monitor network tab: CSV should only load once
3. Check for memory leaks: Monitor Task Manager over time
4. Consider clearing browser cache and reloading

---

## Success Criteria

✅ **Migration is successful if:**

1. Extension loads final.csv (confirmed in console)
2. All 2,976 records are parsed
3. New fields display correctly in UI
4. All existing functionality works (ratings, stars, links)
5. No JavaScript errors occur
6. Performance remains acceptable
7. Fallback mechanism works if tested

---

## Next Steps After Testing

### If All Tests Pass:

1. **Document any issues found** (even minor ones)
2. **Note performance observations** (load times, memory)
3. **Collect screenshots** of new UI elements
4. **Consider committing** (but don't push yet as requested):
   ```bash
   git add manifest.json content/content.js final.csv
   git commit -m "Migrate to final.csv with enhanced data fields"
   ```

### If Issues Found:

1. **Document the issue** in detail
2. **Check MIGRATION_SUMMARY.md** for known issues
3. **Review console logs** for error messages
4. **Test rollback** if needed (see MIGRATION_SUMMARY.md)
5. **Report issues** before proceeding

---

## Support Resources

- **Migration Details:** See `MIGRATION_SUMMARY.md`
- **Parser Tests:** Run `test_parsing.html`
- **Console Debugging:** Use `window.testReviewFiltering()`
- **Git Status:** Run `git status` (nothing pushed)

---

**Ready to test!** Follow steps 1-10 in order and check off each item as completed.
