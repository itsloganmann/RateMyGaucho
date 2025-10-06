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
			console.log('[RateMyGaucho] Loading unified dataset: courses_all_scraped.csv');
			const csvUrl = chrome.runtime.getURL('courses_all_scraped.csv');
			const res = await fetch(csvUrl);
			if (!res.ok) {
				console.error('[RateMyGaucho] Failed to fetch courses_all_scraped.csv');
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

			const courseRecord = {
				courseName,
				courseUrl: (row.course_url || '').trim(),
				csvProfessor: (row.professor || '').trim(),
				gradingBasis: '',
				gradingTrend: parseFlexibleArray(row.grading_trend, { delimiter: '|', type: 'string' }),
				enrollmentTrend: parseFlexibleArray(normalizeTrend(row.enrollment_trend), { delimiter: '|', type: 'number' }),
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
					gradeTokens: [],
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
			if (Array.isArray(courseRecord.gradingTrend) && courseRecord.gradingTrend.length) {
				bucket.gradeTokens.push(...courseRecord.gradingTrend);
			}
		}

		const instructors = [];
		for (const bucket of instructorAccumulator.values()) {
			const departments = Array.from(bucket.departments);
			const gradeSummary = Array.from(new Set(bucket.gradeTokens.map(token => token.toUpperCase())));
			const rating = computeAggregateRating(bucket.gradeTokens, bucket.reviews.length);
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

		return { courseRecords, courseLookup, ratingsLookup, instructors };
	} catch (error) {
		console.error('[RateMyGaucho] Error parsing unified CSV:', error);
		return null;
	}
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

function computeAggregateRating(gradeTokens, reviewCount) {
	if (Array.isArray(gradeTokens) && gradeTokens.length) {
		const values = gradeTokens.map(gradeTokenToRating).filter(Number.isFinite);
		if (values.length) {
			const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
			return Number(avg.toFixed(1));
		}
	}

	if (reviewCount > 0) {
		const fallback = Math.min(5, 3.2 + Math.min(reviewCount, 12) * 0.1);
		return Number(fallback.toFixed(1));
	}

	return 3.0;
}

function gradeTokenToRating(token) {
	if (!token) return NaN;
	const normalized = token.toString().trim().toUpperCase();
	if (!normalized) return NaN;
	let base;
	switch (normalized[0]) {
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

	if (normalized.includes('+') && base < 5) base += 0.2;
	if (normalized.includes('-') && base > 1) base -= 0.2;
	return Math.max(1, Math.min(5, base));
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
		const lookup = await ensureRatingsLoaded();
		const courseLookup = await ensureCoursesLoaded();
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
			renderCard(node, match, gatedCourseData);
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

function renderCard(anchorNode, record, courseData = null) {
	const card = document.createElement('div');
	const rating = Number(record.rmpScore || 0);
	card.className = 'rmg-card ' + (rating >= 4 ? 'rmg-good' : rating >= 3 ? 'rmg-ok' : 'rmg-bad');

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

	const meta = document.createElement('span');
	meta.className = 'rmg-meta';
	const shouldShowFallbackGrade = (
		(!courseData || !Array.isArray(courseData.gradingTrend) || courseData.gradingTrend.length === 0) &&
		Array.isArray(record.gradeSummary) &&
		record.gradeSummary.length > 0
	);
	meta.textContent = shouldShowFallbackGrade ? `Grade trend: ${record.gradeSummary.join(' → ')}` : '';

	const meter = document.createElement('div');
	meter.className = 'rmg-meter';
	const bar = document.createElement('span');
	meter.appendChild(bar);

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
	main.appendChild(meter);

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

		if (courseData.enrollmentTrend && courseData.enrollmentTrend.length > 0) {
			const enrollmentTrend = document.createElement('div');
			enrollmentTrend.className = 'rmg-course-detail';
			enrollmentTrend.textContent = `Enrollment: ${courseData.enrollmentTrend.join(' → ')}`;
			courseInfo.appendChild(enrollmentTrend);
		}

		if (courseData.csvProfessor) {
			const prof = document.createElement('div');
			prof.className = 'rmg-course-detail';
			prof.textContent = `Professor: ${courseData.csvProfessor}`;
			courseInfo.appendChild(prof);
		}

		const gradeTokens = Array.isArray(courseData.gradingTrend) && courseData.gradingTrend.length
			? courseData.gradingTrend
			: (Array.isArray(record.gradeSummary) && record.gradeSummary.length ? record.gradeSummary : null);
		if (gradeTokens && gradeTokens.length) {
			const gradeDetail = document.createElement('div');
			gradeDetail.className = 'rmg-course-detail';
			gradeDetail.textContent = `Grade trend: ${gradeTokens.join(' → ')}`;
			courseInfo.appendChild(gradeDetail);
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

	if (meta.textContent) {
		main.appendChild(meta);
	}

	try {
		const cell = anchorNode.closest && anchorNode.closest('td,th');
		if (cell) {
			cell.appendChild(card);
		} else {
			anchorNode.insertAdjacentElement('afterend', card);
		}
	} catch (_e) {
		(anchorNode.parentElement || document.body).appendChild(card);
	}

	requestAnimationFrame(() => {
		const pct = Math.max(0, Math.min(100, (rating / 5) * 100));
		bar.style.width = pct + '%';
	});
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
