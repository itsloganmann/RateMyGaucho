# Quick Reference Card – courses_final_enrollment.csv rollout

## ⚡ Fast Track Smoke Test (~5 minutes)

### 1. Load Extension
```
Chrome → chrome://extensions/ → Enable Developer Mode → Load unpacked
Select: /Users/logan/RateMyGaucho
```

### 2. Verify the Loader
```
1. Open DevTools (F12)
2. Visit https://my.sa.ucsb.edu/gold/
3. Search for any department (e.g., "ANTH")
4. Confirm console shows: "✅ Unified dataset ready"
5. Confirm log details include courses_final_enrollment.csv and ~945 course records
```

### 3. Spot-check the UI
- Rating card still renders beneath instructor rows
- New data points visible:
  - **Grade distribution** (percentages by letter or Pass/Fail)
  - **Historic enrollment** grouped by Pass 1/2/3 windows
  - Mini bar charts mirror the percentages and fill progression for quick scanning
  - Recent review excerpts (up to two per course)

---

## 🔍 Handy Console Commands

```javascript
// Inspect how many unique courses are indexed
window.__rmg_course_lookup.size  // expect ~900-950 keys

// Run the built-in review gating diagnostics
window.testReviewFiltering()
```

Look for these success logs:
```
[RateMyGaucho] Loading unified dataset: courses_final_enrollment.csv
[RateMyGaucho] ✅ Unified dataset ready: { courses: 945, instructors: … }
```

If you see a legacy fallback message or fewer than 900 course keys, the new CSV did not load—recheck the file.

---

## 🎯 Quick Cases to Validate

| Course        | Instructor (CSV)    | What to Verify                                    |
|---------------|--------------------|----------------------------------------------------|
| AM 1          | Lisa Park           | Grade distribution shows A/B percentages           |
| AM 118        | Alexander Cho       | Historic enrollment highlights Pass 1 fill-up      |
| ANTH 178      | Amber Vanderwarker  | Enrollment includes Summer 2024 checkpoints        |

Each card should show:
- Gaucho rating + review count
- Grade distribution bullet list (percentages)
- Historic enrollment timeline ordered by pass phases
- Links to UCSB Plat

---

## ❌ Troubleshooting Cheatsheet

### CSV did not load
```bash
ls -lh /Users/logan/RateMyGaucho/courses_final_enrollment.csv  # Confirm file exists
```
- Reload the extension from chrome://extensions/
- Re-open GOLD and watch the console for fetch/parse errors

### Grade distribution missing
- Ensure the card shows `Grade distribution` text; if not, the course may lack data
- Try a course with rich data (e.g., "AM 1" or "ANTH 113")

### Enrollment timeline empty
- Historic enrollments only render when the CSV provides timeline entries
- Verify the raw CSV row has `enrollment_trend` data for that course

---

## 📊 What This Release Includes

### Data
- Single authoritative dataset: `courses_final_enrollment.csv`
- Grade distribution stored as `%` per letter (or Pass/Fail)
- Historic enrollment logs aligned to UCSB pass-time windows

### Code
- `manifest.json`: now exposes `courses_final_enrollment.csv`
- `content/content.js`: new parsing pipeline (grade distributions + pass-time ordering)
- Persona rail and cards updated to show percentages + historic enrollment phrasing

### Safety
- Dataset cached once per session, reused across cards
- If parsing fails, cards stay hidden instead of rendering stale info

---

## ✅ Success Checklist

- [ ] Console reports `courses_final_enrollment.csv`
- [ ] Courses ≈ 945 and instructors count reasonable
- [ ] Grade distribution percentages visible on sampled cards
- [ ] Historic enrollment strings ordered by pass time
- [ ] No red errors in DevTools console

Tick them all → ✅ Rollout complete.

---

## 🆘 Need a Lifeline?

1. Review DevTools console output for stack traces
2. Re-run `window.testReviewFiltering()` for quick diagnostics
3. See `MIGRATION_SUMMARY.md` for deeper context and rollback notes
4. Use `test_parsing.html` to validate parsing helpers in isolation

---

Keep this card handy during verification passes, and update counts if the dataset is refreshed again.
