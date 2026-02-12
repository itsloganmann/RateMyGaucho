# RateMyGaucho - New Features Showcase

## 🎯 Overview
This document showcases the 6 new features added to the RateMyGaucho Chrome extension, designed to enhance the UCSB GOLD course registration experience.

---

## 🎲 Feature 1: GauchoOdds - Waitlist Probability Calculator

### What It Does
Calculates the probability (0-100%) of getting off the waitlist for any course section based on historical enrollment data.

### How It Works
- Analyzes enrollment history patterns
- Checks for capacity expansions
- Measures overenrollment tolerance
- Calculates average utilization

### Visual Elements
```
┌─────────────────────────────────────────┐
│ Historic Enrollment                     │
│ ┌─────────────────────────────────────┐ │
│ │ Pass 1  [████████░░░░] 80%         │ │
│ │ Pass 2  [██████████░░] 90%         │ │
│ │ Pass 3  [████████████] 95%         │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Waitlist Probability:                   │
│ [75% Very Likely] ← Green badge         │
└─────────────────────────────────────────┘
```

### Rating Scale
- 🟢 Very Likely (75-100%): Class frequently expands
- 🟡 Likely (50-75%): Sometimes expands
- 🟠 Possible (25-50%): Occasionally expands
- 🔴 Unlikely (0-25%): Rarely expands

---

## 📊 Feature 2: Grade Inflation Index

### What It Does
Shows how a course's GPA compares to the department average, helping students understand relative difficulty.

### How It Works
- Calculates weighted average GPA per department
- Compares each course's GPA to department average
- Displays delta as color-coded chip

### Visual Elements
```
┌─────────────────────────────────────────┐
│ Grade Distribution [+0.4 (Easier)] 🟢   │
│ ┌─────────────────────────────────────┐ │
│ │ A   [████████████] 45%             │ │
│ │ B   [██████░░░░░░] 30%             │ │
│ │ C   [███░░░░░░░░░] 15%             │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### Color Coding
- 🟢 Green: Easier than average (+0.15 GPA or more)
- 🔴 Red: Harder than average (-0.15 GPA or more)
- 🔵 Blue: Near department average (±0.15 GPA)

---

## 🌲 Feature 3: Prerequisite Tree Visualization

### What It Does
Displays prerequisite chains when hovering over course names, helping students plan their course sequence.

### How It Works
- Extracts prerequisites from course reviews
- Identifies patterns (e.g., CMPSC 130B requires 130A)
- Builds recursive prerequisite tree
- Shows on hover with 200ms delay

### Visual Elements
```
┌─────────────────────────────────────────┐
│ CMPSC 130B                              │ ← Hover triggers tooltip
│ ┌───────────────────────────────────┐   │
│ │ Prerequisites:                    │   │
│ │ CMPSC 130B ← CMPSC 130A          │   │
│ │            ← CMPSC 24             │   │
│ │              ← CMPSC 16           │   │
│ └───────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### Pattern Detection
- Explicit mentions: "Prereq: CMPSC 130", "requires MATH 3A"
- Course patterns: 130B → 130A, 130A → 24
- Review text analysis: "need CMPSC 24 first"

---

## ⚠️ Feature 4: Smart Conflict Detection

### What It Does
Automatically flags courses whose meeting times conflict with the user's current schedule.

### How It Works
- Parses user's schedule from GOLD interface
- Extracts day/time information
- Checks for overlaps
- Highlights conflicts

### Visual Elements
```
┌─────────────────────────────────────────┐
│ [⚠️ Conflicts with CMPSC 154]           │ ← Red badge
│ MATH 8 - TR 2:00-3:15                   │ ← Red tinted row
└─────────────────────────────────────────┘

Your Schedule:
  CMPSC 154 - TR 2:30-3:45 ← Overlap detected!
```

### Conflict Detection
- Checks day overlap first
- Then checks time overlap
- Lists all conflicting courses
- Visual feedback with badge and background

---

## 📅 Feature 5: Download Schedule ICS Export

### What It Does
Exports your UCSB schedule as a .ics calendar file compatible with Google Calendar, Apple Calendar, Outlook, etc.

### How It Works
- Parses current schedule from GOLD
- Generates valid iCalendar format
- Creates recurring events for each class
- Includes quarter start/end dates

### Visual Elements
```
┌─────────────────────────────────────────┐
│                                         │
│                                         │
│                                         │
│                              [📅 Download│
│                               Schedule] │ ← Floating button
└─────────────────────────────────────────┘
```

### Export Details
- Format: iCalendar (.ics)
- Recurring: Weekly throughout quarter
- Day codes: MO, TU, WE, TH, FR
- Filename: `ucsb-winter-2025-schedule.ics`

