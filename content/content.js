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
	renderNLPSearchBar();
})();

let __rmg_lookup = null;
let __rmg_loading = null;
let __rmg_course_lookup = null;
let __rmg_course_loading = null;

async function ensureRatingsLoaded() {
	if (__rmg_lookup) return __rmg_lookup;
	if (__rmg_loading) return __rmg_loading;
	__rmg_loading = (async () => {
		try {
			const csvUrl = chrome.runtime.getURL('scores.csv');
			const res = await fetch(csvUrl);
			if (!res.ok) {
				console.log('[RateMyGaucho] scores.csv not found (status', res.status, ') — ratings disabled');
				return null;
			}
			const csvText = await res.text();
			if (!csvText || csvText.trim().length < 10) {
				console.log('[RateMyGaucho] scores.csv is empty — ratings disabled');
				return null;
			}
			const records = parseCsv(csvText);
			__rmg_lookup = buildLookup(records);
			console.log('[RateMyGaucho] ✅ Ratings loaded:', records.length, 'instructors');
			return __rmg_lookup;
		} catch (_e) {
			console.log('[RateMyGaucho] scores.csv unavailable — ratings disabled');
			return null;
		} finally {
			__rmg_loading = null;
		}
	})();
	return __rmg_loading;
}

async function ensureCoursesLoaded() {
	if (__rmg_course_lookup) return __rmg_course_lookup;
	if (__rmg_course_loading) return __rmg_course_loading;
	__rmg_course_loading = (async () => {
		try {
			// Use the actual bundled CSV file
			const primaryUrl = chrome.runtime.getURL('courses_final_enrollment.csv');
			
			let csvText = null;
			let sourceFile = null;
			
			try {
				console.log('[RateMyGaucho] Attempting to load course data: courses_final_enrollment.csv');
				const res = await fetch(primaryUrl);
				if (res.ok) {
					csvText = await res.text();
					sourceFile = 'courses_final_enrollment.csv';
					console.log('[RateMyGaucho] ✅ Successfully loaded courses_final_enrollment.csv');
				}
			} catch (primaryError) {
				console.warn('[RateMyGaucho] Failed to load courses_final_enrollment.csv:', primaryError);
			}
			
			if (csvText == null) {
				console.error('[RateMyGaucho] Failed to load course data — no CSV file available');
				return null;
			}
			
			console.log('[RateMyGaucho] Parsing course data from:', sourceFile);
			const records = parseCourseCsv(csvText);
			__rmg_course_lookup = buildCourseLookup(records);
			// Store globally for extractCourseCode validation
			window.__rmg_course_lookup = __rmg_course_lookup;
			console.log('[RateMyGaucho] ✅ Course data loaded and indexed successfully');
			return __rmg_course_lookup;
		} catch (_e) {
			console.error('[RateMyGaucho] Error loading course data:', _e);
			return null;
		} finally {
			__rmg_course_loading = null;
		}
	})();
	return __rmg_course_loading;
}

function loadSettings() {
	return new Promise(resolve => {
		try { chrome.storage?.local?.get({ enabled: true, compactMode: false }, resolve); }
		catch { resolve({ enabled: true, compactMode: false }); }
	});
}

function parseCsv(csvText) {
	const lines = csvText.split(/\r?\n/).filter(Boolean);
	if (!lines.length) return [];
	lines.shift();
	const out = [];
	for (const line of lines) {
		const cols = line.split(',');
		if (cols.length < 6) continue;
		const [department, first_name, last_name, rmp_score, num_reviews, profile_url] = cols;
		const rec = {
			department: (department||'').trim(),
			firstName: (first_name||'').trim(),
			lastName: (last_name||'').trim(),
			rmpScore: Number(rmp_score),
			numReviews: Number(num_reviews),
			profileUrl: (profile_url||'').trim()
		};
		if (!Number.isFinite(rec.rmpScore) || !Number.isFinite(rec.numReviews)) continue;
		out.push(rec);
	}
	return out;
}

/**
 * Compute a weighted GPA from a grading trend string like "A: 62.6%, B: 27.8%, C: 9.1%, D: 0.0%, F: 0.5%"
 * Returns NaN if not parseable (e.g. Pass/Fail courses).
 */
function computeGpaFromGradingTrend(trend) {
	if (!trend) return NaN;
	const gradePoints = { 'A': 4.0, 'B': 3.0, 'C': 2.0, 'D': 1.0, 'F': 0.0 };
	let totalWeight = 0;
	let totalPoints = 0;
	for (const [letter, points] of Object.entries(gradePoints)) {
		const regex = new RegExp(`${letter}[+-]?\\s*:\\s*([\\d.]+)%`, 'i');
		const m = trend.match(regex);
		if (m) {
			const pct = parseFloat(m[1]);
			if (!isNaN(pct)) {
				totalWeight += pct;
				totalPoints += pct * points;
			}
		}
	}
	if (totalWeight < 10) return NaN; // Not enough data (probably Pass/Fail)
	return totalPoints / totalWeight;
}

