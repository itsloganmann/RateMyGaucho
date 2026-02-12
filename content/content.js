(function debugBanner(){ try { console.log('[RateMyGaucho] content v1.0.4 at', location.href); } catch(_){} })();

// Debug function to test review filtering
window.testReviewFiltering = async function() {
	console.log('[RateMyGaucho] Testing review filtering...');
	const courseLookup = await ensureCoursesLoaded();
	const ratingsLookup = await ensureRatingsLoaded();
	
	if (!courseLookup || !ratingsLookup) {
		console.error('[RateMyGaucho] Failed to load data for testing');
		return;
	}
	
	// Test with MATH 2A and known instructors
	const testCourse = 'MATH 2A';
	const courseRecords = courseLookup.get(testCourse);
	
	if (!courseRecords) {
		console.log('[RateMyGaucho] No records found for', testCourse);
		return;
	}
	
	console.log(`[RateMyGaucho] Found ${courseRecords.length} records for ${testCourse}`);
	
	// Test with different instructors
	const testInstructors = [
		{ firstName: 'Matt', lastName: 'Porter' },
		{ firstName: 'Raul', lastName: 'Rodriguez' },
		{ firstName: 'Kelvin', lastName: 'Lam' }
	];
	
	for (const instructor of testInstructors) {
		console.log(`\n=== Testing ${instructor.firstName} ${instructor.lastName} ===`);
		
		const selectedData = pickCourseDataForInstructor(courseRecords, instructor);
		if (selectedData) {
			console.log('Selected course data:', selectedData.courseName);
			console.log('Reviews filtered:', selectedData._reviewsFiltered);
			console.log('Review count:', selectedData.recentReviews ? selectedData.recentReviews.length : 0);
			
			if (selectedData.recentReviews && selectedData.recentReviews.length > 0) {
				console.log('Sample reviews:');
				selectedData.recentReviews.slice(0, 2).forEach((review, i) => {
					console.log(`  ${i + 1}: "${review.substring(0, 100)}..."`);
				});
			}
			
			// Test gating logic
			const wouldBeGated = !(selectedData._reviewsFiltered && selectedData.recentReviews && selectedData.recentReviews.length > 0);
			console.log('Would be gated (skipped):', wouldBeGated);
		} else {
			console.log('No course data selected for this instructor');
		}
	}
};

// Message probe to verify content script presence from page console
try {
	window.addEventListener('message', ev => {
		if (ev && ev.data && ev.data.__rmg_probe) {
			console.log('[RateMyGaucho] probe ack from content script');
		}
	});
} catch {}

(async function initRateMyGaucho() {
	let path = location.pathname || '';
	try { if (window.top && window.top.location) path = window.top.location.pathname || path; } catch {}
	if (!/\/gold\//i.test(path) || /logout\.aspx$/i.test(path)) return;
	const settings = await loadSettings();
	if (settings && settings.enabled === false) return;
	observeAndRender();
})();

let __rmg_data_cache = null;
let __rmg_data_loading = null;
let __rmg_course_lookup = null;

const DATASET_FILENAME = 'courses_final_enrollment.csv';

const PASS_TIME_SCHEDULES = {
	'WINTER 2025': [
		{ key: 'schedule', label: 'Schedule Posted', start: makeUtcDate(2024, 9, 21), end: makeUtcDate(2024, 9, 21) },
		{ key: 'pass1', label: 'Pass 1', start: makeUtcDate(2024, 10, 4), end: makeUtcDate(2024, 10, 10) },
		{ key: 'pass2', label: 'Pass 2', start: makeUtcDate(2024, 10, 12), end: makeUtcDate(2024, 10, 17) },
		{ key: 'pass3', label: 'Pass 3', start: makeUtcDate(2024, 10, 18), end: makeUtcDate(2025, 2, 14) }
	],
	'SPRING 2025': [
		{ key: 'schedule', label: 'Schedule Posted', start: makeUtcDate(2025, 0, 27), end: makeUtcDate(2025, 0, 27) },
		{ key: 'pass1', label: 'Pass 1', start: makeUtcDate(2025, 1, 10), end: makeUtcDate(2025, 1, 16) },
		{ key: 'pass2', label: 'Pass 2', start: makeUtcDate(2025, 1, 24), end: makeUtcDate(2025, 2, 2) },
		{ key: 'pass3', label: 'Pass 3', start: makeUtcDate(2025, 2, 3), end: makeUtcDate(2025, 5, 6) }
	],
	'FALL 2025': [
		{ key: 'schedule', label: 'Schedule Posted', start: makeUtcDate(2025, 3, 28), end: makeUtcDate(2025, 3, 28) },
		{ key: 'pass1', label: 'Pass 1', start: makeUtcDate(2025, 4, 12), end: makeUtcDate(2025, 4, 18) },
		{ key: 'pass2', label: 'Pass 2', start: makeUtcDate(2025, 4, 19), end: makeUtcDate(2025, 8, 3) },
		{ key: 'pass3', label: 'Pass 3', start: makeUtcDate(2025, 8, 9), end: makeUtcDate(2025, 11, 5) }
	]
};

const PASS_PHASE_PRE = { key: 'pre', label: 'Pre-Registration', order: -1 };
const PASS_PHASE_POST = { key: 'post', label: 'Post Pass 3', order: 6 };
const PASS_PHASE_FALLBACK = { key: 'timeline', label: 'Enrollment Timeline', order: 999 };

const GRADE_ORDER = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F', 'PASS', 'S', 'NP', 'U', 'FAIL'];

function gradeSortIndex(label) {
	const normalized = canonicalizeGradeLabel(label);
	if (!normalized) return GRADE_ORDER.length + 1;
	const index = GRADE_ORDER.indexOf(normalized);
	return index === -1 ? GRADE_ORDER.length : index;
}

async function ensureRatingsLoaded() {
	const data = await ensureUnifiedData();
	return data ? data.ratingsLookup : null;
}

async function ensureCoursesLoaded() {
	const data = await ensureUnifiedData();
	return data ? data.courseLookup : null;
}

async function ensureUnifiedData() {
	if (__rmg_data_cache) return __rmg_data_cache;
	if (__rmg_data_loading) return __rmg_data_loading;

	__rmg_data_loading = (async () => {
		try {
			console.log('[RateMyGaucho] Loading unified dataset:', DATASET_FILENAME);
			const csvUrl = chrome.runtime.getURL(DATASET_FILENAME);
			const res = await fetch(csvUrl);
			if (!res.ok) {
				console.error('[RateMyGaucho] Failed to fetch', DATASET_FILENAME);
				return null;
			}
			const csvText = await res.text();
			const parsed = parseUnifiedCsv(csvText);
			if (!parsed) return null;
			__rmg_data_cache = parsed;
			__rmg_course_lookup = parsed.courseLookup;
			window.__rmg_course_lookup = __rmg_course_lookup;
			console.log('[RateMyGaucho] ✅ Unified dataset ready:', {
				courses: parsed.courseRecords.length,
				instructors: parsed.instructors.length
			});
			return __rmg_data_cache;
		} catch (error) {
			console.error('[RateMyGaucho] Error loading unified dataset:', error);
			return null;
		} finally {
			__rmg_data_loading = null;
		}
	})();

	return __rmg_data_loading;
}

function parseUnifiedCsv(csvText) {
	try {
		const parsed = Papa.parse(csvText, {
			header: true,
			skipEmptyLines: true,
			transformHeader: (header) => header.trim()
		});

		if (parsed.errors && parsed.errors.length) {
			console.warn('[RateMyGaucho] CSV parsing warnings:', parsed.errors);
		}

		const courseRecords = [];
		const instructorAccumulator = new Map();

		for (const row of parsed.data) {
			const courseName = (row.course_name || '').trim();
			if (!courseName) continue;

			const courseUrl = (row.course_url || '').trim();
			const termContext = extractTermFromCourseUrl(courseUrl);
			const gradeDistribution = parseGradeDistribution(row.grading_trend);
			const gradeDisplay = gradeDistributionToStrings(gradeDistribution);
			const gradeStats = computeGradeStats(gradeDistribution);
			const enrollmentEntries = parseEnrollmentHistory(row.enrollment_trend, termContext);
			const enrollmentDisplay = enrollmentEntries.map(entry => entry.display);

			const courseRecord = {
				courseName,
				courseUrl,
				csvProfessor: (row.professor || '').trim(),
				gradingBasis: '',
				gradeDistribution,
				gradeDistributionDisplay: gradeDisplay,
				gradingTrend: gradeDisplay,
				gradeStats,
				historicEnrollment: enrollmentDisplay,
				enrollmentEntries,
				enrollmentTrend: enrollmentDisplay,
				termKey: termContext?.termKey || '',
				recentReviews: extractReviewsFromRow(row)
			};

			courseRecords.push(courseRecord);

			const professorName = courseRecord.csvProfessor;
			if (!professorName) continue;

			const { firstName, lastName } = splitProfessorName(professorName);
			if (!lastName) continue;

			const dept = extractDepartmentFromCourse(courseName);
			const normalizedKey = `${normalizePlain(lastName)}|${normalizePlain(firstName)}`;
			let bucket = instructorAccumulator.get(normalizedKey);
			if (!bucket) {
				bucket = {
					firstName,
					lastName,
					departments: new Set(dept ? [dept] : []),
					reviews: [],
					gradeDistributions: [],
					gradeRatings: [],
					courseUrls: new Set(),
					courses: []
				};
				instructorAccumulator.set(normalizedKey, bucket);
			}

			if (dept) bucket.departments.add(dept);
			bucket.courses.push(courseRecord);
			bucket.courseUrls.add(courseRecord.courseUrl || '');
			if (Array.isArray(courseRecord.recentReviews) && courseRecord.recentReviews.length) {
				bucket.reviews.push(...courseRecord.recentReviews);
			}
			if (Array.isArray(gradeDistribution) && gradeDistribution.length) {
				bucket.gradeDistributions.push(gradeDistribution);
			}
			if (gradeStats && Number.isFinite(gradeStats.average)) {
				bucket.gradeRatings.push(gradeStats);
			}
		}

		const instructors = [];
		for (const bucket of instructorAccumulator.values()) {
			const departments = Array.from(bucket.departments);
			const aggregatedDistribution = aggregateGradeDistributions(bucket.gradeDistributions);
			const gradeSummary = gradeDistributionToStrings(aggregatedDistribution);
			const rating = computeAggregateRating(bucket.gradeRatings, bucket.reviews.length);
			const profileUrl = Array.from(bucket.courseUrls).find(Boolean) || '';

			instructors.push({
				firstName: bucket.firstName,
				lastName: bucket.lastName,
				department: departments[0] || '',
				rmpScore: rating,
				numReviews: bucket.reviews.length,
				profileUrl,
				gradeSummary,
				reviewSamples: bucket.reviews.slice(0, 5),
				courses: bucket.courses
			});
		}

		const courseLookup = buildCourseLookup(courseRecords);
		const ratingsLookup = buildLookup(instructors);
		
		// Feature 2: Build department averages for grade inflation index
		const departmentAverages = buildDepartmentAverages(courseRecords);

		return { courseRecords, courseLookup, ratingsLookup, instructors, departmentAverages };
	} catch (error) {
		console.error('[RateMyGaucho] Error parsing unified CSV:', error);
		return null;
	}
}

// Feature 2: Grade Inflation Index
function buildDepartmentAverages(courseRecords) {
	const deptMap = new Map();
	
	for (const record of courseRecords) {
		const dept = extractDepartmentFromCourse(record.courseName);
		if (!dept) continue;
		
		const gradeStats = record.gradeStats;
		if (!gradeStats || !Number.isFinite(gradeStats.average)) continue;
		
		if (!deptMap.has(dept)) {
			deptMap.set(dept, { totalWeightedGPA: 0, totalWeight: 0 });
		}
		
		const bucket = deptMap.get(dept);
		const weight = Number.isFinite(gradeStats.weight) ? gradeStats.weight : 1;
		bucket.totalWeightedGPA += gradeStats.average * weight;
		bucket.totalWeight += weight;
	}
	
	const averages = new Map();
	for (const [dept, bucket] of deptMap.entries()) {
		if (bucket.totalWeight > 0) {
			averages.set(dept, bucket.totalWeightedGPA / bucket.totalWeight);
		}
	}
	
	console.log('[RateMyGaucho] Built department averages for', averages.size, 'departments');
	return averages;
}

function computeGradeInflationIndex(courseData, deptAverages) {
	if (!courseData || !deptAverages) {
		return null;
	}
	
	const courseGPA = courseData.gradeStats?.average;
	if (!Number.isFinite(courseGPA)) {
		return null;
	}
	
	const dept = extractDepartmentFromCourse(courseData.courseName);
	if (!dept) {
		return null;
	}
	
	const deptAvg = deptAverages.get(dept);
	if (!Number.isFinite(deptAvg)) {
		return null;
	}
	
	const delta = courseGPA - deptAvg;
	
	let label;
	if (Math.abs(delta) < 0.15) {
		label = 'Near dept avg';
	} else if (delta > 0) {
		label = `+${delta.toFixed(2)} GPA (Easier than avg)`;
	} else {
		label = `${delta.toFixed(2)} GPA (Harder than avg)`;
	}
	
	return { delta, label, courseGPA, deptAvg };
}

// Feature 1: GauchoOdds (Waitlist Probability)
function computeWaitlistOdds(courseData) {
	if (!courseData || !Array.isArray(courseData.enrollmentEntries)) {
		return null;
	}
	
	const entries = courseData.enrollmentEntries;
	if (entries.length < 3) {
		return null; // Not enough data for meaningful analysis
	}
	
	// Analyze capacity expansion and overenrollment patterns
	let capacityExpansions = 0;
	let overenrollmentInstances = 0;
	let totalCapacity = 0;
	let totalFilled = 0;
	let capacityCount = 0;
	
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		
		if (!Number.isFinite(entry.capacity) || !Number.isFinite(entry.filled)) {
			continue;
		}
		
		totalCapacity += entry.capacity;
		totalFilled += entry.filled;
		capacityCount++;
		
		// Check for overenrollment (filled > capacity)
		if (entry.filled > entry.capacity) {
			overenrollmentInstances++;
		}
		
		// Check for capacity expansion compared to previous entry
		if (i > 0 && Number.isFinite(entries[i-1].capacity)) {
			const capacityChange = ((entry.capacity - entries[i-1].capacity) / entries[i-1].capacity) * 100;
			if (capacityChange >= 5) { // 5% or more expansion
				capacityExpansions++;
			}
		}
	}
	
	if (capacityCount === 0) {
		return null;
	}
	
	// Calculate metrics
	const avgCapacity = totalCapacity / capacityCount;
	const avgFilled = totalFilled / capacityCount;
	const avgUtilization = (avgFilled / avgCapacity) * 100;
	const expansionRate = (capacityExpansions / (entries.length - 1)) * 100;
	const overenrollmentRate = (overenrollmentInstances / capacityCount) * 100;
	
	// Calculate odds based on multiple factors
	let odds = 0;
	
	// Factor 1: Capacity expansion history (0-40 points)
	if (expansionRate > 30) {
		odds += 40;
	} else if (expansionRate > 15) {
		odds += 30;
	} else if (expansionRate > 5) {
		odds += 20;
	} else {
		odds += 10;
	}
	
	// Factor 2: Overenrollment tolerance (0-30 points)
	if (overenrollmentRate > 40) {
		odds += 30;
	} else if (overenrollmentRate > 20) {
		odds += 20;
	} else if (overenrollmentRate > 5) {
		odds += 10;
	}
	
	// Factor 3: Average utilization (0-30 points)
	// Lower utilization = more room = higher odds
	if (avgUtilization < 90) {
		odds += 30;
	} else if (avgUtilization < 95) {
		odds += 20;
	} else if (avgUtilization < 100) {
		odds += 10;
	}
	
	// Ensure odds are in 0-100 range
	odds = Math.max(0, Math.min(100, odds));
	
	// Determine label
	let label;
	let detail;
	if (odds >= 75) {
		label = 'Very Likely';
		detail = 'This class frequently expands capacity or accepts overenrollment';
	} else if (odds >= 50) {
		label = 'Likely';
		detail = 'This class sometimes expands capacity or has available seats';
	} else if (odds >= 25) {
		label = 'Possible';
		detail = 'This class occasionally expands but fills quickly';
	} else {
		label = 'Unlikely';
		detail = 'This class rarely expands and typically stays at capacity';
	}
	
	return { odds, label, detail };
}

