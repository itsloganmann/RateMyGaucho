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
			if (!res.ok) return null;
			const csvText = await res.text();
			const records = parseCsv(csvText);
			__rmg_lookup = buildLookup(records);
			return __rmg_lookup;
		} catch (_e) {
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
			const csvUrl = chrome.runtime.getURL('ucsb_courses_final_corrected.csv');
			const res = await fetch(csvUrl);
			if (!res.ok) return null;
			const csvText = await res.text();
			const records = parseCourseCsv(csvText);
			__rmg_course_lookup = buildCourseLookup(records);
			// Store globally for extractCourseCode validation
			window.__rmg_course_lookup = __rmg_course_lookup;
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
			
			const rec = {
				courseName: (row.course_name || '').trim(),
				courseUrl: (row.course_url || '').trim(),
				gradingBasis: (row.grading_basis || '').trim(),
				gradingTrend: parseJsonArray(row.grading_trend),
				enrollmentTrend: parseJsonArray(row.enrollment_trend),
				recentReviews: parseJsonArray(row.recent_reviews)
			};
			
			out.push(rec);
		}
		
		console.log('[RateMyGaucho] Parsed', out.length, 'course records');
		if (out.length > 0) {
			console.log('[RateMyGaucho] Sample course records:', out.slice(0, 3));
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
	for (const review of reviews) {
		const text = String(review || '').toLowerCase();
		
		// Use word boundaries to avoid false matches like "ang" in "change"
		const lastRegex = new RegExp(`\\b${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
		
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
			const courseList = courseCode && courseLookup ? courseLookup.get(normalizeCourseCode(courseCode)) : null;
			const courseData = Array.isArray(courseList) ? pickCourseDataForInstructor(courseList, match) : null;
			
			if (courseCode) {
				console.log('[RateMyGaucho] Extracted course code:', courseCode, 'normalized:', normalizeCourseCode(courseCode));
			}
			
			if (match) {
				matchedCount++;
				console.log('[RateMyGaucho] MATCHED:', info.raw, '->', match.firstName, match.lastName, match.rmpScore);
				if (courseData) {
					courseFoundCount++;
					const filterStatus = courseData._reviewsFiltered ? '(filtered)' : '(fallback)';
					console.log('[RateMyGaucho] Course data chosen for instructor:',
						`${match.firstName} ${match.lastName}`, '->', courseData.courseName,
						'filteredReviews:', Array.isArray(courseData.recentReviews) ? courseData.recentReviews.length : 0, filterStatus);
				}
				// Gate course data: only show when reviews specifically mention the matched professor
				const gatedCourseData = (courseData && courseData._reviewsFiltered && Array.isArray(courseData.recentReviews) && courseData.recentReviews.length > 0)
					? courseData
					: null;
				
				if (courseData && !gatedCourseData) {
					console.log('[RateMyGaucho] SKIPPED course data for', `${match.firstName} ${match.lastName}`, '- no instructor-specific reviews found');
				}
				
				renderCard(node, match, gatedCourseData);
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


	const badge = document.createElement('span');
	badge.className = 'rmg-badge';
	badge.textContent = rating.toFixed(1);
	badge.classList.add(
		rating >= 4 ? 'rmg-badge--good' : rating >= 3 ? 'rmg-badge--ok' : 'rmg-badge--bad'
	);

	// Removed title/name display as requested

	const sub = document.createElement('span');
	sub.className = 'rmg-subtle';
	sub.textContent = `${record.numReviews} reviews`;

	const stars = document.createElement('div');
	stars.className = 'rmg-stars';
	
	// Create 5 gaucho star images with precise tenths-based partial fills
	for (let i = 0; i < 5; i++) {
		const starContainer = document.createElement('div');
		starContainer.className = 'rmg-star-container';
		
		// Create background (empty) star
		const emptyStar = document.createElement('img');
		emptyStar.src = chrome.runtime.getURL('gaucho.png');
		emptyStar.className = 'rmg-star rmg-star--empty';
		emptyStar.alt = '★';
		
		// Create filled star overlay
		const filledStar = document.createElement('img');
		filledStar.src = chrome.runtime.getURL('gaucho.png');
		filledStar.className = 'rmg-star rmg-star--filled';
		filledStar.alt = '★';
		
		// Calculate precise fill percentage for this star based on tenths
		const starValue = i + 1;
		let fillPercentage = 0;
		
		if (rating >= starValue) {
			// Fully filled star
			fillPercentage = 100;
		} else if (rating > starValue - 1) {
			// Partially filled star - calculate exact percentage based on tenths
			const partialRating = rating - (starValue - 1);
			fillPercentage = Math.max(0, Math.min(100, partialRating * 100));
		}
		
		// Apply the fill percentage as a CSS custom property
		starContainer.style.setProperty('--fill-percentage', `${fillPercentage}%`);
		
		starContainer.appendChild(emptyStar);
		starContainer.appendChild(filledStar);
		stars.appendChild(starContainer);
	}

	// Meta line for additional info if present
	const meta = document.createElement('span');
	meta.className = 'rmg-meta';
	meta.textContent = ''; // No additional meta info in the complete list CSV

	// Inline meter that fills proportionally to rating
	const meter = document.createElement('div');
	meter.className = 'rmg-meter';
	const bar = document.createElement('span');
	meter.appendChild(bar);

	const actions = document.createElement('div');
	actions.className = 'rmg-actions';

	const link = document.createElement('a');
	link.className = 'rmg-link';
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	link.href = record.profileUrl || 'https://ucsbplat.com/instructor/';
	link.textContent = 'UCSB Plat';

	// Course data section
	let courseInfo = null;
	if (courseData) {
		courseInfo = document.createElement('div');
		courseInfo.className = 'rmg-course-info';
		
		// Course name
		const courseName = document.createElement('div');
		courseName.className = 'rmg-course-name';
		courseName.textContent = courseData.courseName;
		courseInfo.appendChild(courseName);
		
		// Grading basis
		if (courseData.gradingBasis) {
			const gradingBasis = document.createElement('div');
			gradingBasis.className = 'rmg-course-detail';
			gradingBasis.textContent = `Grading: ${courseData.gradingBasis}`;
			courseInfo.appendChild(gradingBasis);
		}
		
		// Grading trend
		if (courseData.gradingTrend && courseData.gradingTrend.length > 0) {
			const gradingTrend = document.createElement('div');
			gradingTrend.className = 'rmg-course-detail';
			gradingTrend.textContent = `Grade Trend: ${courseData.gradingTrend.join(', ')}`;
			courseInfo.appendChild(gradingTrend);
		}
		
		// Enrollment trend
		if (courseData.enrollmentTrend && courseData.enrollmentTrend.length > 0) {
			const enrollmentTrend = document.createElement('div');
			enrollmentTrend.className = 'rmg-course-detail';
			enrollmentTrend.textContent = `Enrollment: ${courseData.enrollmentTrend.join(' → ')}`;
			courseInfo.appendChild(enrollmentTrend);
		}
		
		// Recent reviews
		if (courseData.recentReviews && courseData.recentReviews.length > 0) {
			const reviewsContainer = document.createElement('div');
			reviewsContainer.className = 'rmg-course-reviews';
			
			const reviewsTitle = document.createElement('div');
			reviewsTitle.className = 'rmg-course-reviews-title';
			reviewsTitle.textContent = 'Recent Reviews:';
			reviewsContainer.appendChild(reviewsTitle);
			
			// Show up to 2 most recent reviews, truncated
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
		
		// Course URL link
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

	card.appendChild(badge);
	card.appendChild(stars);
	card.appendChild(sub);
	if (courseInfo) {
		card.appendChild(courseInfo);
	}
	card.appendChild(meter);
	actions.appendChild(link);
	card.appendChild(actions);

	// Prefer inserting inside the same table cell to avoid invalid DOM under <tr>
	try {
		const cell = anchorNode.closest && anchorNode.closest('td,th');
		if (cell) {
			cell.appendChild(card);
		} else {
			anchorNode.insertAdjacentElement('afterend', card);
		}
	} catch (_e) {
		// Last-resort fallback: append near the anchor's parent
		(anchorNode.parentElement || document.body).appendChild(card);
	}

	// Animate meter fill after insertion
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