function parseCourseCsv(csvText) {
	try {
		const parsed = Papa.parse(csvText, {
			header: true,
			skipEmptyLines: true,
			transformHeader: (header) => header.trim()
		});
		
		if (parsed.errors.length > 0) {
			console.warn('[RateMyGaucho] CSV parsing warnings:', parsed.errors);
		}
		
		const out = [];
		for (const row of parsed.data) {
			if (!row.course_name) continue;
			
			// Build recentReviews from individual review_1/2/3 columns OR legacy recent_reviews
			let recentReviews;
			if (row.review_1 || row.review_2 || row.review_3) {
				recentReviews = [row.review_1, row.review_2, row.review_3]
					.map(r => (r || '').trim())
					.filter(Boolean);
			} else {
				recentReviews = parseFlexibleArray(row.recent_reviews, { reviewSeparator: '|||', type: 'string' });
			}
			
			// Compute avgGpa from grading_trend (e.g. "A: 62.6%, B: 27.8%, C: 9.1%, D: 0.0%, F: 0.5%")
			let avgGpa = row.avg_gpa ? parseFloat(row.avg_gpa) : NaN;
			if (isNaN(avgGpa)) {
				avgGpa = computeGpaFromGradingTrend(row.grading_trend || '');
			}

			// Parse grading trend into individual grade entries for pills
			const gradingTrendRaw = (row.grading_trend || '').trim();
			let gradingTrend = [];
			if (gradingTrendRaw) {
				// Format: "A: 62.6%, B: 27.8%, C: 9.1%, D: 0.0%, F: 0.5%"
				const gradeMatches = gradingTrendRaw.match(/[A-Za-z+\-]+\s*:\s*[\d.]+%/g);
				if (gradeMatches) {
					gradingTrend = gradeMatches.map(g => g.trim());
				} else {
					gradingTrend = [gradingTrendRaw]; // fallback: single entry
				}
			}

			// Parse enrollment trend: extract current/max numbers from pipe-separated entries
			const enrollmentRaw = (row.enrollment_trend || '').trim();
			let enrollmentTrend = [];
			if (enrollmentRaw) {
				const entries = enrollmentRaw.split('|').map(e => e.trim()).filter(Boolean);
				for (const entry of entries) {
					// Match pattern like "22/210" or "0/360"
					const m = entry.match(/(\d+)\s*\/\s*(\d+)/);
					if (m) {
						enrollmentTrend.push(parseInt(m[1], 10));
					}
				}
			}
			
			const rec = {
				// Existing fields used by the UI and matching
				courseName: (row.course_name || '').trim(),
				courseUrl: (row.course_url || '').trim(),
				
				// Keep compatibility: some CSVs may not have grading_basis
				gradingBasis: (row.grading_basis || '').trim(),
				
				// Parsed grading and enrollment data for visual display
				gradingTrend: gradingTrend,
				enrollmentTrend: enrollmentTrend,
				recentReviews,
				
				// Professor and metadata
				csvProfessor: (row.professor || '').trim(),
				expectedReviews: row.expected_reviews ? Number(row.expected_reviews) : undefined,
				foundReviews: row.found_reviews ? Number(row.found_reviews) : undefined,
				reviewVerification: (row.review_verification || '').trim(),
				
				// Computed GPA for NLP search
				avgGpa: isNaN(avgGpa) ? undefined : avgGpa
			};
			
			out.push(rec);
		}
		
		console.log('[RateMyGaucho] Parsed', out.length, 'course records');
		if (out.length > 0) {
			console.log('[RateMyGaucho] Sample course records (first 3):');
			out.slice(0, 3).forEach((rec, idx) => {
				console.log(`  [${idx + 1}] ${rec.courseName}:`, {
					courseUrl: rec.courseUrl ? '✓' : '✗',
					csvProfessor: rec.csvProfessor || '(none)',
					gradingTrend: rec.gradingTrend.length + ' items',
					enrollmentTrend: rec.enrollmentTrend.length + ' items',
					recentReviews: rec.recentReviews.length + ' reviews',
					verification: rec.reviewVerification || '(none)',
					expectedReviews: rec.expectedReviews !== undefined ? rec.expectedReviews : '(none)',
					foundReviews: rec.foundReviews !== undefined ? rec.foundReviews : '(none)'
				});
			});
		}
		return out;
	} catch (e) {
		console.error('[RateMyGaucho] Error parsing course CSV:', e);
		return [];
	}
}