function extractTermFromCourseUrl(url) {
	if (!url) return null;
	try {
		const decoded = decodeURIComponent(url);
		const match = decoded.match(/class\/([A-Z]+)\s+(\d{4})/i);
		if (match) {
			const season = match[1].toUpperCase();
			const year = Number(match[2]);
			if (Number.isFinite(year)) {
				return { termKey: `${season} ${year}`, season, year };
			}
		}
	} catch (error) {
		console.debug('[RateMyGaucho] Failed to derive term from course URL:', error);
	}
	return null;
}

function parseGradeDistribution(raw) {
	const distribution = [];
	if (!raw && raw !== 0) return distribution;
	const text = String(raw).trim();
	if (!text) return distribution;
	const segments = text.split(',').map(part => part.trim()).filter(Boolean);
	for (const segment of segments) {
		const normalized = segment.replace(/\s+/g, ' ').trim();
		if (!normalized) continue;
		const match = normalized.match(/^([^:]+):\s*([\d.]+)%$/i) || normalized.match(/^([^:]+)\s+([\d.]+)%$/i);
		let labelText;
		let percent = NaN;
		if (match) {
			labelText = match[1].trim();
			percent = Number(match[2]);
		} else {
			labelText = normalized;
		}
		const label = canonicalizeGradeLabel(labelText);
		if (!label) continue;
		distribution.push({
			label,
			displayLabel: formatGradeLabelForDisplay(label),
			percent: Number.isFinite(percent) ? percent : NaN
		});
	}
	return distribution;
}

function canonicalizeGradeLabel(label) {
	if (!label && label !== 0) return '';
	const cleaned = label.toString().trim().toUpperCase().replace(/\s+/g, '');
	if (!cleaned) return '';
	if (cleaned === 'PASS' || cleaned === 'P') return 'PASS';
	if (cleaned === 'FAIL' || cleaned === 'FL') return 'FAIL';
	if (cleaned === 'NP' || cleaned === 'NOPASS') return 'NP';
	if (cleaned === 'S' || cleaned === 'SAT') return 'S';
	if (cleaned === 'U' || cleaned === 'UNSAT') return 'U';
	const match = cleaned.match(/^([ABCDF])([+-]?)$/);
	if (match) {
		return `${match[1]}${match[2] || ''}`;
	}
	return cleaned;
}

function formatGradeLabelForDisplay(label) {
	switch (label) {
		case 'PASS':
			return 'Pass';
		case 'FAIL':
			return 'Fail';
		case 'NP':
			return 'No Pass';
		default:
			return label;
	}
}

function gradeDistributionToStrings(distribution) {
	if (!Array.isArray(distribution) || distribution.length === 0) return [];
	return distribution
		.map(formatGradeDistributionEntry)
		.filter(Boolean);
}

function formatGradeDistributionEntry(entry) {
	if (!entry) return '';
	const label = entry.displayLabel || formatGradeLabelForDisplay(entry.label);
	if (!label) return '';
	const percent = Number(entry.percent);
	if (Number.isFinite(percent)) {
		const decimals = Math.abs(percent - Math.round(percent)) < 0.05 ? 0 : 1;
		return `${label} ${percent.toFixed(decimals)}%`;
	}
	return label;
}

function computeGradeStats(distribution) {
	if (!Array.isArray(distribution) || distribution.length === 0) return null;
	let totalWeight = 0;
	let weightedSum = 0;
	for (const entry of distribution) {
		if (!entry) continue;
		const rating = gradeLabelToRating(entry.label);
		const percent = Number(entry.percent);
		if (!Number.isFinite(rating) || !Number.isFinite(percent)) continue;
		totalWeight += percent;
		weightedSum += percent * rating;
	}
	if (totalWeight <= 0) return null;
	return {
		average: weightedSum / totalWeight,
		weight: totalWeight
	};
}

function aggregateGradeDistributions(distributionSets) {
	if (!Array.isArray(distributionSets) || distributionSets.length === 0) return [];
	const totals = new Map();
	let contributingSets = 0;
	for (const set of distributionSets) {
		if (!Array.isArray(set) || set.length === 0) continue;
		contributingSets += 1;
		for (const entry of set) {
			if (!entry || !entry.label) continue;
			const percent = Number(entry.percent);
			if (!Number.isFinite(percent)) continue;
			totals.set(entry.label, (totals.get(entry.label) || 0) + percent);
		}
	}
	if (contributingSets === 0) return [];
	const results = Array.from(totals.entries()).map(([label, total]) => ({
		label,
		displayLabel: formatGradeLabelForDisplay(label),
		percent: total / contributingSets
	}));
	results.sort((a, b) => Number(b.percent || 0) - Number(a.percent || 0));
	return results;
}

function parseEnrollmentHistory(raw, termContext) {
	const history = [];
	if (!raw && raw !== 0) return history;
	const text = String(raw).trim();
	if (!text) return history;
	const segments = text.split('|').map(part => part.trim()).filter(Boolean);
	const schedule = getPassTimeSchedule(termContext?.termKey);
	let fallbackYear = termContext?.year ?? null;
	segments.forEach((segment, index) => {
		const base = parseEnrollmentSegment(segment, termContext, fallbackYear);
		if (base && Number.isFinite(base.resolvedYear)) {
			fallbackYear = base.resolvedYear;
		}
		const enriched = enrichEnrollmentEntry({ ...base, originalIndex: index }, schedule, termContext);
		history.push(enriched);
	});
	const sorted = history.slice().sort((a, b) => {
		const orderDiff = (a.phaseOrder ?? PASS_PHASE_FALLBACK.order) - (b.phaseOrder ?? PASS_PHASE_FALLBACK.order);
		if (orderDiff !== 0) return orderDiff;
		const timeA = a.date ? a.date.getTime() : Number.MAX_SAFE_INTEGER;
		const timeB = b.date ? b.date.getTime() : Number.MAX_SAFE_INTEGER;
		if (timeA !== timeB) return timeA - timeB;
		return (a.originalIndex ?? 0) - (b.originalIndex ?? 0);
	});
	return sorted.map(entry => ({
		...entry,
		display: formatEnrollmentDisplay(entry, termContext),
		displayDate: entry.date ? formatEnrollmentDate(entry.date, termContext) : '',
		percentFull: Number.isFinite(entry.percentFull) ? Math.max(0, Math.min(entry.percentFull, 150)) : NaN
	}));
}

