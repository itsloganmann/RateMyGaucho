# Quick Test: Review Display Fix

## ⚡ Fast Verification (2 minutes)

### 1. Reload Extension
```
Chrome → chrome://extensions/ → Find "RateMyGaucho" → Click reload icon (⟳)
```

### 2. Go to GOLD and Search
```
1. Navigate to: https://my.sa.ucsb.edu/gold/
2. Open DevTools: Press F12 (or Cmd+Option+I on Mac)
3. Go to Console tab
4. Search for: "MATH 4B"
```

### 3. Check What You See

**✅ GOOD - Fix is Working:**
- Nathan Schley's rating card appears
- Course info section shows:
  - **Professor (PLAT): Nathan Schley**
  - **Verification: MATCH • Reviews: 119/119**
  - Recent Reviews section with 2 reviews
  - Reviews mention "Nathan" (first name only)

**❌ BAD - Fix Not Applied:**
- No course info section appears
- Console shows: "SKIPPED course data for Nathan Schley"

---

## 🔍 Console Check

**Look for these logs (in order):**

```
✅ [RateMyGaucho] ✅ Successfully loaded final.csv
✅ [RateMyGaucho] Parsed 2976 course records
✅ [RateMyGaucho] Sample course records (first 3):
     [1] ANTH 3: { csvProfessor: "Stuart Smith", verification: "MISMATCH", ... }

✅ [RateMyGaucho] Course data chosen for instructor: Nathan Schley -> MATH 4B
     filteredReviews: 3 (filtered)
```

**Should NOT see:**
```
❌ [RateMyGaucho] SKIPPED course data for Nathan Schley - no instructor-specific reviews found
```

---

## 🧪 Test Console Command

Run this in Console to verify data is loaded correctly:

```javascript
(async () => {
  const cl = await ensureCoursesLoaded();
  const recs = cl.get('MATH 4B');
  console.log('✓ Records found:', recs?.length);
  console.log('✓ CSV Professor:', recs?.[0]?.csvProfessor);
  console.log('✓ Verification:', recs?.[0]?.reviewVerification);
  console.log('✓ Review count:', recs?.[0]?.recentReviews?.length);
  console.log('✓ Sample review:', recs?.[0]?.recentReviews?.[0]?.substring(0, 80) + '...');
})();
```

**Expected Output:**
```
✓ Records found: 1
✓ CSV Professor: Nathan Schley
✓ Verification: MATCH
✓ Review count: 3
✓ Sample review: Nathan would often go into tangents and not really teach concepts in a way that...
```

---

## 📋 Additional Test Cases

| Course | What to Check |
|--------|--------------|
| **MATH 4B** | Reviews show (first name only) |
| **MATH 6A** | Reviews show (XU Yang) |
| **ANTH 3** | Reviews show (Stuart Smith, MISMATCH) |
| **ANTH 113** | Reviews show (Emiko Saldivar, MATCH) |

---

## ✅ Success Checklist

- [ ] Extension reloaded without errors
- [ ] Console shows "2976 course records"
- [ ] MATH 4B shows Nathan Schley's reviews
- [ ] Reviews mention "Nathan" (not "Schley")
- [ ] New fields show: Professor (PLAT), Verification
- [ ] No "SKIPPED" messages for MATCH courses
- [ ] Star ratings still work
- [ ] Links still work

**If all checked:** ✅ Fix successful!

---

## 🆘 Troubleshooting

### Reviews still not showing

1. **Hard reload extension:**
   - chrome://extensions/
   - Toggle extension OFF then ON
   - Click reload icon

2. **Clear browser cache:**
   - DevTools → Network tab → Check "Disable cache"
   - Reload GOLD page

3. **Check syntax:**
   ```bash
   cd /Users/logan/RateMyGaucho
   node -c content/content.js
   ```

4. **Verify file changes:**
   ```bash
   git diff content/content.js | head -50
   ```

### False positives (wrong reviews)

- Check console for verification flags
- Review should pass one of:
  - Last name in text
  - First name + teaching term
  - CSV professor matches
  - Verification = MATCH

---

## 📚 Full Documentation

- **Complete details:** `REVIEW_FIX_VERIFICATION.md`
- **Original migration:** `MIGRATION_SUMMARY.md`
- **Testing guide:** `TESTING_GUIDE.md`

---

**Quick Start:** Follow steps 1-3 above, then check the success checklist!
