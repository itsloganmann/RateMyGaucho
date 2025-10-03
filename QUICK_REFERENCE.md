# Quick Reference Card - final.csv Migration

## ⚡ Fast Track Testing (5 minutes)

### 1. Load Extension
```
Chrome → chrome://extensions/ → Enable Developer Mode → Load unpacked
Select: /Users/logan/RateMyGaucho
```

### 2. Test It
```
1. Open DevTools (F12)
2. Go to: https://my.sa.ucsb.edu/gold/
3. Search for: "ANTH" or any course
4. Check console for: "✅ Successfully loaded final.csv"
5. Check console for: "Parsed 2976 course records"
```

### 3. Verify UI
- Look for professor rating cards below instructor names
- New fields should show:
  - **Professor (PLAT):** [name]
  - **Verification:** MATCH/MISMATCH/FLAG • **Reviews:** X/Y

---

## 🔍 Console Commands

### Check if migration worked:
```javascript
// In Chrome DevTools Console:
window.__rmg_course_lookup.size  // Should be ~950 (course keys)
```

### Run comprehensive test:
```javascript
window.testReviewFiltering()
```

### Check what CSV was loaded:
Look for this in console:
```
[RateMyGaucho] ✅ Successfully loaded final.csv  // ← Good!
[RateMyGaucho] Parsed 2976 course records        // ← Good!
```

NOT this:
```
[RateMyGaucho] Falling back to legacy...         // ← Bad, see troubleshooting
[RateMyGaucho] Parsed 2422 course records        // ← Old file loaded
```

---

## 🎯 Quick Test Cases

| Course | Expected Professor | Verification | Reviews |
|--------|-------------------|--------------|---------|
| ANTH 3 | Stuart Smith | MISMATCH | 122/6 |
| ANTH 113 | Emiko Saldivar | MATCH | 9/9 |
| ANTH 5 | Unknown Professor | ⚠ FLAG | 0/5 |

---

## ❌ Troubleshooting

### Issue: Old file loading (2,422 records)
**Fix:**
```bash
# Check file exists
ls -lh /Users/logan/RateMyGaucho/final.csv

# Reload extension
Chrome → Extensions → RateMyGaucho → Reload icon
```

### Issue: No new fields showing
**Reason:** Gating logic - only shows when instructor-specific reviews exist  
**Try:** Search for "ANTH 3" (has lots of reviews)

### Issue: Parsing errors (raw pipes: "A|A")
**Fix:**
```bash
# Test parser
open test_parsing.html  # Should show 11/11 tests passed
```

---

## 📊 What Changed?

### Data:
- ✅ 2,422 → 2,976 records (+554)
- ✅ Added: professor, verification, review counts
- ✅ Pipe format: `A|A` instead of `["A", "A"]`
- ✅ Review separator: `|||` instead of JSON array

### Code:
- ✅ `manifest.json`: Added final.csv to web_accessible_resources
- ✅ `content.js`: New flexible parser + fallback loader
- ✅ `content.js`: New UI fields for professor/verification

### Safety:
- ✅ Backward compatible (falls back to old CSV if needed)
- ✅ All existing functionality preserved
- ✅ No git commits/pushes (local only)

---

## 🔄 Rollback (if needed)

**Option 1: Automatic (rename file)**
```bash
cd /Users/logan/RateMyGaucho
mv final.csv final.csv.disabled
# Reload extension - will use old CSV automatically
```

**Option 2: Manual (revert code)**
See: `MIGRATION_SUMMARY.md` → "Rollback Plan"

---

## 📚 Documentation

- **Detailed info:** `MIGRATION_SUMMARY.md` (comprehensive)
- **Testing steps:** `TESTING_GUIDE.md` (step-by-step)
- **Parser tests:** `test_parsing.html` (automated)
- **This card:** `QUICK_REFERENCE.md` (you are here)

---

## ✅ Success Checklist

- [ ] Extension loads without errors
- [ ] Console shows "final.csv" and "2976 records"
- [ ] New UI fields appear on GOLD course pages
- [ ] Star ratings still work
- [ ] Links still work
- [ ] No JavaScript errors

**If all checked:** ✅ Migration successful!

---

## 🆘 Need Help?

1. Check console logs (F12 → Console tab)
2. Review `MIGRATION_SUMMARY.md` for known issues
3. Run `window.testReviewFiltering()` for diagnostics
4. Test parser with `open test_parsing.html`

---

**Quick Start:** Follow steps 1-3 above, then check the success checklist!