function parseEnrollmentSegment(segment, termContext, fallbackYear) {
	const raw = segment.trim();
	if (!raw) {
		return { raw, detail: raw, date: null, resolvedYear: fallbackYear };
	}
	const match = raw.match(/^([A-Za-z]{3}\s+\d{1,2}(?:\s+\d{4})?):\s*(.+)$/);
	if (!match) {
		return { raw, detail: raw, date: null, resolvedYear: fallbackYear };
	}
	const dateText = match[1];
	const detail = match[2].trim();
	const { date, year } = parseEnrollmentDate(dateText, termContext, fallbackYear);
	let filled = NaN;
	let capacity = NaN;
	let remaining = NaN;
	let percentFull = NaN;
	const seatMatch = detail.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/);
	if (seatMatch) {
		filled = Number(seatMatch[1]);
		capacity = Number(seatMatch[2]);
		if (Number.isFinite(filled) && Number.isFinite(capacity) && capacity > 0) {
			percentFull = (filled / capacity) * 100;
		}
	}
	const remainingMatch = detail.match(/\(([-\d]+)\s*(?:remaining|open)\)/i);
	if (remainingMatch) {
		remaining = Number(remainingMatch[1]);
	}
	if (!Number.isFinite(remaining) && Number.isFinite(capacity) && Number.isFinite(filled)) {
		remaining = capacity - filled;
	}
	return {
		raw,
		detail,
		date,
		dateText,
		resolvedYear: year,
		filled,
		capacity,
		remaining,
		percentFull
	};
}

function parseEnrollmentDate(dateText, termContext, fallbackYear) {
	const tokens = dateText.trim().split(/\s+/);
	if (tokens.length < 2) return { date: null, year: fallbackYear ?? null };
	const monthIndex = monthIndexFromName(tokens[0]);
	if (monthIndex < 0) return { date: null, year: fallbackYear ?? null };
	const day = parseInt(tokens[1], 10);
	let year = tokens.length >= 3 ? parseInt(tokens[2], 10) : undefined;
	if (!Number.isFinite(year)) {
		const termYear = termContext?.year ?? fallbackYear ?? null;
		year = resolveYearForTerm(termContext?.season, monthIndex, termYear);
	}
	if (!Number.isFinite(year) || !Number.isFinite(day)) {
		return { date: null, year: fallbackYear ?? year ?? null };
	}
	return { date: new Date(Date.UTC(year, monthIndex, day)), year };
}

function monthIndexFromName(name) {
	if (!name) return -1;
	const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
	const idx = months.indexOf(name.toUpperCase().slice(0, 3));
	return idx;
}

function resolveYearForTerm(season, monthIndex, termYear) {
	if (!Number.isFinite(termYear)) return termYear ?? null;
	if (!season) return termYear;
	switch (season.toUpperCase()) {
		case 'WINTER':
			return monthIndex >= 8 ? termYear - 1 : termYear;
		default:
			return termYear;
	}
}

function getPassTimeSchedule(termKey) {
	const schedule = PASS_TIME_SCHEDULES[termKey];
	if (!Array.isArray(schedule) || schedule.length === 0) return null;
	return schedule.map((event, index) => ({
		key: event.key,
		label: event.label,
		start: event.start,
		end: event.end,
		order: typeof event.order === 'number' ? event.order : index
	}));
}

function categorizeEnrollmentPhase(date, schedule) {
	if (!date || !Array.isArray(schedule) || schedule.length === 0) return PASS_PHASE_FALLBACK;
	const first = schedule[0];
	const last = schedule[schedule.length - 1];
	if (date < first.start) return PASS_PHASE_PRE;
	if (date > last.end) {
		return { key: PASS_PHASE_POST.key, label: PASS_PHASE_POST.label, order: last.order + 1 };
	}
	for (const event of schedule) {
		if (date >= event.start && date <= event.end) return event;
		if (date < event.start) return event;
	}
	return PASS_PHASE_FALLBACK;
}

function enrichEnrollmentEntry(entry, schedule, termContext) {
	if (!entry) return { phaseKey: PASS_PHASE_FALLBACK.key, phaseLabel: PASS_PHASE_FALLBACK.label, phaseOrder: PASS_PHASE_FALLBACK.order };
	if (!entry.date || !schedule) {
		return { ...entry, phaseKey: PASS_PHASE_FALLBACK.key, phaseLabel: PASS_PHASE_FALLBACK.label, phaseOrder: PASS_PHASE_FALLBACK.order };
	}
	const phase = categorizeEnrollmentPhase(entry.date, schedule);
	return {
		...entry,
		phaseKey: phase.key,
		phaseLabel: phase.label,
		phaseOrder: phase.order
	};
}

function formatEnrollmentDisplay(entry, termContext) {
	if (!entry) return '';
	if (!entry.date) {
		return entry.detail || entry.raw || '';
	}
	const phase = entry.phaseLabel || 'Enrollment';
	const dateText = formatEnrollmentDate(entry.date, termContext);
	const detail = entry.detail || '';
	return `${phase} (${dateText}): ${detail}`;
}

function formatEnrollmentDate(date, termContext) {
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const monthName = months[date.getUTCMonth()] || '';
	const day = date.getUTCDate();
	const baseYear = termContext?.year;
	const includeYear = !Number.isFinite(baseYear) || date.getUTCFullYear() !== baseYear;
	return includeYear ? `${monthName} ${day} ${date.getUTCFullYear()}` : `${monthName} ${day}`;
}

function normalizeGradeSample(sample) {
	if (sample == null) return null;
	if (typeof sample === 'object' && sample.label) {
		return {
			label: canonicalizeGradeLabel(sample.label),
			percent: Number(sample.percent)
		};
	}
	if (typeof sample === 'string') {
		const text = sample.trim();
		if (!text) return null;
		const match = text.match(/^([^:]+):\s*([\d.]+)%$/i) || text.match(/^([^:]+)\s+([\d.]+)%$/i);
		let labelText = text;
		let percent = NaN;
		if (match) {
			labelText = match[1].trim();
			percent = Number(match[2]);
		}
		return {
			label: canonicalizeGradeLabel(labelText),
			percent
		};
	}
	return null;
}

function gradeLabelToRating(label) {
	if (!label && label !== 0) return NaN;
	const normalized = canonicalizeGradeLabel(label);
	if (!normalized) return NaN;
	switch (normalized) {
		case 'PASS':
			return 4.5;
		case 'FAIL':
		case 'NP':
		case 'U':
			return 1.5;
		case 'S':
			return 4.0;
	}
	const match = normalized.match(/^([ABCDF])([+-]?)$/);
	if (!match) return NaN;
	let base;
	switch (match[1]) {
		case 'A':
			base = 5;
			break;
		case 'B':
			base = 4;
			break;
		case 'C':
			base = 3;
			break;
		case 'D':
			base = 2;
			break;
		case 'F':
			base = 1.2;
			break;
		default:
			base = 3;
	}
	const modifier = match[2] || '';
	if (modifier === '+') base = Math.min(5, base + 0.2);
	else if (modifier === '-') base = Math.max(1, base - 0.2);
	return base;
}

function makeUtcDate(year, monthIndex, day) {
	return new Date(Date.UTC(year, monthIndex, day));
}

function normalizeTrend(raw) {
	if (!raw) return '';
	const text = String(raw).trim();
	if (!text) return '';
	return text.replace(/→/g, '|').replace(/[\/]/g, '|');
}

function extractReviewsFromRow(row) {
	const reviews = [];
	for (const [key, value] of Object.entries(row)) {
		if (!/^review_/i.test(key)) continue;
		const text = (value || '').toString().trim();
		if (text) reviews.push(text);
	}
	return reviews;
}

function splitProfessorName(name) {
	const tokens = (name || '').trim().split(/\s+/).filter(Boolean);
	if (!tokens.length) return { firstName: '', lastName: '' };
	if (tokens.length === 1) return { firstName: '', lastName: tokens[0] };
	const lastName = tokens[tokens.length - 1];
	const firstName = tokens.slice(0, -1).join(' ');
	return { firstName, lastName };
}

function extractDepartmentFromCourse(courseName) {
	if (!courseName) return '';
	const match = courseName.match(/^([A-Z]{2,8})\b/);
	return match ? match[1] : '';
}

function computeAggregateRating(gradeSamples, reviewCount) {
	if (Array.isArray(gradeSamples) && gradeSamples.length) {
		let totalWeight = 0;
		let weightedSum = 0;
		for (const sample of gradeSamples) {
			if (sample == null) continue;
			if (typeof sample === 'object') {
				const value = Number(sample.average ?? sample.value ?? sample.rating);
				const weightRaw = Number(sample.weight ?? sample.totalWeight ?? sample.count ?? sample.percent);
				if (Number.isFinite(value)) {
					const weight = Number.isFinite(weightRaw) && weightRaw > 0 ? weightRaw : 1;
					totalWeight += weight;
					weightedSum += value * weight;
					continue;
				}
			}
			const normalized = normalizeGradeSample(sample);
			if (!normalized || !normalized.label) continue;
			const rating = gradeLabelToRating(normalized.label);
			if (!Number.isFinite(rating)) continue;
			const weight = Number.isFinite(normalized.percent) && normalized.percent > 0 ? normalized.percent : 1;
			totalWeight += weight;
			weightedSum += rating * weight;
		}
		if (totalWeight > 0) {
			return Number((weightedSum / totalWeight).toFixed(1));
		}
	}

	if (reviewCount > 0) {
		const fallback = Math.min(5, 3.2 + Math.min(reviewCount, 12) * 0.1);
		return Number(fallback.toFixed(1));
	}

	return 3.0;
}

function loadSettings() {
	return new Promise(resolve => {
		try { chrome.storage?.local?.get({ enabled: true, compactMode: false }, resolve); }
		catch { resolve({ enabled: true, compactMode: false }); }
	});
}


function parseFlexibleArray(raw, { delimiter = '|', type = 'string', reviewSeparator = null } = {}) {
	if (!raw || String(raw).trim() === '' || String(raw).toLowerCase() === 'no data') return [];
	const text = String(raw).trim();

	// 1) Try JSON first for backward compatibility (handles legacy format)
	if (text.startsWith('[') && text.endsWith(']')) {
		try {
			const parsed = JSON.parse(text);
			if (Array.isArray(parsed)) {
				return type === 'number' ? parsed.map(v => Number(v)).filter(n => Number.isFinite(n)) : parsed.map(v => String(v));
			}
		} catch (jsonError) {
			// Not valid JSON, continue to other parsing methods
			console.debug('[RateMyGaucho] JSON parse failed, trying delimiter parsing:', jsonError.message);
		}
	}

	// 2) If a review separator is provided, use that (e.g., "|||" for reviews)
	if (reviewSeparator && text.includes(reviewSeparator)) {
		return text.split(reviewSeparator).map(s => s.trim()).filter(Boolean);
	}

	// 3) Otherwise, split on delimiter (e.g., pipes for trends)
	if (delimiter && text.includes(delimiter)) {
		const parts = text.split(delimiter).map(s => s.trim()).filter(Boolean);
		return type === 'number' ? parts.map(v => Number(v)).filter(n => Number.isFinite(n)) : parts;
	}

	// 4) Fallback: single token
	if (type === 'number') {
		const num = Number(text);
		return Number.isFinite(num) ? [num] : [];
	}
	return [text];
}

function buildCourseLookup(records) {
	const map = new Map();
	for (const rec of records) {
		const normalizedName = normalizeCourseCode(rec.courseName);
		const list = map.get(normalizedName);
		if (list) {
			list.push(rec);
		} else {
			map.set(normalizedName, [rec]);
		}
	}
	console.log('[RateMyGaucho] Built course lookup with', map.size, 'course keys');
	return map;
}