---

## 🔍 Feature 6: Natural Language Filter

### What It Does
Allows students to search courses using natural language queries like "Easy CMPSC classes on MWF mornings".

### How It Works
- Lightweight NLP parsing (no external libraries)
- Extracts: days, times, difficulty, departments, level, keywords
- Filters courses based on parsed criteria
- Ranks results by relevance

### Visual Elements
```
┌──────────────────────────────────────────────────┐
│ [Try: "Easy CMPSC classes on MWF mornings"]     │ ← Search bar
└──────────────────────────────────────────────────┘
        ↓ Type query
┌──────────────────────────────────────────────────┐
│ Results (3)                                      │
│ ┌──────────────────────────────────────────────┐ │
│ │ CMPSC 16                                     │ │
│ │ Professor: Smith                             │ │
│ │ Avg GPA: 3.72 (+0.3 GPA (Easier than avg))  │ │
│ ├──────────────────────────────────────────────┤ │
│ │ CMPSC 24                                     │ │
│ │ Professor: Johnson                           │ │
│ │ Avg GPA: 3.58 (+0.2 GPA (Easier than avg))  │ │
│ └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### Supported Query Types
- **Days**: "monday", "tuesday", "MWF", "TR"
- **Times**: "morning", "afternoon", "evening", "after 2pm", "before 10am"
- **Difficulty**: "easy", "hard", "moderate"
- **Department**: "CMPSC", "MATH", "PSTAT"
- **Level**: "upper division", "lower division"
- **Keywords**: General search terms

### Example Queries
1. "Easy GE classes on Tuesday afternoons"
2. "CMPSC courses after 2pm"
3. "Upper division MATH classes"
4. "Hard PSTAT classes MWF mornings"

---

## 🎨 Design Philosophy

### UCSB Theme
All features maintain the UCSB color scheme:
- **Primary**: #003660 (UCSB Navy Blue)
- **Secondary**: #005a9e (Lighter blue)
- **Success**: #1b5e20 (Green)
- **Warning**: #7a5800 (Gold)
- **Danger**: #8a1c1c (Red)

### User Experience
- **Non-intrusive**: Features enhance, don't replace existing UI
- **Graceful degradation**: Missing data = hidden features
- **Consistent styling**: All use `.rmg-` CSS prefix
- **Smooth animations**: CSS transitions for all interactions
- **Accessible**: Tooltips, titles, and semantic HTML

---

## 🔧 Technical Highlights

### Privacy-First
- **No external API calls**: All processing happens locally
- **No data collection**: Extension doesn't send data anywhere
- **Offline functionality**: Works with local CSV dataset

### Performance
- **Efficient caching**: Data structures computed once
- **Lazy rendering**: Features only render when needed
- **Minimal DOM manipulation**: Uses document fragments
- **Debounced search**: NLP search waits for user to finish typing

### Code Quality
- **Modular functions**: Each feature is self-contained
- **Consistent patterns**: Follows existing code style
- **Comprehensive error handling**: Graceful failures
- **Security verified**: 0 vulnerabilities in CodeQL scan

---

## 📈 Impact

### Lines of Code
- **content.js**: +1025 lines (+46.6%)
- **styles.css**: +310 lines (+53.9%)
- **Total**: ~1335 lines of production code

### Features Added
- 6 major features
- 20+ new functions
- 30+ new CSS classes
- 1 comprehensive documentation file

### Quality Metrics
- ✅ Code review: 8 issues found and fixed
- ✅ Security scan: 0 vulnerabilities
- ✅ Syntax check: No errors
- ✅ Build test: Packages successfully

---

## 🚀 Future Enhancements

Potential improvements for future versions:
1. **Machine Learning**: ML-based waitlist prediction using historical patterns
2. **Real-time Updates**: Live conflict detection as schedule changes
3. **Multi-format Export**: Support for Outlook, Yahoo Calendar
4. **Advanced NLP**: Synonym support and more sophisticated parsing
5. **Prerequisite Learning**: Learn patterns from historical course sequences
6. **Cross-quarter Trends**: Grade inflation trends over multiple quarters
7. **Schedule Optimizer**: Suggest optimal course schedules
8. **Peer Comparison**: Compare your schedule with anonymized peer data

---

## 📝 Conclusion

These 6 features significantly enhance the RateMyGaucho extension, providing UCSB students with powerful tools for course selection, schedule planning, and academic decision-making. All features maintain the privacy-first philosophy, work offline, and integrate seamlessly with the existing GOLD interface.

**Built with ❤️ for UCSB Gauchos**