function parseJsonArray(jsonString) {
	if (!jsonString || jsonString.trim() === '') return [];
	try {
		const parsed = JSON.parse(jsonString);
		return Array.isArray(parsed) ? parsed : [];
	} catch (e) {
		console.warn('[RateMyGaucho] Failed to parse JSON array:', jsonString, e);
		return [];
	}
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

// Module-level dedup sets — persist across scan() calls so MutationObserver re-entries don't duplicate
const __rmg_renderedCourseInstructors = new Set();
const __rmg_renderedCourseOnly = new Set();

function observeAndRender() {
	let scanPending = false;
	let scanRunning = false;
	const observer = new MutationObserver(() => {
		if (!scanPending && !scanRunning) {
			scanPending = true;
			scheduleScan();
		}
	});
	observer.observe(document, { childList: true, subtree: true });
	scheduleScan();

	async function scheduleScan() {
		if (typeof requestAnimationFrame === 'function') requestAnimationFrame(async () => { await scan(); scanPending = false; });
		else setTimeout(async () => { await scan(); scanPending = false; }, 50);
	}

	async function scan() {
		if (scanRunning) return;
		scanRunning = true;
		// Disconnect observer while we mutate the DOM to avoid cascading re-scans
		observer.disconnect();
		try {
			await doScan();
		} finally {
			scanRunning = false;
			observer.observe(document, { childList: true, subtree: true });
		}
	}

	async function doScan() {
		const nodes = findInstructorNodes();
		console.log('[RateMyGaucho] instructor candidates:', nodes.length);
		if (!nodes.length) return;
		const lookup = await ensureRatingsLoaded();
		const courseLookup = await ensureCoursesLoaded();
		// Do NOT bail if lookup (scores.csv) is null — we can still show course data
		if (!lookup && !courseLookup) return;
		const sample = nodes.slice(0, 5).map(n => (n.textContent||'').trim().replace(/\s+/g,' '));
		console.log('[RateMyGaucho] sample candidate texts:', sample);
		
		let matchedCount = 0;
		let courseFoundCount = 0;
		let totalProcessed = 0;
		
		for (const node of nodes) {
			if (node.dataset.rmgInitialized === '1') continue;
			node.dataset.rmgInitialized = '1';

			// Prevent duplicate cards per table row (cards are now in sibling rows)
			const row = node.closest && node.closest('tr');
			if (row) {
				// Check if this row already has a card, or the next sibling is a card row
				if (row.querySelector('.rmg-card')) continue;
				const nextRow = row.nextElementSibling;
				if (nextRow && nextRow.classList.contains('rmg-card-row')) continue;
			}

			totalProcessed++;
			
			const info = extractInstructorInfo(node);
			console.log('[RateMyGaucho] Processing:', info.raw, '-> names:', info.names);
			
			// Debug: show what keys are being generated
			for (const name of info.names) {
				const keys = candidateKeysForName(name, '');
				console.log('[RateMyGaucho] Keys for', name, ':', keys.slice(0, 5)); // Show first 5 keys
			}
			
			const match = lookup ? matchInstructor(info, lookup) : null;
			const courseCode = extractCourseCode(node);
			const courseList = courseCode && courseLookup ? courseLookup.get(normalizeCourseCode(courseCode)) : null;
			const courseData = Array.isArray(courseList) ? pickCourseDataForInstructor(courseList, match) : null;
			
			if (courseCode) {
				console.log('[RateMyGaucho] Extracted course code:', courseCode, 'normalized:', normalizeCourseCode(courseCode));
			}

			// De-duplicate: also check if the DOM already has a card for this course
			if (row) {
				if (row.querySelectorAll('.rmg-card-wrapper').length > 0) continue;
				const nextSib = row.nextElementSibling;
				if (nextSib && nextSib.classList.contains('rmg-card-row')) continue;
			}
			
			// Determine gated course data (verify instructor matches course)
			let gatedCourseData = null;
			if (courseData) {
				courseFoundCount++;
				if (match) {
					const verifiedByCsvProfessor = csvProfessorMatches(courseData, match);
					const verifiedByFlag = typeof courseData?.reviewVerification === 'string'
						&& courseData.reviewVerification.toUpperCase().includes('MATCH');
					const hasInstructorSpecificReviews = (
						courseData._reviewsFiltered
						&& Array.isArray(courseData.recentReviews)
						&& courseData.recentReviews.length > 0
					);
					
					gatedCourseData = (hasInstructorSpecificReviews || verifiedByCsvProfessor || verifiedByFlag)
						? courseData
						: null;
					
					if (!gatedCourseData) {
						console.log('[RateMyGaucho] SKIPPED course data for',
							`${match.firstName} ${match.lastName}`,
							'- gating conditions not met',
							{ hasInstructorSpecificReviews, verifiedByCsvProfessor, reviewVerification: courseData?.reviewVerification });
					}
				} else {
					// No ratings match — show course data ungated (we can't verify by instructor)
					gatedCourseData = courseData;
				}
			}
			
			if (match) {
				matchedCount++;
				// Only one card per course + instructor combination on the whole page
				const instructorKey = `${match.lastName}|${match.firstName}`;
				const courseInstructorKey = `${courseCode || 'none'}:${instructorKey}`;
				if (__rmg_renderedCourseInstructors.has(courseInstructorKey)) continue;
				__rmg_renderedCourseInstructors.add(courseInstructorKey);

				console.log('[RateMyGaucho] MATCHED:', info.raw, '->', match.firstName, match.lastName, match.rmpScore);
				if (gatedCourseData) {
					const filterStatus = gatedCourseData._reviewsFiltered ? '(filtered)' : '(fallback)';
					console.log('[RateMyGaucho] Course data chosen for instructor:',
						`${match.firstName} ${match.lastName}`, '->', gatedCourseData.courseName,
						'filteredReviews:', Array.isArray(gatedCourseData.recentReviews) ? gatedCourseData.recentReviews.length : 0, filterStatus);
				}
				renderCard(node, match, gatedCourseData);
			} else if (gatedCourseData) {
				// Only one course-only card per course code on the page
				const courseOnlyKey = `courseonly:${courseCode || 'none'}`;
				if (__rmg_renderedCourseOnly.has(courseOnlyKey)) continue;
				__rmg_renderedCourseOnly.add(courseOnlyKey);

				console.log('[RateMyGaucho] No ratings match for:', info.raw, '— rendering course-only card');
				renderCard(node, null, gatedCourseData);
			} else {
				console.log('[RateMyGaucho] NO MATCH for:', info.raw);
			}
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
					const cells = row.querySelectorAll('td');
					if (cells && cells.length > idx) {
						const cell = cells[idx];
						const txt = (cell.textContent || '').trim();
						// Skip empty cells, single-letter cells (like "W" for day),
						// and header text like "Instructor"
						if (!txt || txt.length < 2 || /^(instructor|professor|ta|staff)$/i.test(txt)) continue;
						// Must look like a name: at least 2 chars and mostly letters
						if (/^[A-Za-z][A-Za-z\s,.\-']+$/.test(txt) && txt.length >= 3) {
							set.add(cell);
						}
					}
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
	const hasRatings = record && Number.isFinite(Number(record.rmpScore));
	const rating = hasRatings ? Number(record.rmpScore) : 0;
	card.className = 'rmg-card ' + (hasRatings ? (rating >= 4 ? 'rmg-good' : rating >= 3 ? 'rmg-ok' : 'rmg-bad') : 'rmg-ok');

	const badge = document.createElement('span');
	badge.className = 'rmg-badge';
	if (hasRatings) {
		badge.textContent = rating.toFixed(1);
		badge.classList.add(
			rating >= 4 ? 'rmg-badge--good' : rating >= 3 ? 'rmg-badge--ok' : 'rmg-badge--bad'
		);
	} else {
		badge.textContent = '—';
		badge.classList.add('rmg-badge--ok');
	}

	const sub = document.createElement('span');
	sub.className = 'rmg-subtle';
	sub.textContent = hasRatings ? `${record.numReviews} reviews` : (courseData ? courseData.courseName : '');

	const stars = document.createElement('div');
	stars.className = 'rmg-stars';
	
	// Create 5 gaucho star images with precise tenths-based partial fills
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
	meta.textContent = '';

	const meter = document.createElement('div');
	meter.className = 'rmg-meter';
	const bar = document.createElement('span');
	meter.appendChild(bar);

	// Course metadata section (sparklines, grade pills, review)
	let courseMeta = null;
	if (courseData) {
		courseMeta = renderCourseMeta(courseData);
	}

	const actions = document.createElement('div');
	actions.className = 'rmg-actions';

	const link = document.createElement('a');
	link.className = 'rmg-link';
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	link.href = (record && record.profileUrl) ? record.profileUrl : (courseData && courseData.courseUrl ? courseData.courseUrl : 'https://ucsbplat.com/instructor/');
	link.textContent = 'UCSB Plat';

	card.appendChild(badge);
	card.appendChild(stars);
	card.appendChild(sub);
	if (courseMeta) {
		card.appendChild(courseMeta);
	}
	card.appendChild(meter);
	actions.appendChild(link);
	card.appendChild(actions);

	// Wrap in a container that enforces min-width even inside narrow <td>
	const wrapper = document.createElement('div');
	wrapper.className = 'rmg-card-wrapper';
	wrapper.appendChild(card);

	try {
		const row = anchorNode.closest && anchorNode.closest('tr');
		if (row && row.parentElement) {
			// Insert as a new row below the instructor row so it doesn't overlap adjacent cells
			const newRow = document.createElement('tr');
			newRow.className = 'rmg-card-row';
			const colCount = row.querySelectorAll('td, th').length || 1;
			const newCell = document.createElement('td');
			newCell.colSpan = colCount;
			newCell.style.cssText = 'padding: 0 4px 4px 4px; border: none; background: transparent;';
			newCell.appendChild(wrapper);
			newRow.appendChild(newCell);
			row.insertAdjacentElement('afterend', newRow);
		} else {
			const cell = anchorNode.closest && anchorNode.closest('td,th');
			if (cell) {
				cell.style.overflow = 'visible';
				cell.style.position = 'relative';
				cell.appendChild(wrapper);
			} else {
				anchorNode.insertAdjacentElement('afterend', wrapper);
			}
		}
	} catch (_e) {
		(anchorNode.parentElement || document.body).appendChild(wrapper);
	}

	requestAnimationFrame(() => {
		const pct = Math.max(0, Math.min(100, (rating / 5) * 100));
		bar.style.width = pct + '%';
	});
}

/**
 * Render course metadata: enrollment sparkline, grade pills, review quote.
 */
function renderCourseMeta(courseRec) {
	if (!courseRec) return null;

	const courseMeta = document.createElement('div');
	courseMeta.className = 'rmg-course';

	// Header with course name and grading basis
	const header = document.createElement('div');
	header.className = 'rmg-course-header';

	if (courseRec.courseName) {
		const courseTitle = document.createElement('div');
		courseTitle.className = 'rmg-course-title';
		courseTitle.textContent = courseRec.courseName;
		header.appendChild(courseTitle);
	}

	if (courseRec.gradingBasis) {
		const chip = document.createElement('span');
		chip.className = 'rmg-chip';
		chip.textContent = courseRec.gradingBasis;
		header.appendChild(chip);
	}

	courseMeta.appendChild(header);

	// Stats row with enrollment sparkline and grade pills
	const statsRow = document.createElement('div');
	statsRow.className = 'rmg-course-stats';

	// Enrollment trend with sparkline
	if (courseRec.enrollmentTrend && courseRec.enrollmentTrend.length > 0) {
		const enrollSection = document.createElement('div');
		enrollSection.className = 'rmg-stat-section';

		const enrollLabel = document.createElement('div');
		enrollLabel.className = 'rmg-stat-label';
		enrollLabel.textContent = 'Enrollment';
		enrollSection.appendChild(enrollLabel);

		const currentEnrollment = courseRec.enrollmentTrend[courseRec.enrollmentTrend.length - 1];
		if (typeof currentEnrollment === 'number') {
			const enrollNumber = document.createElement('div');
			enrollNumber.className = 'rmg-stat-number';
			enrollNumber.textContent = currentEnrollment.toString();
			enrollSection.appendChild(enrollNumber);
		}

		// Sparkline bar chart
		const enrollSpark = document.createElement('div');
		enrollSpark.className = 'rmg-sparkline';
		enrollSpark.setAttribute('aria-label', `Enrollment trend: ${courseRec.enrollmentTrend.join(' → ')}`);

		const maxVal = Math.max(...courseRec.enrollmentTrend.filter(v => typeof v === 'number' && !isNaN(v)));
		if (maxVal > 0) {
			courseRec.enrollmentTrend.forEach((val, i) => {
				if (typeof val === 'number' && !isNaN(val)) {
					const sparkBar = document.createElement('span');
					sparkBar.className = 'rmg-spark-bar';
					sparkBar.style.height = `${Math.max(3, (val / maxVal) * 24)}px`;
					sparkBar.title = `Quarter ${i + 1}: ${val} students`;
					enrollSpark.appendChild(sparkBar);
				}
			});
			enrollSection.appendChild(enrollSpark);
		}

		statsRow.appendChild(enrollSection);
	}

	// Grade distribution pills
	if (courseRec.gradingTrend && courseRec.gradingTrend.length > 0) {
		const gradeSection = document.createElement('div');
		gradeSection.className = 'rmg-stat-section';

		const gradeLabel = document.createElement('div');
		gradeLabel.className = 'rmg-stat-label';
		gradeLabel.textContent = 'Recent Grades';
		gradeSection.appendChild(gradeLabel);

		const gradeDisplay = document.createElement('div');
		gradeDisplay.className = 'rmg-grade-pills';

		// Show all grade entries as pills
		courseRec.gradingTrend.forEach((grade, i) => {
			if (typeof grade === 'string' && grade.trim()) {
				const gradePill = document.createElement('span');
				gradePill.className = `rmg-grade-pill rmg-grade-${getGradeClass(grade)}`;
				gradePill.textContent = grade.trim();
				gradePill.title = grade.trim();
				gradeDisplay.appendChild(gradePill);
			}
		});

		gradeSection.appendChild(gradeDisplay);
		statsRow.appendChild(gradeSection);
	}

	if (statsRow.children.length > 0) {
		courseMeta.appendChild(statsRow);
	}

	// Professor (PLAT)
	if (courseRec.csvProfessor) {
		const profLine = document.createElement('div');
		profLine.style.cssText = 'font-size:10px;color:rgba(0,54,96,0.7);margin-top:4px;';
		profLine.textContent = `Professor (PLAT): ${courseRec.csvProfessor}`;
		courseMeta.appendChild(profLine);
	}

	// Recent student review
	if (courseRec.recentReviews && courseRec.recentReviews.length > 0) {
		const firstReview = courseRec.recentReviews[0];
		if (typeof firstReview === 'string' && firstReview.trim()) {
			const reviewSection = document.createElement('div');
			reviewSection.className = 'rmg-review-section';

			const reviewIcon = document.createElement('span');
			reviewIcon.className = 'rmg-review-icon';
			reviewIcon.textContent = '💬';
			reviewSection.appendChild(reviewIcon);

			const reviewText = document.createElement('div');
			reviewText.className = 'rmg-review-text';
			const cleanReview = firstReview.replace(/[="]/g, '').trim();
			const truncatedReview = cleanReview.length > 140
				? cleanReview.slice(0, 140) + '…' : cleanReview;
			reviewText.textContent = `"${truncatedReview}"`;
			reviewSection.appendChild(reviewText);

			const reviewMeta = document.createElement('div');
			reviewMeta.className = 'rmg-review-meta';
			reviewMeta.textContent = 'Recent student feedback';
			reviewSection.appendChild(reviewMeta);

			courseMeta.appendChild(reviewSection);
		}
	}

	return courseMeta.children.length > 0 ? courseMeta : null;
}

// Helper function to determine grade class for styling
function getGradeClass(grade) {
	const g = (grade || '').trim().toUpperCase();
	// Handle formats like "A: 62.6%" or "A+" or "Pass: 100%"
	const letter = g.match(/^([A-F][+-]?|PASS|FAIL)/);
	if (!letter) return 'other';
	const l = letter[1];
	if (l.startsWith('A')) return 'excellent';
	if (l.startsWith('B')) return 'good';
	if (l.startsWith('C')) return 'average';
	if (l.startsWith('D')) return 'below';
	if (l.startsWith('F') || l === 'FAIL') return 'failing';
	if (l === 'PASS') return 'good';
	return 'other';
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

// ═══════════════════════════════════════════════════════════
// ── Natural Language Search Feature ──
// ═══════════════════════════════════════════════════════════

function parseNaturalQuery(queryText) {
	const query = queryText.toLowerCase();
	const result = {
		days: [],
		timeRange: { start: null, end: null },
		difficulty: null,
		departments: [],
		level: null,
		keywords: [],
		exactCourseCode: null
	};

	// Difficulty
	if (/\b(easy|easier|chill|relaxed)\b/.test(query)) result.difficulty = 'easy';
	else if (/\b(hard|difficult|tough|challenging)\b/.test(query)) result.difficulty = 'hard';
	else if (/\b(moderate|medium|average)\b/.test(query)) result.difficulty = 'moderate';

	// Exact course code (e.g., CMPSC 130A, MATH 2A)
	const courseCodeMatch = queryText.match(/\b([A-Z]{2,8})\s+(\d+[A-Z]*)\b/i);
	if (courseCodeMatch) {
		result.exactCourseCode = `${courseCodeMatch[1].toUpperCase()} ${courseCodeMatch[2].toUpperCase()}`;
	}

	// Day detection
	const dayMap = {
		'monday': 'M', 'mon': 'M',
		'tuesday': 'T', 'tue': 'T', 'tues': 'T',
		'wednesday': 'W', 'wed': 'W',
		'thursday': 'R', 'thur': 'R', 'thurs': 'R', 'thu': 'R',
		'friday': 'F', 'fri': 'F',
		'mwf': 'MWF', 'tr': 'TR', 'mw': 'MW'
	};
	for (const [word, code] of Object.entries(dayMap)) {
		if (new RegExp(`\\b${word}\\b`).test(query)) {
			for (const c of code) if (!result.days.includes(c)) result.days.push(c);
		}
	}

	// Time detection
	if (/\bmorning\b/.test(query)) { result.timeRange.start = 0; result.timeRange.end = 12; }
	else if (/\bafternoon\b/.test(query)) { result.timeRange.start = 12; result.timeRange.end = 17; }
	else if (/\bevening\b/.test(query)) { result.timeRange.start = 17; result.timeRange.end = 23; }

	const afterMatch = query.match(/after\s+(\d{1,2})\s*(am|pm)?/i);
	if (afterMatch) {
		let h = parseInt(afterMatch[1], 10);
		if (afterMatch[2] && afterMatch[2].toLowerCase() === 'pm' && h < 12) h += 12;
		result.timeRange.start = h;
	}
	const beforeMatch = query.match(/before\s+(\d{1,2})\s*(am|pm)?/i);
	if (beforeMatch) {
		let h = parseInt(beforeMatch[1], 10);
		if (beforeMatch[2] && beforeMatch[2].toLowerCase() === 'pm' && h < 12) h += 12;
		result.timeRange.end = h;
	}

	// Known department codes at UCSB (used to validate uppercase matches)
	const knownDepts = new Set([
		'AM', 'ANTH', 'ART', 'ARTHI', 'BIOE', 'BIOL', 'BMSE', 'BL ST', 'CH ST',
		'CHEM', 'CHIN', 'CLASS', 'CMPSC', 'CMPEN', 'CNCSP', 'COMM', 'COMPL',
		'CS', 'DANCE', 'DYNS', 'EACS', 'EARTH', 'ECE', 'ECON', 'ED', 'EEMB',
		'ENGL', 'ENGR', 'ENV S', 'ESM', 'ESS', 'FEMST', 'FILMD', 'FR', 'GEOG',
		'GER', 'GLOBL', 'GPS', 'GRAD', 'GREEK', 'HIST', 'INT', 'ITALY', 'JAPAN',
		'KOR', 'LATIN', 'LAIS', 'LING', 'MARSC', 'MATRL', 'MATH', 'MCDB', 'ME',
		'MES', 'MILSCI', 'MUS', 'PHIL', 'PHYS', 'POL S', 'PORT', 'PSY', 'PSTAT',
		'RG ST', 'RENST', 'SLAV', 'SOC', 'SPAN', 'SHS', 'TMP', 'THTR', 'WRIT'
	]);

	// Department aliases (lowercase typed words -> canonical dept code(s))
	// Some aliases map to multiple departments using arrays
	const deptAliases = {
		'cs': 'CMPSC', 'cmpsc': 'CMPSC', 'compsci': 'CMPSC', 'computer science': 'CMPSC', 'computer': 'CMPSC',
		'compeng': 'ECE',
		'ee': 'ECE', 'ece': 'ECE', 'matsci': 'MATRL',
		'econ': 'ECON', 'economics': 'ECON',
		'math': 'MATH', 'mathematics': 'MATH',
		'bio': ['EEMB', 'MCDB', 'BIOE'], 'biology': ['EEMB', 'MCDB', 'BIOE'],
		'biolo': ['EEMB', 'MCDB', 'BIOE'], 'biol': ['EEMB', 'MCDB', 'BIOE'],
		'biological': ['EEMB', 'MCDB', 'BIOE'],
		'eemb': 'EEMB', 'ecology': 'EEMB', 'evolution': 'EEMB',
		'mcdb': 'MCDB', 'molecular': 'MCDB', 'cell': 'MCDB',
		'bioe': 'BIOE', 'bioengineering': 'BIOE',
		'chem': 'CHEM', 'chemistry': 'CHEM',
		'phys': 'PHYS', 'physics': 'PHYS',
		'psych': 'PSY', 'psy': 'PSY', 'psychology': 'PSY',
		'stats': 'PSTAT', 'statistics': 'PSTAT', 'pstat': 'PSTAT',
		'comm': 'COMM', 'communication': 'COMM',
		'art': 'ART', 'music': 'MUS', 'mus': 'MUS',
		'hist': 'HIST', 'history': 'HIST',
		'eng': 'ENGL', 'engl': 'ENGL', 'english': 'ENGL',
		'phil': 'PHIL', 'philosophy': 'PHIL',
		'soc': 'SOC', 'sociology': 'SOC',
		'anth': 'ANTH', 'anthropology': 'ANTH',
		'geog': 'GEOG', 'geography': 'GEOG',
		'ling': 'LING', 'linguistics': 'LING',
		'span': 'SPAN', 'spanish': 'SPAN',
		'french': 'FR', 'fr': 'FR',
		'german': 'GER', 'ger': 'GER',
		'japan': 'JAPAN', 'japanese': 'JAPAN',
		'chin': 'CHIN', 'chinese': 'CHIN',
		'dance': 'DANCE', 'theatre': 'THTR', 'theater': 'THTR', 'thtr': 'THTR',
		'writing': 'WRIT', 'writ': 'WRIT',
		'earth': 'EARTH', 'geology': 'EARTH',
		'polisci': 'POL S', 'political science': 'POL S', 'poli sci': 'POL S',
		'environ': 'ENV S', 'environmental': 'ENV S',
		'feminist': 'FEMST', 'femst': 'FEMST', 'film': 'FILMD',
		'electrical': 'ECE',
		'am': 'AM', 'applied math': 'AM', 'applied mathematics': 'AM',
		'engr': 'ENGR', 'engineering': 'ENGR',
		'globl': 'GLOBL', 'global': 'GLOBL',
		'me': 'ME'
	};

	// Extract uppercase dept codes from query text — but only if they are known departments
	const deptPattern = /\b([A-Z]{2,8})\b/g;
	let dm;
	while ((dm = deptPattern.exec(queryText)) !== null) {
		if (knownDepts.has(dm[1]) && !result.departments.includes(dm[1])) {
			result.departments.push(dm[1]);
		}
	}
	// Also check for department aliases in lowercase query
	for (const [alias, dept] of Object.entries(deptAliases)) {
		if (new RegExp(`\\b${alias}\\b`).test(query)) {
			const depts = Array.isArray(dept) ? dept : [dept];
			for (const d of depts) {
				if (!result.departments.includes(d)) result.departments.push(d);
			}
		}
	}

	// Course level
	if (/\bupper\s*div/i.test(query)) result.level = 'upper';
	else if (/\blower\s*div/i.test(query)) result.level = 'lower';

	return result;
}

function filterCoursesNLP(query, courseLookup, deptAverages) {
	if (!courseLookup) return [];
	const parsed = parseNaturalQuery(query);
	const results = [];
	const queryLower = query.toLowerCase().trim();
	const queryWords = queryLower.split(/\s+/).filter(w => w.length >= 2);
	
	// Check if we have any meaningful structured filters
	const hasDeptFilter = parsed.departments.length > 0;
	const hasExactCourse = !!parsed.exactCourseCode;
	const hasDifficulty = !!parsed.difficulty;
	const hasLevel = !!parsed.level;
	const hasStructuredFilter = hasDeptFilter || hasExactCourse || hasDifficulty || hasLevel;
	
	// If no structured filter matched, try keyword/substring matching against course names,
	// professor names, and department names
	const doKeywordSearch = !hasStructuredFilter && queryWords.length > 0;

	for (const [courseName, records] of courseLookup.entries()) {
		for (const rec of records) {
			let score = 0;
			let excluded = false;

			// Exact course code — strongest match (weight: 100)
			if (hasExactCourse) {
				const normTarget = normalizeCourseCode(parsed.exactCourseCode);
				if (normalizeCourseCode(rec.courseName) === normTarget) score += 100;
				else { excluded = true; }
			}

			// Department filter — high weight (50) so it always dominates difficulty/level
			if (!excluded && hasDeptFilter) {
				const dept = (rec.courseName || '').split(/\s+/)[0];
				if (parsed.departments.includes(dept)) score += 50;
				else if (!hasExactCourse) { excluded = true; }
			}

			if (excluded) continue;
			
			// If no dept and no exact code, give a small base score so difficulty/level filters work
			if (hasStructuredFilter && !hasDeptFilter && !hasExactCourse) {
				score += 1;
			}

			// Keyword/substring search — matches course names and professor names
			if (doKeywordSearch) {
				const courseNameLower = (rec.courseName || '').toLowerCase();
				const profLower = (rec.csvProfessor || '').toLowerCase();
				const combined = courseNameLower + ' ' + profLower;
				
				let keywordScore = 0;
				for (const word of queryWords) {
					// Skip common filler words
					if (/^(the|a|an|in|on|at|for|and|or|with|my|is|are|class|classes|course|courses)$/.test(word)) continue;
					if (combined.includes(word)) keywordScore += 5;
					else if (courseNameLower.includes(word)) keywordScore += 5;
					else if (profLower.includes(word)) keywordScore += 8; // professor match is strong
				}
				
				if (keywordScore > 0) {
					score += keywordScore;
				} else {
					// No keyword matched — skip this record
					continue;
				}
			}

			// Difficulty — secondary modifier (weight: 5), never overrides dept/course
			const gpa = parseFloat(rec.avgGpa);
			if (hasDifficulty && !isNaN(gpa)) {
				if (parsed.difficulty === 'easy' && gpa >= 3.5) score += 5;
				else if (parsed.difficulty === 'hard' && gpa <= 2.8) score += 5;
				else if (parsed.difficulty === 'moderate' && gpa > 2.8 && gpa < 3.5) score += 5;
				else score -= 2;
			}

			// Course level — secondary modifier (weight: 3)
			const numMatch = (rec.courseName || '').match(/\d+/);
			const courseNum = numMatch ? parseInt(numMatch[0], 10) : 0;
			if (hasLevel) {
				if (parsed.level === 'upper' && courseNum >= 100) score += 3;
				else if (parsed.level === 'lower' && courseNum < 100) score += 3;
				else if (courseNum > 0) score -= 1;
			}

			if (score > 0) {
				// Compute grade inflation index vs dept average
				const dept = (rec.courseName || '').split(/\s+/)[0];
				const deptAvg = deptAverages && deptAverages.get ? deptAverages.get(dept) : null;
				let inflationDelta = null;
				if (!isNaN(gpa) && deptAvg && !isNaN(deptAvg)) {
					inflationDelta = +(gpa - deptAvg).toFixed(2);
				}
				results.push({ course: rec, score, inflationDelta });
			}
		}
	}

	results.sort((a, b) => b.score - a.score);
	return results.slice(0, 20);
}

function computeDeptAverages(courseLookup) {
	if (!courseLookup) return new Map();
	const sums = new Map();
	for (const [, records] of courseLookup.entries()) {
		for (const rec of records) {
			const dept = (rec.courseName || '').split(/\s+/)[0];
			const gpa = parseFloat(rec.avgGpa);
			if (!dept || isNaN(gpa)) continue;
			const entry = sums.get(dept) || { total: 0, count: 0 };
			entry.total += gpa;
			entry.count += 1;
			sums.set(dept, entry);
		}
	}
	const avgs = new Map();
	for (const [dept, { total, count }] of sums.entries()) {
		if (count > 0) avgs.set(dept, total / count);
	}
	return avgs;
}

/**
 * Normalize a string for loose comparison: strip non-alphanumerics, lowercase.
 */
function normalizeForComparison(str) {
	return String(str || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * Find the DOM row(s) matching a course code, using multiple strategies.
 * Returns an element to scroll to, or null.
 */
function findCourseRowInDOM(courseName) {
	const normalizedTarget = normalizeForComparison(courseName);
	const courseRegex = /\b([A-Z]{2,8})\s+(\d+[A-Z]*)\b/gi;

	// Strategy 1: Look for any element whose text content matches the course code
	// after normalization (strip all non-alnum, case-insensitive)
	const allCells = document.querySelectorAll('td, th, span, div, a, strong, b');
	for (const cell of allCells) {
		const text = (cell.textContent || '').trim();
		if (!text) continue;
		// Only consider cells whose own direct text is short-ish (course title cells)
		if (text.length > 120) continue;

		const cellNorm = normalizeForComparison(text);
		if (cellNorm.includes(normalizedTarget)) {
			// Found it — prefer the closest <tr> ancestor
			const tr = cell.closest && cell.closest('tr');
			return tr || cell;
		}
	}

	// Strategy 2: Scan all <tr> rows for child text nodes matching the course regex
	const allRows = document.querySelectorAll('tr');
	for (const row of allRows) {
		const rowText = (row.textContent || '').replace(/\s+/g, ' ');
		let match;
		courseRegex.lastIndex = 0;
		while ((match = courseRegex.exec(rowText)) !== null) {
			const found = normalizeForComparison(`${match[1]} ${match[2]}`);
			if (found === normalizedTarget) return row;
		}
	}

	// Strategy 3: Broader search — any element containing the course code pattern
	const everything = document.querySelectorAll('*');
	for (const el of everything) {
		if (el.children.length > 5) continue; // skip large containers
		const t = (el.textContent || '').trim();
		if (t.length > 200) continue;
		courseRegex.lastIndex = 0;
		let m;
		while ((m = courseRegex.exec(t)) !== null) {
			if (normalizeForComparison(`${m[1]} ${m[2]}`) === normalizedTarget) {
				return el.closest('tr') || el;
			}
		}
	}

	return null;
}

/**
 * Scroll to an element with an offset (to clear fixed headers / search bar)
 * and flash-highlight it so the user can see where to look.
 */
function scrollToAndFlash(element) {
	if (!element) return;
	const rect = element.getBoundingClientRect();
	const absoluteY = rect.top + window.pageYOffset;
	window.scrollTo({ top: absoluteY - 150, behavior: 'smooth' });

	// Flash highlight
	element.classList.add('rmg-flash-highlight');
	setTimeout(() => element.classList.remove('rmg-flash-highlight'), 1800);
}

async function renderNLPSearchBar() {
	// Avoid duplicate
	if (document.querySelector('.rmg-nlp-search')) return;

	const courseLookup = await ensureCoursesLoaded();
	if (!courseLookup) return;

	const deptAverages = computeDeptAverages(courseLookup);

	// Build UI
	const container = document.createElement('div');
	container.className = 'rmg-nlp-search';

	const input = document.createElement('input');
	input.type = 'text';
	input.className = 'rmg-nlp-input';
	input.placeholder = "Try: 'Easy CMPSC classes on MWF mornings'";

	const resultsPanel = document.createElement('div');
	resultsPanel.className = 'rmg-nlp-results';
	resultsPanel.style.display = 'none';

	container.appendChild(input);
	container.appendChild(resultsPanel);
	document.body.appendChild(container);

	let debounceTimer = null;

	input.addEventListener('input', () => {
		clearTimeout(debounceTimer);
		const q = input.value.trim();
		if (q.length < 3) { resultsPanel.style.display = 'none'; return; }
		debounceTimer = setTimeout(() => {
			const matches = filterCoursesNLP(q, courseLookup, deptAverages);
			renderResults(matches);
		}, 250);
	});

	// Close on outside click
	document.addEventListener('click', (e) => {
		if (!container.contains(e.target)) resultsPanel.style.display = 'none';
	});

	function renderResults(matches) {
		resultsPanel.innerHTML = '';
		if (matches.length === 0) {
			const noRes = document.createElement('div');
			noRes.className = 'rmg-nlp-no-results';
			noRes.textContent = 'No matching courses found.';
			resultsPanel.appendChild(noRes);
			resultsPanel.style.display = 'block';
			return;
		}

		for (const result of matches) {
			const item = document.createElement('div');
			item.className = 'rmg-nlp-result-item';

			const code = document.createElement('span');
			code.className = 'rmg-nlp-result-code';
			code.textContent = result.course.courseName || '';

			const prof = document.createElement('span');
			prof.className = 'rmg-nlp-result-prof';
			prof.textContent = result.course.csvProfessor ? `Professor: ${result.course.csvProfessor}` : '';

			const gpa = document.createElement('span');
			gpa.className = 'rmg-nlp-result-gpa';
			const avgGpa = parseFloat(result.course.avgGpa);
			gpa.textContent = !isNaN(avgGpa) ? `Avg GPA: ${avgGpa.toFixed(2)}` : '';

			item.appendChild(code);
			item.appendChild(prof);
			item.appendChild(gpa);

			// Grade inflation chip
			if (result.inflationDelta !== null) {
				const chip = document.createElement('span');
				chip.className = 'rmg-nlp-result-inflation';
				if (result.inflationDelta > 0.15) {
					chip.textContent = `+${result.inflationDelta.toFixed(2)} GPA (Easier than avg)`;
					chip.classList.add('rmg-grade-inflation--easier');
				} else if (result.inflationDelta < -0.15) {
					chip.textContent = `${result.inflationDelta.toFixed(2)} GPA (Harder than avg)`;
					chip.classList.add('rmg-grade-inflation--harder');
				} else {
					chip.textContent = '(Near dept avg)';
					chip.classList.add('rmg-grade-inflation--near');
				}
				chip.style.whiteSpace = 'nowrap';
				chip.style.flexShrink = '0';
				item.appendChild(chip);
			}

			// Click handler: scroll to the course on the page
			item.addEventListener('click', () => {
				const courseName = result.course.courseName || '';
				const target = findCourseRowInDOM(courseName);
				if (target) {
					scrollToAndFlash(target);
				} else {
					console.warn('[RateMyGaucho] Could not find DOM element for course:', courseName);
					// Visual feedback that it wasn't found on this page
					item.style.background = '#fff0f0';
					setTimeout(() => { item.style.background = ''; }, 800);
				}
				resultsPanel.style.display = 'none';
			});

			resultsPanel.appendChild(item);
		}
		resultsPanel.style.display = 'block';
	}
}