function normalizeCourseCode(courseCode) {
	return (courseCode || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function filterReviewsByInstructor(reviews, matchedInstructor) {
	if (!Array.isArray(reviews) || !matchedInstructor) return [];
	
	const first = (matchedInstructor.firstName || '').toLowerCase().trim();
	const last = (matchedInstructor.lastName || '').toLowerCase().trim();
	
	if (!last) return [];
	
	const filtered = [];
	const teachingTerms = ['prof', 'professor', 'instructor', 'lecture', 'class', 'midterm', 'final', 'homework', 'assignment', 'exam', 'grade', 'quiz', 'teach'];
	
	for (const review of reviews) {
		const text = String(review || '').toLowerCase();
		
		// Use word boundaries to avoid false matches like "ang" in "change"
		const lastRegex = new RegExp(`\\b${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
		const firstRegex = first ? new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') : null;
		
		// Primary: Last name found
		if (lastRegex.test(text)) {
			// Additional boost if first name or common professor titles appear
			if ((first && text.includes(first)) || 
				text.includes(`prof ${last}`) || 
				text.includes(`professor ${last}`) || 
				text.includes(`dr ${last}`)) {
				filtered.push(review);
			} else {
				filtered.push(review);
			}
		}
		// Secondary: First name found with teaching context (conservative expansion)
		else if (firstRegex && firstRegex.test(text)) {
			const hasContext = teachingTerms.some(t => text.includes(t));
			if (hasContext) {
				filtered.push(review);
			}
		}
	}
	
	return filtered;
}

const PERSONA_TRAITS = [
	{
		key: 'supportive',
		label: 'Supportive prof',
		tone: 'positive',
		includes: ['supportive', 'cares about', 'very helpful', 'super helpful', 'approachable', 'responsive', 'wants you to succeed', 'goes above and beyond', 'office hours'],
		excludes: ['unsupportive', 'not supportive']
	},
	{
		key: 'lenient',
		label: 'Easy grading',
		tone: 'positive',
		includes: ['easy a', 'easy grader', 'lenient', 'generous with grades', 'grade lightly', 'gives extra credit', 'fair grader', 'grades easy'],
		excludes: ['not an easy a']
	},
	{
		key: 'workload',
		label: 'Heavy workload',
		tone: 'caution',
		includes: ['heavy workload', 'ton of homework', 'tons of homework', 'lot of homework', 'lots of homework', 'assignments every week', 'weekly homework', 'hours of work', 'time consuming', 'problem sets', 'loads of work']
	},
	{
		key: 'engaging',
		label: 'Engaging lectures',
		tone: 'positive',
		includes: ['engaging', 'interesting lectures', 'fun class', 'great lecturer', 'keeps you engaged', 'passionate', 'energetic'],
		excludes: ['not engaging']
	},
	{
		key: 'organized',
		label: 'Well organized',
		tone: 'positive',
		includes: ['organized', 'well organized', 'structured', 'clear expectations', 'clear structure', 'organized class'],
		excludes: ['disorganized', 'unorganized', 'not organized']
	},
	{
		key: 'tough',
		label: 'Tough grading',
		tone: 'caution',
		includes: ['tough grader', 'harsh grader', 'strict grading', 'strict grader', 'grades tough', 'grades hard', 'grading harsh', 'hard grader']
	},
	{
		key: 'discussion',
		label: 'Discussion heavy',
		tone: 'neutral',
		includes: ['discussion based', 'discussion heavy', 'class discussions', 'participation required', 'seminar style', 'conversation based', 'group discussion']
	}
];

const VIBE_THEMES = [
	{ key: 'projects', descriptor: 'project-heavy', keywords: ['project based', 'project-heavy', 'group project', 'projects', 'final project', 'presentations', 'capstone'] },
	{ key: 'writing', descriptor: 'writing-heavy', keywords: ['essay', 'essays', 'paper', 'papers', 'writing intensive', 'drafts', 'write a lot'] },
	{ key: 'reading', descriptor: 'reading-intensive', keywords: ['lots of reading', 'heavy reading', 'tons of reading', 'readings every', 'weekly readings', 'chapters', 'articles'] },
	{ key: 'discussion', descriptor: 'discussion-driven', keywords: ['discussion', 'seminar', 'participation', 'debate', 'conversation'] },
	{ key: 'collaboration', descriptor: 'collaborative', keywords: ['group work', 'team based', 'collaborate', 'partner up', 'study group'] },
	{ key: 'practical', descriptor: 'hands-on', keywords: ['hands on', 'lab', 'laboratory', 'experiment', 'practical', 'field work'] }
];

const EFFORT_KEYWORDS = {
	heavy: ['heavy workload', 'ton of homework', 'tons of homework', 'lot of homework', 'lots of homework', 'assignments every week', 'weekly homework', 'weekly quizzes', 'problem sets', 'time consuming', 'hours of work', 'study a lot', 'grind', 'intense workload'],
	light: ['light workload', 'not much work', 'minimal work', 'no homework', 'not a lot of homework', 'manageable workload', 'pretty easy', 'not too bad', 'low effort', 'barely any work', 'chill workload']
};

const PACE_KEYWORDS = {
	fast: ['fast pace', 'fast-paced', 'fast paced', 'moves fast', 'very fast', 'super fast', 'rushed', 'rush through', 'speed through', 'cover a lot', 'dense', 'cram'],
	slow: ['slow pace', 'slow-paced', 'slow paced', 'relaxed pace', 'takes time', 'take it slow', 'laid back', 'slowly', 'not rushed']
};

const ASSESSMENT_KEYWORDS = {
	heavy: ['many exams', 'lots of exams', 'tons of exams', 'midterms', 'midterm', 'final exam', 'quizzes every', 'weekly quizzes', 'pop quizzes', 'test every', 'graded strictly', 'curve is tough', 'exams are hard'],
	light: ['no exams', 'no midterm', 'no final', 'open book', 'open-note', 'take home', 'take-home', 'project instead of exam', 'few exams', 'final optional', 'pass/no pass', 'pass no pass', 'grading lenient']
};

const SIGNAL_INSIGHTS = [
	{
		key: 'attendance',
		label: 'Attendance graded',
		icon: '🗓️',
		tone: 'caution',
		detail: 'Reviews mention that attendance is tracked or required.',
		includes: ['attendance is mandatory', 'attendance mandatory', 'attendance required', 'takes attendance', 'taking attendance', 'attendance points', 'attendance grade', 'sign in sheet', 'roll every class', 'attendance is graded'],
		excludes: ['attendance not mandatory', 'attendance optional', 'attendance not required']
	},
	{
		key: 'extraCredit',
		label: 'Extra credit offered',
		icon: '✨',
		tone: 'positive',
		detail: 'Students mention extra credit or dropped scores.',
		includes: ['extra credit', 'extra-credit', 'offers extra credit', 'gave extra credit', 'gives extra credit', 'lots of extra credit', 'drop your lowest', 'drops your lowest', 'drops lowest quiz', 'drops lowest assignment', 'bonus points'],
		excludes: ['no extra credit', 'without extra credit']
	},
	{
		key: 'flexibility',
		label: 'Flexible deadlines',
		icon: '🕒',
		tone: 'positive',
		detail: 'Reviews report deadline extensions or lenient late work policies.',
		includes: ['gives extensions', 'offers extensions', 'deadline extensions', 'flexible with deadlines', 'lenient with deadlines', 'late work accepted', 'turn in late', 'extensions available', 'extension on assignments', 'deadline flexibility'],
		excludes: ['no extensions', 'does not give extensions', 'doesn\'t give extensions']
	},
	{
		key: 'strictDeadlines',
		label: 'Zero late work',
		icon: '🚫📅',
		tone: 'caution',
		detail: 'Reviews warn about strict or no-late-work policies.',
		includes: ['no late work', 'does not accept late work', 'zero late work', 'no make up work', 'no makeups', 'strict deadlines', 'deadline is firm', 'no extensions', 'no late assignments'],
		excludes: ['late work accepted', 'if you turn in late']
	}
];

function derivePersonaInsights(courseData, record) {
	const reviews = gatherNormalizedReviews(courseData, record);
	if (!reviews.length) return null;

	const traitChips = computeTraitChips(reviews);
	const vibeSummary = computeVibeSummary(reviews);
	const effort = computeEffortInsight(reviews);
	const pace = computePaceInsight(reviews);
	const assessment = computeAssessmentInsight(reviews);
	const signals = computeSignalIcons(reviews);

	if (
		(!traitChips || traitChips.length === 0) &&
		!vibeSummary &&
		!effort &&
		!pace &&
		!assessment &&
		(!signals || signals.length === 0)
	) {
		return null;
	}

	return { traitChips, vibeSummary, effort, pace, assessment, signals };
}

function gatherNormalizedReviews(courseData, record) {
	const set = new Set();
	if (courseData && Array.isArray(courseData.recentReviews)) {
		for (const review of courseData.recentReviews) {
			if (!review) continue;
			const cleaned = String(review).trim();
			if (cleaned) set.add(cleaned.toLowerCase());
		}
	}
	if (record && Array.isArray(record.reviewSamples)) {
		for (const review of record.reviewSamples) {
			if (!review) continue;
			const cleaned = String(review).trim();
			if (cleaned) set.add(cleaned.toLowerCase());
		}
	}
	return Array.from(set);
}

function matchesTrait(review, trait) {
	if (trait.excludes && trait.excludes.some(ex => review.includes(ex))) {
		return false;
	}
	if (trait.includes && trait.includes.some(inc => review.includes(inc))) {
		return true;
	}
	if (trait.patterns && trait.patterns.some(pattern => pattern.test(review))) {
		return true;
	}
	return false;
}

function computeTraitChips(reviews) {
	const reviewCount = reviews.length;
	const scored = [];
	for (const trait of PERSONA_TRAITS) {
		let hits = 0;
		for (const review of reviews) {
			if (matchesTrait(review, trait)) hits++;
		}
		if (hits > 0) {
			scored.push({ trait, hits });
		}
	}
	if (!scored.length) return [];
	scored.sort((a, b) => b.hits - a.hits);
	const threshold = reviewCount >= 4 ? 2 : 1;
	const chips = [];
	for (const item of scored) {
		if (chips.length >= 3) break;
		if (item.hits >= threshold || chips.length === 0) {
			chips.push({ label: item.trait.label, tone: item.trait.tone });
		}
	}
	return chips;
}

function countKeywordGroup(reviews, keywords, perReviewLimit = 1) {
	if (!keywords || !keywords.length) return 0;
	let total = 0;
	const limit = Number.isFinite(perReviewLimit) && perReviewLimit > 0 ? perReviewLimit : null;
	for (const review of reviews) {
		let hits = 0;
		for (const keyword of keywords) {
			if (review.includes(keyword)) {
				hits++;
				if (limit && hits >= limit) break;
			}
		}
		total += limit ? Math.min(hits, limit) : hits;
	}
	return total;
}

function computeVibeSummary(reviews) {
	const scored = [];
	for (const theme of VIBE_THEMES) {
		const hits = countKeywordGroup(reviews, theme.keywords, 2);
		if (hits > 0) {
			scored.push({ theme, hits });
		}
	}
	if (!scored.length) return null;
	scored.sort((a, b) => b.hits - a.hits);
	const threshold = reviews.length >= 4 ? 2 : 1;
	const descriptors = [];
	for (const item of scored) {
		if (descriptors.length >= 2) break;
		if (item.hits >= threshold || descriptors.length === 0) {
			descriptors.push(item.theme.descriptor);
		}
	}
	if (!descriptors.length) return null;
	if (descriptors.length === 1) {
		return `${capitalize(descriptors[0])} vibe.`;
	}
	return `${capitalize(descriptors[0])} and ${descriptors[1]} vibe.`;
}
function computeEffortInsight(reviews) {
	const heavy = countKeywordGroup(reviews, EFFORT_KEYWORDS.heavy, 2);
	const light = countKeywordGroup(reviews, EFFORT_KEYWORDS.light, 2);
	const total = heavy + light;
	if (total === 0) return null;
	const score = clamp01(heavy / total);
	let label;
	if (score <= 0.33) label = 'Light effort';
	else if (score <= 0.66) label = 'Moderate effort';
	else label = 'Intense effort';
	return { score, label, detail: `Heavy signals: ${heavy}, Light signals: ${light}` };
}

function computePaceInsight(reviews) {
	const fast = countKeywordGroup(reviews, PACE_KEYWORDS.fast, 2);
	const slow = countKeywordGroup(reviews, PACE_KEYWORDS.slow, 2);
	const total = fast + slow;
	if (total === 0) return null;
	const score = clamp01(fast / total);
	let label;
	let shortLabel;
	let icon;
	if (score <= 0.33) {
		label = 'Laid-back pace';
		shortLabel = 'Chill';
		icon = '🌿';
	} else if (score <= 0.66) {
		label = 'Balanced pace';
		shortLabel = 'Balanced';
		icon = '⚖️';
	} else {
		label = 'Rapid pace';
		shortLabel = 'Fast';
		icon = '⚡️';
	}
	return { score, label, shortLabel, icon, detail: `Fast cues: ${fast}, Slow cues: ${slow}` };
}

function computeAssessmentInsight(reviews) {
	const heavy = countKeywordGroup(reviews, ASSESSMENT_KEYWORDS.heavy, 2);
	const light = countKeywordGroup(reviews, ASSESSMENT_KEYWORDS.light, 2);
	const total = heavy + light;
	if (total === 0) return null;
	const score = clamp01(heavy / total);
	let label;
	if (score <= 0.33) label = 'Light assessments';
	else if (score <= 0.66) label = 'Mixed assessments';
	else label = 'Exam-heavy';
	let shortLabel;
	let icon;
	switch (label) {
		case 'Light assessments':
			shortLabel = 'Light';
			icon = '📗';
			break;
		case 'Mixed assessments':
			shortLabel = 'Mixed';
			icon = '📝';
			break;
		default:
			shortLabel = 'Exam';
			icon = '📚';
	}
	return { score, label, shortLabel, icon, detail: `Heavy cues: ${heavy}, Light cues: ${light}` };
}

function matchesSignal(review, signal) {
	if (!review || !signal) return false;
	if (signal.excludes && signal.excludes.some(ex => review.includes(ex))) {
		return false;
	}
	if (signal.includes && signal.includes.some(inc => review.includes(inc))) {
		return true;
	}
	if (signal.patterns && signal.patterns.some(pattern => pattern.test(review))) {
		return true;
	}
	return false;
}

function computeSignalIcons(reviews) {
	if (!Array.isArray(reviews) || !reviews.length) return [];
	const scored = [];
	for (const signal of SIGNAL_INSIGHTS) {
		let hits = 0;
		for (const review of reviews) {
			if (matchesSignal(review, signal)) hits++;
		}
		if (hits > 0) {
			scored.push({ signal, hits });
		}
	}
	if (!scored.length) return [];
	scored.sort((a, b) => b.hits - a.hits);
	const maxSignals = 3;
	const result = [];
	for (const item of scored) {
		if (result.length >= maxSignals) break;
		const minHits = item.signal.minHits || 1;
		if (item.hits >= minHits || result.length === 0) {
			result.push({
				key: item.signal.key,
				label: item.signal.label,
				tone: item.signal.tone,
				icon: item.signal.icon,
				detail: item.signal.detail
			});
		}
	}
	return result;
}

function buildPersonaRail(insights) {
	if (!insights) return null;
	const rail = document.createElement('aside');
	rail.className = 'rmg-card-rail';
	let contentBlocks = 0;

	if (Array.isArray(insights.traitChips) && insights.traitChips.length) {
		const title = document.createElement('div');
		title.className = 'rmg-rail-section-title';
		title.textContent = 'Noticed in reviews';
		rail.appendChild(title);

		const chips = document.createElement('div');
		chips.className = 'rmg-rail-chips';
		for (const chip of insights.traitChips) {
			const chipEl = document.createElement('span');
			chipEl.className = 'rmg-rail-chip';
			if (chip.tone) chipEl.classList.add(`rmg-rail-chip--${chip.tone}`);
			chipEl.textContent = chip.label;
			chips.appendChild(chipEl);
		}
		rail.appendChild(chips);
		contentBlocks++;
	}

	if (insights.vibeSummary) {
		const vibe = document.createElement('div');
		vibe.className = 'rmg-rail-vibe';
		vibe.textContent = insights.vibeSummary;
		rail.appendChild(vibe);
		contentBlocks++;
	}

	if (insights.effort) {
		const effort = document.createElement('div');
		effort.className = 'rmg-rail-effort';
		const effortTitle = document.createElement('div');
		effortTitle.className = 'rmg-rail-section-title';
		effortTitle.textContent = 'Effort';
		effort.appendChild(effortTitle);

		const bar = document.createElement('div');
		bar.className = 'rmg-rail-effort-bar';
		const fill = document.createElement('span');
		fill.style.setProperty('--effort-fill', `${Math.round(clamp01(insights.effort.score) * 100)}%`);
		if (insights.effort.detail) fill.title = insights.effort.detail;
		bar.appendChild(fill);
		effort.appendChild(bar);

		const label = document.createElement('div');
		label.className = 'rmg-rail-effort-label';
		label.textContent = insights.effort.label;
		effort.appendChild(label);

		rail.appendChild(effort);
		contentBlocks++;
	}

	if (Array.isArray(insights.signals) && insights.signals.length) {
		const signalsWrapper = document.createElement('div');
		signalsWrapper.className = 'rmg-rail-signals';
		const signalsTitle = document.createElement('div');
		signalsTitle.className = 'rmg-rail-section-title';
		signalsTitle.textContent = 'Signals';
		signalsWrapper.appendChild(signalsTitle);

		const signalsList = document.createElement('div');
		signalsList.className = 'rmg-rail-signal-list';
		for (const signal of insights.signals) {
			const signalEl = document.createElement('div');
			signalEl.className = 'rmg-rail-signal';
			if (signal.tone) signalEl.classList.add(`rmg-rail-signal--${signal.tone}`);
			if (signal.detail) signalEl.title = signal.detail;

			const icon = document.createElement('span');
			icon.className = 'rmg-rail-signal-icon';
			icon.textContent = signal.icon || '•';
			signalEl.appendChild(icon);

			const label = document.createElement('span');
			label.className = 'rmg-rail-signal-label';
			label.textContent = signal.label;
			signalEl.appendChild(label);

			signalsList.appendChild(signalEl);
		}
		signalsWrapper.appendChild(signalsList);
		rail.appendChild(signalsWrapper);
		contentBlocks++;
	}

	const dialCandidates = [];
	if (insights.pace) dialCandidates.push({ key: 'Pace', ...insights.pace });
	if (insights.assessment) dialCandidates.push({ key: 'Assessments', ...insights.assessment });
	if (dialCandidates.length) {
		const dials = document.createElement('div');
		dials.className = 'rmg-rail-dials';
		for (const dialInfo of dialCandidates) {
			const dial = document.createElement('div');
			dial.className = 'rmg-rail-dial';

			const heading = document.createElement('div');
			heading.className = 'rmg-rail-dial-label';
			heading.textContent = dialInfo.key;
			dial.appendChild(heading);

			const ring = document.createElement('div');
			ring.className = 'rmg-rail-dial-ring';
			ring.style.setProperty('--dial-progress', `${Math.round(clamp01(dialInfo.score) * 100)}%`);
			if (dialInfo.detail) ring.title = dialInfo.detail;

			const emblem = document.createElement('span');
			emblem.className = 'rmg-rail-dial-emblem';
			emblem.textContent = dialInfo.icon || dialInfo.shortLabel || dialInfo.label;
			ring.appendChild(emblem);

			dial.appendChild(ring);

			const description = document.createElement('div');
			description.className = 'rmg-rail-dial-desc';
			description.textContent = dialInfo.label;
			dial.appendChild(description);

			dials.appendChild(dial);
		}
		rail.appendChild(dials);
		contentBlocks++;
	}

	if (!contentBlocks) return null;
	return rail;
}

function clamp01(value) {
	return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function capitalize(text) {
	if (!text) return '';
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function pickCourseDataForInstructor(courseRecords, matchedInstructor) {
	if (!Array.isArray(courseRecords) || courseRecords.length === 0) return null;
	if (!matchedInstructor) return courseRecords[0];

	const first = (matchedInstructor.firstName || '').toLowerCase().trim();
	const last = (matchedInstructor.lastName || '').toLowerCase().trim();
	const firstInitial = first ? first[0] : '';

	let bestRecord = courseRecords[0];
	let bestScore = 0;
	let bestFiltered = [];

	for (const rec of courseRecords) {
		// First, try to filter reviews by instructor
		const filtered = filterReviewsByInstructor(rec.recentReviews, matchedInstructor);
		
		// Score based on filtered reviews (high weight) + general name mentions (lower weight)
		let score = filtered.length * 10; // High weight for instructor-specific reviews
		
		// Add general scoring for fallback
		const texts = Array.isArray(rec.recentReviews) ? rec.recentReviews : [];
		for (const t of texts) {
			const txt = String(t || '').toLowerCase();
			if (last && txt.includes(last)) score += 3;
			if (first && txt.includes(first)) score += 2;
			if (firstInitial && txt.includes(`${firstInitial}.`)) score += 1;
		}

		if (score > bestScore) {
			bestRecord = rec;
			bestScore = score;
			bestFiltered = filtered;
		}
	}

	// Return a copy of the record with filtered reviews if any were found
	const result = { ...bestRecord };
	if (bestFiltered.length > 0) {
		result.recentReviews = bestFiltered;
		result._reviewsFiltered = true;
	} else {
		result._reviewsFiltered = false;
	}

	return result;
}

function buildLookup(records) {
	const map = new Map();
	for (const rec of records) {
		// Create keys with department
		const deptKey = makeKey(rec.lastName, rec.firstName, rec.department);
		(map.get(deptKey) || map.set(deptKey, []).get(deptKey)).push(rec);
		
		// Create keys without department
		const anyKey = makeKey(rec.lastName, rec.firstName, '');
		(map.get(anyKey) || map.set(anyKey, []).get(anyKey)).push(rec);
		
		// Create keys with just last name (for flexible matching)
		const lastNameKey = makeKey(rec.lastName, '', '');
		(map.get(lastNameKey) || map.set(lastNameKey, []).get(lastNameKey)).push(rec);
		
		// Create keys with last name and first initial
		const initialKey = makeKey(rec.lastName, rec.firstName.charAt(0), '');
		(map.get(initialKey) || map.set(initialKey, []).get(initialKey)).push(rec);
	}
	return map;
}

function normalizeName(s = '') {
	return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function normalizePlain(s = '') {
	return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function csvProfessorMatches(courseData, matchedInstructor) {
	if (!courseData || !matchedInstructor) return false;
	const prof = normalizePlain(courseData.csvProfessor || '');
	const first = normalizePlain(matchedInstructor.firstName || '');
	const last = normalizePlain(matchedInstructor.lastName || '');
	if (!prof || !last) return false;

	// Accept when CSV professor includes last name, or full name
	if (prof.includes(last)) return true;
	if (first && prof.includes(`${first} ${last}`)) return true;
	return false;
}

function makeKey(last, first, dept) {
	const ln = normalizeName(last);
	const fi = first ? normalizeName(first).slice(0, 1) : '';
	const dp = (dept || '').toLowerCase();
	return `${ln}|${fi}|${dp}`;
}

function observeAndRender() {
	const observer = new MutationObserver(() => scheduleScan());
	observer.observe(document, { childList: true, subtree: true });
	scheduleScan();

	async function scheduleScan() {
		if (typeof requestAnimationFrame === 'function') requestAnimationFrame(async () => { await scan(); });
		else setTimeout(async () => { await scan(); }, 50);
	}

	async function scan() {
		const nodes = findInstructorNodes();
		console.log('[RateMyGaucho] instructor candidates:', nodes.length);
		if (!nodes.length) return;
		const unifiedData = await ensureUnifiedData();
		const lookup = unifiedData?.ratingsLookup;
		const courseLookup = unifiedData?.courseLookup;
		const departmentAverages = unifiedData?.departmentAverages;
		if (!lookup) return;
		const sample = nodes.slice(0, 5).map(n => (n.textContent||'').trim().replace(/\s+/g,' '));
		console.log('[RateMyGaucho] sample candidate texts:', sample);
		
		let matchedCount = 0;
		let courseFoundCount = 0;
		let totalProcessed = 0;
		
		for (const node of nodes) {
			if (node.dataset.rmgInitialized === '1') continue;
			node.dataset.rmgInitialized = '1';
			totalProcessed++;
			
			const info = extractInstructorInfo(node);
			console.log('[RateMyGaucho] Processing:', info.raw, '-> names:', info.names);
			
			// Debug: show what keys are being generated
			for (const name of info.names) {
				const keys = candidateKeysForName(name, '');
				console.log('[RateMyGaucho] Keys for', name, ':', keys.slice(0, 5)); // Show first 5 keys
			}
			
			const match = matchInstructor(info, lookup);
			const courseCode = extractCourseCode(node);
			const normalizedCourse = courseCode ? normalizeCourseCode(courseCode) : null;
			const courseList = (normalizedCourse && courseLookup) ? courseLookup.get(normalizedCourse) : null;
			const courseData = Array.isArray(courseList) ? pickCourseDataForInstructor(courseList, match) : null;
			
			if (courseCode) {
				console.log('[RateMyGaucho] Extracted course code:', courseCode, 'normalized:', normalizedCourse);
			}
			
			if (!match) {
				console.log('[RateMyGaucho] NO MATCH for:', info.raw);
				continue;
			}
			
			matchedCount++;
			console.log('[RateMyGaucho] MATCHED:', info.raw, '->', match.firstName, match.lastName, match.rmpScore);
			
			if (!normalizedCourse || !Array.isArray(courseList) || courseList.length === 0) {
				console.log('[RateMyGaucho] Skipping card - course not present in dataset:', normalizedCourse);
				continue;
			}
			
			if (!courseData) {
				console.log('[RateMyGaucho] Skipping card - no course data selected for instructor:', normalizedCourse);
				continue;
			}
			
			const filterStatus = courseData._reviewsFiltered ? '(filtered)' : '(fallback)';
			console.log('[RateMyGaucho] Course data chosen for instructor:',
				`${match.firstName} ${match.lastName}`, '->', courseData.courseName,
				'filteredReviews:', Array.isArray(courseData.recentReviews) ? courseData.recentReviews.length : 0, filterStatus);
			
			// Gate course data: show when reviews mention instructor OR CSV verification confirms match
			const verifiedByCsvProfessor = csvProfessorMatches(courseData, match);
			const verifiedByFlag = typeof courseData?.reviewVerification === 'string'
				&& courseData.reviewVerification.toUpperCase().includes('MATCH');
			
			const hasInstructorSpecificReviews = (
				courseData && courseData._reviewsFiltered
				&& Array.isArray(courseData.recentReviews)
				&& courseData.recentReviews.length > 0
			);
			
			const gatedCourseData = (courseData && (hasInstructorSpecificReviews || verifiedByCsvProfessor || verifiedByFlag))
				? courseData
				: null;
			
			if (!gatedCourseData) {
				console.log('[RateMyGaucho] SKIPPED course data for',
					`${match.firstName} ${match.lastName}`,
					'- gating conditions not met',
					{ hasInstructorSpecificReviews, verifiedByCsvProfessor, reviewVerification: courseData?.reviewVerification });
				continue;
			}
			
			courseFoundCount++;
			renderCard(node, match, gatedCourseData, departmentAverages);
		}
		
		console.log(`[RateMyGaucho] Summary: ${matchedCount}/${totalProcessed} instructors matched, ${courseFoundCount}/${matchedCount} with course data`);
	}
}

function findInstructorNodes() {
	const set = new Set();
	// 1) Table header-based detection: find the "Instructor" column and grab its cells
	try {
		for (const table of document.querySelectorAll('table')) {
			const headerCells = Array.from(table.querySelectorAll('thead th, tr th'));
			let idx = -1;
			for (let i = 0; i < headerCells.length; i++) {
				const t = (headerCells[i].textContent || '').trim().toLowerCase();
				if (t.includes('instructor')) { idx = i; break; }
			}
			if (idx >= 0) {
				for (const row of table.querySelectorAll('tbody tr, tr')) {
					const cells = row.querySelectorAll('td,th');
					if (cells && cells.length > idx) set.add(cells[idx]);
				}
			}
		}
	} catch {}

	// 2) Attribute- and class-based selectors
	const selectors = [
		'[headers*="Instructor" i]',
		'td[aria-label*="Instructor" i]',
		"td:has(> span[title*='Instructor' i])",
		'.instructor, .professor, .instructorName'
	];
	for (const sel of selectors) { for (const el of document.querySelectorAll(sel)) set.add(el); }

	// 2.5) Label-based detection: rows/cols where a label contains "Instructor"; use the nearest text span
	try {
		for (const label of document.querySelectorAll('label')) {
			const lt = (label.textContent || '').trim().toLowerCase();
			if (!lt || !lt.includes('instructor')) continue;
			const container = label.parentElement || label.closest('div');
			if (!container) continue;
			const candidate = container.querySelector('span, div');
			if (candidate) set.add(candidate);
		}
	} catch {}

	// 3) Heuristic: rows that contain an "Add" button/link likely belong to course result rows
	const addButtons = Array.from(document.querySelectorAll('a,button,input'))
		.filter(el => /add/i.test((el.textContent || el.value || '').trim()));
	for (const btn of addButtons) {
		const row = btn.closest('tr, .row, .resultsRow, .SSR_CLSRSLT_WRK, .sectionRow, .CourseRow') || btn.parentElement;
		if (!row) continue;
		let best = null, bestScore = 0;
		for (const cell of row.querySelectorAll('td,div,span')) {
			const txt = (cell.textContent || '').trim().replace(/\s+/g, ' ');
			if (!txt) continue;
			const s = nameScore(txt);
			if (s > bestScore) { best = cell; bestScore = s; }
		}
		if (best && bestScore >= 2) set.add(best);
	}

	// 4) Fallback: scan all cells for name-like text but only keep those inside rows that also have an Add control
	try {
		for (const cell of document.querySelectorAll('td, span, div')) {
			const txt = (cell.textContent || '').trim().replace(/\s+/g, ' ');
			if (!txt) continue;
			const score = nameScore(txt);
			if (score >= 3) { // Lowered threshold from 4 to 3
				const row = cell.closest && cell.closest('tr, .row, .resultsRow, .SSR_CLSRSLT_WRK, .sectionRow, .CourseRow');
				if (!row) continue;
				const hasAdd = !!Array.from(row.querySelectorAll('a,button,input')).find(el => /add/i.test((el.textContent || el.value || '').trim()));
				if (hasAdd) set.add(cell);
			}
		}
	} catch {}

	// 5) Additional detection: Look for cells that contain common instructor name patterns
	try {
		for (const cell of document.querySelectorAll('td, span, div')) {
			const txt = (cell.textContent || '').trim().replace(/\s+/g, ' ');
			if (!txt) continue;
			
			// Look for patterns like "LAST F", "LAST F M", "FIRST LAST", etc.
			if (/^[A-Z][A-Z'\-]+\s+[A-Z](?:\s+[A-Z])?$/.test(txt) || // LAST F or LAST F M
				/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(txt) || // First Last
				/^[A-Z][A-Z'\-]+,\s*[A-Z]/.test(txt)) { // LAST, F
				
				const row = cell.closest && cell.closest('tr, .row, .resultsRow, .SSR_CLSRSLT_WRK, .sectionRow, .CourseRow');
				if (row) {
					// Check if this row has course-related elements
					const hasCourseElements = !!Array.from(row.querySelectorAll('a,button,input')).find(el => 
						/(add|course|info|final|save|cart)/i.test((el.textContent || el.value || '').trim())
					);
					if (hasCourseElements) set.add(cell);
				}
			}
		}
	} catch {}

	return Array.from(set);
}

function nameScore(txt) {
	const clean = txt.trim().replace(/\s+/g, ' ');
	if (!clean) return 0;
	// Immediately reject obvious non-name cells
	if (/(Space|Max|Units|Building|Hall|Room|Course|Info|Final|Save|Cart|Closed|Open|Time|Days|Section)/i.test(clean)) return 0;
	if (/\d{2,}/.test(clean)) return 0;
	const words = clean.split(' ').filter(Boolean);
	let score = 0;
	
	// "Last, First" pattern
	if (/,\s*[A-Za-z]/.test(clean)) score += 3;
	
	// "First Last" (require at least two words)
	if (words.length >= 2 && /^[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,3}$/.test(clean)) score += 3;
	
	// "LAST I N" pattern (all caps last + initials)
	if (/^[A-Z][A-Z'\-]+(?:\s+[A-Z](?:\.|\b)){1,3}$/.test(clean)) score += 3;
	
	// "LAST F" pattern (all caps last + single initial)
	if (/^[A-Z][A-Z'\-]+\s+[A-Z]$/.test(clean)) score += 2;
	
	// Mixed case patterns like "Last F" or "First Last"
	if (/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(clean)) score += 2;
	if (/^[A-Z][A-Z'\-]+\s+[A-Z][a-z]+$/.test(clean)) score += 2;
	
	// Bonus for presence of initials tokens
	if (words.some(w => w.length === 1 || /\.$/.test(w))) score += 1;
	
	// Reasonable length
	if (clean.length <= 40) score += 1;
	
	// Bonus for common name patterns
	if (/^[A-Z][a-z]+\s+[A-Z]\.?\s*[A-Z][a-z]+$/.test(clean)) score += 1; // First M. Last
	
	return score;
}

function extractInstructorInfo(node) {
	const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
	// Split on various separators that might separate multiple instructor names
	const names = text.split(/;|\u00a0|\/|,\s*(?=[A-Z])|\sand\s|&/i).map(s => s.trim()).filter(Boolean);
	return { raw: text, names };
}

function candidateKeysForName(name, dept) {
	const clean = name.replace(/\(.*?\)/g, '').replace(/[^A-Za-z,\s.-]/g, ' ').replace(/\s+/g, ' ').trim();
	const keys = [];
	if (!clean) return keys;
	
	// Pattern: LAST I N (all caps last name followed by 1-3 initials)
	const caps = clean.match(/^([A-Z][A-Z'\-]+)(?:\s+([A-Z]))(?:\s+[A-Z](?:\.|\b)){0,2}$/);
	if (caps) {
		const last = caps[1];
		const firstInitial = (caps[2] || '').slice(0,1);
		keys.push(makeKey(last, firstInitial, dept));
		keys.push(makeKey(last, firstInitial, ''));
		
		// For LAST F format, also try matching with any first name that starts with F
		// This helps match "CHILDRESS A" with "James,Childress" in CSV
		keys.push(makeKey(last, '', dept)); // Try with empty first name
		keys.push(makeKey(last, '', ''));
	}
	
	// Pattern: LAST, FIRST (comma-separated)
	if (clean.includes(',')) {
		const [last, rest] = clean.split(',').map(s => s.trim());
		const first = (rest || '').split(' ')[0] || '';
		keys.push(makeKey(last, first, dept));
		keys.push(makeKey(last, first, ''));
	}
	
	const parts = clean.split(' ').filter(Boolean);
	if (parts.length >= 2) {
		// Treat as "First ... Last"
		keys.push(makeKey(parts[parts.length - 1], parts[0], dept));
		keys.push(makeKey(parts[parts.length - 1], parts[0], ''));
		
		// Treat as "Last First [Middle...]"
		keys.push(makeKey(parts[0], parts[1], dept));
		keys.push(makeKey(parts[0], parts[1], ''));
		
		// Try all possible combinations for 2-3 word names
		if (parts.length === 2) {
			// For 2 words, try both orders
			keys.push(makeKey(parts[1], parts[0], dept));
			keys.push(makeKey(parts[1], parts[0], ''));
		} else if (parts.length === 3) {
			// For 3 words, try multiple combinations
			keys.push(makeKey(parts[2], parts[0], dept)); // Last First Middle
			keys.push(makeKey(parts[2], parts[0], ''));
			keys.push(makeKey(parts[0], parts[1], dept)); // First Middle Last
			keys.push(makeKey(parts[0], parts[1], ''));
		}
	}
	
	// Add fuzzy matching for common name variations
	for (const key of Array.from(keys)) {
		const [last, first, deptPart] = key.split('|');
		// Try with just first initial
		if (first.length > 1) {
			keys.push(`${last}|${first[0]}|${deptPart}`);
		}
		// Try with just last name (for very common names)
		if (last.length > 3) {
			keys.push(`${last}||${deptPart}`);
		}
	}
	
	return Array.from(new Set(keys));
}

function matchInstructor(info, lookup) {
	let best = null, bestScore = -1;
	for (const name of info.names) {
		for (const key of candidateKeysForName(name, '')) {
			const list = lookup.get(key);
			if (list && list.length) {
				const top = list.slice().sort((a,b)=>b.numReviews-a.numReviews)[0];
				if (top.numReviews > bestScore) { best = top; bestScore = top.numReviews; }
			}
		}
	}
	return best;
}

function renderCard(anchorNode, record, courseData = null, departmentAverages = null) {
	const card = document.createElement('div');
	const rating = Number(record.rmpScore || 0);
	card.className = 'rmg-card ' + (rating >= 4 ? 'rmg-good' : rating >= 3 ? 'rmg-ok' : 'rmg-bad');

	const formatPercent = (value) => {
		if (!Number.isFinite(value)) return '';
		const decimals = Math.abs(value - Math.round(value)) < 0.1 ? 0 : 1;
		return `${value.toFixed(decimals)}%`;
	};

	const insights = derivePersonaInsights(courseData, record);
	const rail = buildPersonaRail(insights);
	if (rail) {
		card.appendChild(rail);
	} else {
		card.classList.add('rmg-card--no-rail');
	}

	const main = document.createElement('div');
	main.className = 'rmg-card-main';
	card.appendChild(main);

	const badge = document.createElement('span');
	badge.className = 'rmg-badge';
	badge.textContent = rating.toFixed(1);
	badge.classList.add(
		rating >= 4 ? 'rmg-badge--good' : rating >= 3 ? 'rmg-badge--ok' : 'rmg-badge--bad'
	);

	const sub = document.createElement('span');
	sub.className = 'rmg-subtle';
	const reviewLabel = record.numReviews === 1 ? 'review' : 'reviews';
	sub.textContent = record.numReviews ? `${record.numReviews} course ${reviewLabel}` : 'No course reviews yet';

	const stars = document.createElement('div');
	stars.className = 'rmg-stars';
	for (let i = 0; i < 5; i++) {
		const starContainer = document.createElement('div');
		starContainer.className = 'rmg-star-container';

		const emptyStar = document.createElement('img');
		emptyStar.src = chrome.runtime.getURL('gaucho.png');
		emptyStar.className = 'rmg-star rmg-star--empty';
		emptyStar.alt = '★';

		const filledStar = document.createElement('img');
		filledStar.src = chrome.runtime.getURL('gaucho.png');
		filledStar.className = 'rmg-star rmg-star--filled';
		filledStar.alt = '★';

		const starValue = i + 1;
		let fillPercentage = 0;
		if (rating >= starValue) {
			fillPercentage = 100;
		} else if (rating > starValue - 1) {
			const partialRating = rating - (starValue - 1);
			fillPercentage = Math.max(0, Math.min(100, partialRating * 100));
		}

		starContainer.style.setProperty('--fill-percentage', `${fillPercentage}%`);
		starContainer.appendChild(emptyStar);
		starContainer.appendChild(filledStar);
		stars.appendChild(starContainer);
	}

	const header = document.createElement('div');
	header.className = 'rmg-card-header';

	const ratingGroup = document.createElement('div');
	ratingGroup.className = 'rmg-card-rating';
	ratingGroup.appendChild(badge);
	ratingGroup.appendChild(stars);
	header.appendChild(ratingGroup);

	const actions = document.createElement('div');
	actions.className = 'rmg-card-actions';

	const link = document.createElement('a');
	link.className = 'rmg-link';
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	const fallbackCourseUrl = courseData?.courseUrl
		|| (Array.isArray(record.courses) && record.courses.length ? record.courses[0].courseUrl : '')
		|| 'https://ucsbplat.com/';
	link.href = record.profileUrl || fallbackCourseUrl;
	link.textContent = 'View on UCSB Plat';

	actions.appendChild(link);
	header.appendChild(actions);
	main.appendChild(header);
	main.appendChild(sub);

	let courseInfo = null;
	if (courseData) {
		courseInfo = document.createElement('div');
		courseInfo.className = 'rmg-course-info';

		const courseName = document.createElement('div');
		courseName.className = 'rmg-course-name';
		courseName.textContent = courseData.courseName;
		courseInfo.appendChild(courseName);

		if (courseData.gradingBasis) {
			const gradingBasis = document.createElement('div');
			gradingBasis.className = 'rmg-course-detail';
			gradingBasis.textContent = `Grading: ${courseData.gradingBasis}`;
			courseInfo.appendChild(gradingBasis);
		}

		if (courseData.csvProfessor) {
			const prof = document.createElement('div');
			prof.className = 'rmg-course-detail';
			prof.textContent = `Professor: ${courseData.csvProfessor}`;
			courseInfo.appendChild(prof);
		}

		const gradeDistribution = Array.isArray(courseData.gradeDistribution)
			? courseData.gradeDistribution.filter(entry => entry && Number.isFinite(entry.percent))
			: [];
		const gradeSummaryStrings = Array.isArray(courseData.gradeDistributionDisplay) && courseData.gradeDistributionDisplay.length
			? courseData.gradeDistributionDisplay
			: (Array.isArray(courseData.gradingTrend) && courseData.gradingTrend.length
				? courseData.gradingTrend
				: (Array.isArray(record.gradeSummary) && record.gradeSummary.length ? record.gradeSummary : []));
		const gradeHasPercents = gradeDistribution.length > 0;
		if (gradeHasPercents || gradeSummaryStrings.length) {
			const gradeSection = document.createElement('div');
			gradeSection.className = 'rmg-course-section';

			const gradeTitle = document.createElement('div');
			gradeTitle.className = 'rmg-course-detail rmg-course-detail--title';
			gradeTitle.textContent = 'Grade distribution';
			
			// Feature 2: Add grade inflation index
			if (departmentAverages) {
				const inflationIndex = computeGradeInflationIndex(courseData, departmentAverages);
				if (inflationIndex) {
					const inflationChip = document.createElement('span');
					inflationChip.className = 'rmg-grade-inflation';
					
					if (Math.abs(inflationIndex.delta) < 0.15) {
						inflationChip.classList.add('rmg-grade-inflation--neutral');
					} else if (inflationIndex.delta > 0) {
						inflationChip.classList.add('rmg-grade-inflation--easier');
					} else {
						inflationChip.classList.add('rmg-grade-inflation--harder');
					}
					
					inflationChip.textContent = inflationIndex.label;
					inflationChip.title = `Course GPA: ${inflationIndex.courseGPA.toFixed(2)}, Dept Avg: ${inflationIndex.deptAvg.toFixed(2)}`;
					gradeTitle.appendChild(document.createTextNode(' '));
					gradeTitle.appendChild(inflationChip);
				}
			}
			
			gradeSection.appendChild(gradeTitle);

			if (gradeHasPercents) {
				const gradeChart = document.createElement('div');
				gradeChart.className = 'rmg-grade-chart';
				const sortedGrades = gradeDistribution.slice().sort((a, b) => gradeSortIndex(a.label) - gradeSortIndex(b.label));
				for (const entry of sortedGrades) {
					const percent = Number(entry.percent);
					if (!Number.isFinite(percent)) continue;
					const row = document.createElement('div');
					row.className = 'rmg-grade-bar';

					const label = document.createElement('span');
					label.className = 'rmg-grade-bar-label';
					label.textContent = entry.displayLabel || entry.label;
					row.appendChild(label);

					const track = document.createElement('div');
					track.className = 'rmg-grade-bar-track';
					const fill = document.createElement('span');
					fill.className = 'rmg-grade-bar-fill';
					const clampedPercent = Math.max(0, Math.min(percent, 100));
					fill.style.setProperty('--rmg-grade-fill', `${clampedPercent}%`);
					fill.title = `${label.textContent} ${formatPercent(percent)}`;
					track.appendChild(fill);
					row.appendChild(track);

					const value = document.createElement('span');
					value.className = 'rmg-grade-bar-value';
					value.textContent = formatPercent(percent);
					row.appendChild(value);

					gradeChart.appendChild(row);
				}
				gradeSection.appendChild(gradeChart);
			}

			if (!gradeHasPercents && gradeSummaryStrings.length) {
				const gradeSummary = document.createElement('div');
				gradeSummary.className = 'rmg-course-detail rmg-course-detail--muted';
				gradeSummary.textContent = gradeSummaryStrings.join(' • ');
				gradeSection.appendChild(gradeSummary);
			}

			courseInfo.appendChild(gradeSection);
		}

		const enrollmentEntries = Array.isArray(courseData.enrollmentEntries) ? courseData.enrollmentEntries : [];
		const enrollmentForChart = enrollmentEntries.slice(-8);
		const capacities = enrollmentForChart
			.map(entry => Number(entry?.capacity))
			.filter(capacity => Number.isFinite(capacity) && capacity > 0);
		const maxCapacity = capacities.length ? Math.max(...capacities) : null;
		if (enrollmentForChart.length) {
			const enrollmentSection = document.createElement('div');
			enrollmentSection.className = 'rmg-course-section';

			const enrollmentTitle = document.createElement('div');
			enrollmentTitle.className = 'rmg-course-detail rmg-course-detail--title';
			enrollmentTitle.textContent = 'Historic enrollment';
			enrollmentSection.appendChild(enrollmentTitle);

			const chart = document.createElement('div');
			chart.className = 'rmg-enrollment-chart';

			for (const entry of enrollmentForChart) {
				const row = document.createElement('div');
				row.className = 'rmg-enrollment-row';
				if (Number.isFinite(entry.percentFull) && entry.percentFull >= 99) {
					row.classList.add('rmg-enrollment-row--full');
				}
				if (Number.isFinite(entry.percentFull) && entry.percentFull > 100) {
					row.classList.add('rmg-enrollment-row--over');
				}

				const metaWrap = document.createElement('div');
				metaWrap.className = 'rmg-enrollment-meta';
				const phase = document.createElement('div');
				phase.className = 'rmg-enrollment-phase';
				phase.textContent = entry.phaseLabel || entry.phaseKey || 'Timeline';
				metaWrap.appendChild(phase);
				if (entry.displayDate) {
					const date = document.createElement('div');
					date.className = 'rmg-enrollment-date';
					date.textContent = entry.displayDate;
					metaWrap.appendChild(date);
				}
				row.appendChild(metaWrap);

				const barWrap = document.createElement('div');
				barWrap.className = 'rmg-enrollment-bar';

				const capacityTrack = document.createElement('span');
				capacityTrack.className = 'rmg-enrollment-capacity-track';
				barWrap.appendChild(capacityTrack);

				const fill = document.createElement('span');
				fill.className = 'rmg-enrollment-fill';
				const percentFull = Number.isFinite(entry.percentFull) ? Math.max(0, Math.min(entry.percentFull, 110)) : 0;
				fill.style.setProperty('--rmg-enrollment-fill', `${Math.min(percentFull, 100)}%`);
				fill.title = entry.display || entry.detail || '';
				capacityTrack.appendChild(fill);

				const detail = document.createElement('div');
				detail.className = 'rmg-enrollment-capacity';
				detail.textContent = entry.detail || '';

				const visualRow = document.createElement('div');
				visualRow.className = 'rmg-enrollment-visual';
				visualRow.appendChild(barWrap);
				visualRow.appendChild(detail);
				row.appendChild(visualRow);

				chart.appendChild(row);
			}

			enrollmentSection.appendChild(chart);
			
			// Feature 1: Add waitlist odds display
			const waitlistOdds = computeWaitlistOdds(courseData);
			if (waitlistOdds) {
				const oddsWrap = document.createElement('div');
				oddsWrap.className = 'rmg-waitlist-odds';
				
				const oddsLabel = document.createElement('div');
				oddsLabel.className = 'rmg-waitlist-odds-label';
				oddsLabel.textContent = 'Waitlist Probability:';
				oddsWrap.appendChild(oddsLabel);
				
				const oddsBadge = document.createElement('div');
				oddsBadge.className = 'rmg-waitlist-odds-badge';
				if (waitlistOdds.odds >= 75) {
					oddsBadge.classList.add('rmg-waitlist-odds-badge--high');
				} else if (waitlistOdds.odds >= 50) {
					oddsBadge.classList.add('rmg-waitlist-odds-badge--medium');
				} else if (waitlistOdds.odds >= 25) {
					oddsBadge.classList.add('rmg-waitlist-odds-badge--low');
				} else {
					oddsBadge.classList.add('rmg-waitlist-odds-badge--very-low');
				}
				oddsBadge.textContent = `${Math.round(waitlistOdds.odds)}% ${waitlistOdds.label}`;
				oddsBadge.title = waitlistOdds.detail;
				oddsWrap.appendChild(oddsBadge);
				
				enrollmentSection.appendChild(oddsWrap);
			}
			
			courseInfo.appendChild(enrollmentSection);
		}

		const hasCounts = Number.isFinite(courseData.foundReviews) || Number.isFinite(courseData.expectedReviews);
		if (courseData.reviewVerification || hasCounts) {
			const ver = document.createElement('div');
			ver.className = 'rmg-course-detail';

			const parts = [];
			if (courseData.reviewVerification) parts.push(`Verification: ${courseData.reviewVerification}`);
			if (Number.isFinite(courseData.foundReviews) && Number.isFinite(courseData.expectedReviews)) {
				parts.push(`Reviews: ${courseData.foundReviews}/${courseData.expectedReviews}`);
			} else if (Number.isFinite(courseData.foundReviews)) {
				parts.push(`Reviews found: ${courseData.foundReviews}`);
			} else if (Number.isFinite(courseData.expectedReviews)) {
				parts.push(`Reviews expected: ${courseData.expectedReviews}`);
			}

			ver.textContent = parts.join(' • ');
			courseInfo.appendChild(ver);
		}

		if (courseData.recentReviews && courseData.recentReviews.length > 0) {
			const reviewsContainer = document.createElement('div');
			reviewsContainer.className = 'rmg-course-reviews';

			const reviewsTitle = document.createElement('div');
			reviewsTitle.className = 'rmg-course-reviews-title';
			reviewsTitle.textContent = 'Recent Reviews:';
			reviewsContainer.appendChild(reviewsTitle);

			const reviewsToShow = courseData.recentReviews.slice(0, 2);
			for (const review of reviewsToShow) {
				const reviewElement = document.createElement('div');
				reviewElement.className = 'rmg-course-review';
				const truncatedReview = review.length > 150 ? review.substring(0, 150) + '...' : review;
				reviewElement.textContent = `"${truncatedReview}"`;
				reviewsContainer.appendChild(reviewElement);
			}

			courseInfo.appendChild(reviewsContainer);
		}

		if (courseData.courseUrl) {
			const courseLink = document.createElement('a');
			courseLink.className = 'rmg-link rmg-course-link';
			courseLink.target = '_blank';
			courseLink.rel = 'noopener noreferrer';
			courseLink.href = courseData.courseUrl;
			courseLink.textContent = 'Course Info';
			actions.appendChild(courseLink);
		}
	}

	if (courseInfo) {
		main.appendChild(courseInfo);
	}

	try {
		const cell = anchorNode.closest && anchorNode.closest('td,th');
		if (cell) {
			cell.style.minWidth = '960px';
			cell.style.width = 'auto';
			cell.style.maxWidth = 'none';
			cell.style.paddingRight = '12px';
			cell.style.paddingLeft = '12px';
			cell.style.textAlign = 'left';
			cell.style.verticalAlign = 'top';
			cell.style.display = 'block';
			cell.appendChild(card);
		} else {
			anchorNode.insertAdjacentElement('afterend', card);
		}
	} catch (_e) {
		(anchorNode.parentElement || document.body).appendChild(card);
	}

}

function extractCourseCode(instructorNode) {
	// Helper function to find valid course codes in text
	function findValidCourseCodeInText(text, courseLookup) {
		const normalizedText = text.trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
		// Find all potential course code candidates
		const matches = normalizedText.matchAll(/\b([A-Z]{2,8})\s+(\d{1,3}[A-Z]*)\b/g);
		for (const match of matches) {
			const candidate = `${match[1]} ${match[2]}`;
			const normalized = normalizeCourseCode(candidate);
			if (courseLookup && courseLookup.has(normalized)) {
				return candidate;
			}
		}
		return null;
	}

	try {
		// Find the containing row
		const row = instructorNode.closest('tr, .row, .resultsRow, .SSR_CLSRSLT_WRK, .sectionRow, .CourseRow');
		if (!row) return null;
		
		// First, try the same row (current logic) - expanded to include anchors and headers
		const cells = Array.from(row.querySelectorAll('td, th, div, span, a, strong, b'));
		for (const cell of cells) {
			if (cell === instructorNode || cell.contains(instructorNode)) continue;
			
			const text = (cell.textContent || '').trim();
			const courseCode = findValidCourseCodeInText(text, window.__rmg_course_lookup);
			if (courseCode) {
				console.log('[RateMyGaucho] Extracted course code:', courseCode, 'from same row, text:', text.slice(0, 100));
				return courseCode;
			}
		}
		
		// If not found in same row, search previous sibling rows (likely header rows) - expanded depth and nodes
		let prevRow = row.previousElementSibling;
		for (let i = 0; prevRow && i < 30; i++) {
			const prevCells = Array.from(prevRow.querySelectorAll('td, th, div, span, a, strong, b'));
			for (const cell of prevCells) {
				const text = (cell.textContent || '').trim();
				const courseCode = findValidCourseCodeInText(text, window.__rmg_course_lookup);
				if (courseCode) {
					console.log('[RateMyGaucho] Extracted course code:', courseCode, 'from prev row', i, 'text:', text.slice(0, 100));
					return courseCode;
				}
			}
			prevRow = prevRow.previousElementSibling;
		}
		
		// Ancestor walk: search outside the table by climbing ancestors and scanning their previous siblings
		let container = row.parentElement;
		for (let up = 0; container && up < 5; up++) {
			let prev = container.previousElementSibling;
			for (let j = 0; prev && j < 30; j++) {
				const text = (prev.textContent || '').trim();
				const courseCode = findValidCourseCodeInText(text, window.__rmg_course_lookup);
				if (courseCode) {
					console.log('[RateMyGaucho] Extracted course code:', courseCode, 'from ancestor walk level', up, 'sibling', j, 'text:', text.slice(0, 100));
					return courseCode;
				}
				prev = prev.previousElementSibling;
			}
			container = container.parentElement;
		}
		
		// Final fallback: search the entire table for course headers
		const table = instructorNode.closest('table');
		if (table) {
			const allRows = Array.from(table.querySelectorAll('tr'));
			const currentRowIndex = allRows.indexOf(row);
			
			// Search backwards from current row
			for (let i = currentRowIndex - 1; i >= 0 && i >= currentRowIndex - 10; i--) {
				const searchRow = allRows[i];
				const searchCells = Array.from(searchRow.querySelectorAll('td, th, div, span, a, strong, b'));
				
				for (const cell of searchCells) {
					const text = (cell.textContent || '').trim();
					const courseCode = findValidCourseCodeInText(text, window.__rmg_course_lookup);
					if (courseCode) {
						console.log('[RateMyGaucho] Extracted course code:', courseCode, 'from table search, text:', text.slice(0, 100));
						return courseCode;
					}
				}
			}
		}
		
		// Heuristic fallback: try to extract from "Course Info" button href or onclick
		try {
			const courseInfoButtons = Array.from(row.querySelectorAll('a, button')).filter(el => 
				/course\s*info/i.test((el.textContent || '').trim())
			);
			
			for (const btn of courseInfoButtons) {
				// Try href first
				if (btn.href) {
					const hrefMatch = btn.href.match(/subject=([A-Z]+).*?catalogNbr=(\d+[A-Z]*)/i);
					if (hrefMatch) {
						const candidate = `${hrefMatch[1]} ${hrefMatch[2]}`;
						const normalized = normalizeCourseCode(candidate);
						if (window.__rmg_course_lookup && window.__rmg_course_lookup.has(normalized)) {
							console.log('[RateMyGaucho] Extracted course code:', candidate, 'from Course Info href:', btn.href);
							return candidate;
						}
					}
				}
				
				// Try onclick attribute
				const onclick = btn.getAttribute('onclick');
				if (onclick) {
					const onclickMatch = onclick.match(/subject['"]\s*:\s*['"]([A-Z]+)['"].*?catalogNbr['"]\s*:\s*['"](\d+[A-Z]*)['"]/i);
					if (onclickMatch) {
						const candidate = `${onclickMatch[1]} ${onclickMatch[2]}`;
						const normalized = normalizeCourseCode(candidate);
						if (window.__rmg_course_lookup && window.__rmg_course_lookup.has(normalized)) {
							console.log('[RateMyGaucho] Extracted course code:', candidate, 'from Course Info onclick:', onclick.slice(0, 100));
							return candidate;
						}
					}
				}
			}
		} catch (e) {
			console.warn('[RateMyGaucho] Error in Course Info button extraction:', e);
		}
		
		console.log('[RateMyGaucho] No course code found for instructor:', (instructorNode.textContent || '').trim());
		return null;
	} catch (e) {
		console.warn('[RateMyGaucho] Error extracting course code:', e);
		return null;
	}
}
