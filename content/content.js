(function debugBanner(){ try { console.log('[RateMyGaucho] content v1.1.0 at', location.href); } catch(_){} })();

// Check if Papa Parse is available immediately
console.log('[RateMyGaucho] Papa Parse check:', typeof Papa !== 'undefined' ? 'Available' : 'NOT AVAILABLE');
if (typeof Papa === 'undefined') {
	console.error('[RateMyGaucho] CRITICAL: Papa Parse failed to load! Course metadata will not work.');
}

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

// Course data cache
let __rmg_courseLookup = null;
let __rmg_courseLoading = null;

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

// Simple CSV parser fallback for when Papa Parse fails
function parseSimpleCsv(csvText) {
	const lines = csvText.split(/\r?\n/).filter(Boolean);
	if (!lines.length) return [];
	
	const headers = lines[0].split(',').map(h => h.trim());
	const records = [];
	
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim()) continue;
		
		// Simple parsing - won't handle all edge cases but should work for basic data
		const values = [];
		let current = '';
		let inQuotes = false;
		
		for (let j = 0; j < line.length; j++) {
			const char = line[j];
			if (char === '"' && (j === 0 || line[j-1] !== '\\')) {
				inQuotes = !inQuotes;
			} else if (char === ',' && !inQuotes) {
				values.push(current.trim());
				current = '';
			} else {
				current += char;
			}
		}
		values.push(current.trim());
		
		if (values.length >= headers.length) {
			const record = {};
			headers.forEach((header, idx) => {
				record[header] = values[idx] || '';
			});
			records.push(record);
		}
	}
	
	return records;
}

async function ensureCourseDataLoaded() {
	console.log('[RateMyGaucho] ensureCourseDataLoaded() called');
	if (__rmg_courseLookup) {
		console.log('[RateMyGaucho] Course lookup already cached, returning');
		return __rmg_courseLookup;
	}
	if (__rmg_courseLoading) {
		console.log('[RateMyGaucho] Course loading in progress, waiting...');
		return __rmg_courseLoading;
	}
	
	console.log('[RateMyGaucho] Starting new course data loading...');
	__rmg_courseLoading = (async () => {
		try {
			console.log('[RateMyGaucho] Starting course data load...');
			const csvUrl = chrome.runtime.getURL('ucsb_courses_final_corrected.csv');
			console.log('[RateMyGaucho] Fetching CSV from:', csvUrl);
			
			const res = await fetch(csvUrl);
			if (!res.ok) {
				console.log('[RateMyGaucho] Failed to fetch course CSV:', res.status);
				return null;
			}
			
			const csvText = await res.text();
			console.log('[RateMyGaucho] Course CSV loaded, length:', csvText.length);
			
			let records;
			
			// Try Papa Parse first if available
			if (typeof Papa !== 'undefined') {
				console.log('[RateMyGaucho] Using Papa Parse for CSV parsing');
				const results = Papa.parse(csvText, { 
					header: true, 
					skipEmptyLines: true,
					transformHeader: (header) => header.trim()
				});
				
				if (results.errors.length > 0) {
					console.log('[RateMyGaucho] Papa Parse errors:', results.errors.slice(0, 3));
				}
				
				records = results.data;
			} else {
				// Use fallback parser
				console.log('[RateMyGaucho] Using fallback CSV parser');
				records = parseSimpleCsv(csvText);
			}
			
			console.log('[RateMyGaucho] Course records parsed:', records.length);
			__rmg_courseLookup = buildCourseLookup(records);
			console.log('[RateMyGaucho] Course lookup built, entries:', __rmg_courseLookup.size);
			return __rmg_courseLookup;
		} catch (_e) {
			console.error('[RateMyGaucho] Failed to load course data:', _e);
			return null;
		} finally {
			__rmg_courseLoading = null;
		}
	})();
	return __rmg_courseLoading;
}

function normalizeCourseCode(s) {
	return (s || '')
		.replace(/\s+/g, ' ')
		.trim()
		.toUpperCase();
}

function buildCourseLookup(records) {
	const map = new Map();
	let processed = 0, skipped = 0;
	
	for (const rec of records) {
		if (!rec.course_name) {
			skipped++;
			continue;
		}
		try {
			// Process the record fields
			const processedRec = {
				courseName: (rec.course_name || '').trim(),
				courseUrl: (rec.course_url || '').trim(),
				gradingBasis: (rec.grading_basis || '').trim(),
				gradingTrend: parseArrayField(rec.grading_trend),
				enrollmentTrend: parseArrayField(rec.enrollment_trend),
				recentReviews: parseArrayField(rec.recent_reviews)
			};
			
			const normalizedCode = normalizeCourseCode(processedRec.courseName);
			if (normalizedCode) {
				map.set(normalizedCode, processedRec);
				processed++;
				
				// Log first few entries for debugging
				if (processed <= 3) {
					console.log('[RateMyGaucho] Course entry:', normalizedCode, '->', processedRec);
				}
			} else {
				skipped++;
			}
		} catch (e) {
			skipped++;
			continue;
		}
	}
	
	console.log(`[RateMyGaucho] Course lookup: processed ${processed}, skipped ${skipped}`);
	return map;
}

function parseArrayField(field) {
	if (!field) return [];
	if (Array.isArray(field)) return field;
	
	let str = String(field).trim();
	
	// Handle CSV export artifacts like ="[...]"
	if (str.startsWith('="') && str.endsWith('"')) {
		str = str.slice(2, -1);
	} else if (str.startsWith('=') && str.startsWith('[', 1) && str.endsWith(']')) {
		str = str.slice(1);
	}
	
	// Try to parse as JSON array
	if (str.startsWith('[') && str.endsWith(']')) {
		try {
			return JSON.parse(str);
		} catch {
			// If JSON parse fails, return empty array
			return [];
		}
	}
	
	// Return as single-item array if not parseable
	return str ? [str] : [];
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

function extractCourseCodeFromRow(row) {
	if (!row) return null;
	
	// Strategy 1: Look for course section headers ABOVE the current instructor row
	// UCSB GOLD typically has course headers separate from instructor detail rows
	let bestMatch = null;
	
	// Find the container (table or section) that holds this row
	const container = row.closest('table, .course-section, .results-section') || row.parentElement;
	
	if (container) {
		// Get all elements in the container that might contain course headers
		const allElements = Array.from(container.querySelectorAll('*'));
		const rowIndex = allElements.indexOf(row);
		
		// Search backwards from current row to find course headers
		// Look up to 20 elements back to find the course title
		for (let i = Math.max(0, rowIndex - 20); i < rowIndex; i++) {
			const element = allElements[i];
			const text = (element.textContent || '').trim();
			
			// Skip very short or very long text, and common non-course elements
			if (!text || text.length < 5 || text.length > 150) continue;
			if (/^(Days|Time|Location|Instructor|Space|Max|Add|Save|Cancel)$/i.test(text)) continue;
			
			// Look for course patterns in potential header text
			let courseMatch = null;
			
			// Pattern 1: "ANTH 3 - INTRO ARCH" (most common GOLD format)
			courseMatch = text.match(/^([A-Z]{2,6})\s+(\d{1,3}[A-Z]?)\s*[-–]\s*(.+)/);
			if (courseMatch) {
				bestMatch = `${courseMatch[1]} ${courseMatch[2]}`;
				console.log('[RateMyGaucho] Found course header pattern 1:', bestMatch, 'from:', text.slice(0, 50));
				break;
			}
			
			// Pattern 2: Just "ANTH 3" at start of text
			courseMatch = text.match(/^([A-Z]{2,6})\s+(\d{1,3}[A-Z]?)(?:\s|$)/);
			if (courseMatch) {
				bestMatch = `${courseMatch[1]} ${courseMatch[2]}`;
				console.log('[RateMyGaucho] Found course header pattern 2:', bestMatch, 'from:', text.slice(0, 50));
				break;
			}
			
			// Pattern 3: Course code within text (more permissive)
			courseMatch = text.match(/\b([A-Z]{2,6})\s+(\d{1,3}[A-Z]?)\b/);
			if (courseMatch && !bestMatch && !/Location|Building|Hall|Room/.test(text)) {
				bestMatch = `${courseMatch[1]} ${courseMatch[2]}`;
				console.log('[RateMyGaucho] Found course header pattern 3:', bestMatch, 'from:', text.slice(0, 50));
			}
		}
	}
	
	// Strategy 2: If no header found, try DOM traversal upward
	if (!bestMatch) {
		let currentElement = row.parentElement;
		let depth = 0;
		
		while (currentElement && depth < 5) {
			// Look for elements with course-like content near this row
			const siblings = Array.from(currentElement.children);
			const rowPosition = siblings.indexOf(row.closest('tr, div, section')) || 0;
			
			// Check previous siblings for course headers
			for (let i = Math.max(0, rowPosition - 3); i < rowPosition; i++) {
				const sibling = siblings[i];
				if (!sibling) continue;
				
				const text = (sibling.textContent || '').trim();
				if (text.length < 5 || text.length > 100) continue;
				
				const courseMatch = text.match(/^([A-Z]{2,6})\s+(\d{1,3}[A-Z]?)(?:\s*[-–]|\s|$)/);
				if (courseMatch) {
					bestMatch = `${courseMatch[1]} ${courseMatch[2]}`;
					console.log('[RateMyGaucho] Found course via DOM traversal:', bestMatch, 'from:', text.slice(0, 50));
					break;
				}
			}
			
			if (bestMatch) break;
			currentElement = currentElement.parentElement;
			depth++;
		}
	}
	
	// Debug: if still no match, show what we're dealing with
	if (!bestMatch) {
		const contextElements = [];
		let current = row.parentElement;
		for (let i = 0; i < 3 && current; i++) {
			const text = (current.textContent || '').trim();
			if (text && text.length < 200) {
				contextElements.push(text.slice(0, 80));
			}
			current = current.parentElement;
		}
		console.log('[RateMyGaucho] Course code search failed. Context:', contextElements.slice(0, 2));
	}
	
	return bestMatch;
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
		
		// Load both datasets in parallel
		console.log('[RateMyGaucho] Loading professor and course data in parallel...');
		const [lookup, courseLookup] = await Promise.all([
			ensureRatingsLoaded(),
			ensureCourseDataLoaded()
		]);
		console.log('[RateMyGaucho] Parallel loading complete. Professor data:', !!lookup, 'Course data:', !!courseLookup);
		if (!lookup) return;
		const sample = nodes.slice(0, 5).map(n => (n.textContent||'').trim().replace(/\s+/g,' '));
		console.log('[RateMyGaucho] sample candidate texts:', sample);
		
		let matchedCount = 0;
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
			
			// Extract course code from the same row and context
			const row = node.closest('tr, .row, .resultsRow, .SSR_CLSRSLT_WRK, .sectionRow, .CourseRow');
			
			// Enhanced course code extraction with more context
			let courseCode = null;
			
			if (row) {
				// Try multiple extraction strategies
				courseCode = extractCourseCodeFromRow(row);
				
				// If no course code found, try looking at the table structure
				if (!courseCode) {
					const table = row.closest('table');
					if (table) {
						// Look for course title in previous rows within the same table
						const allRows = Array.from(table.querySelectorAll('tr'));
						const currentRowIndex = allRows.indexOf(row);
						
						// Check 5 rows before current row for course titles
						for (let i = Math.max(0, currentRowIndex - 5); i < currentRowIndex; i++) {
							const prevRow = allRows[i];
							const courseMatch = extractCourseCodeFromRow(prevRow);
							if (courseMatch) {
								courseCode = courseMatch;
								console.log('[RateMyGaucho] Course code found in previous row', i, ':', courseCode);
								break;
							}
						}
					}
				}
			}
			
			const courseRec = courseLookup && courseCode ? courseLookup.get(normalizeCourseCode(courseCode)) : null;
			
			if (courseCode) {
				const normalizedCode = normalizeCourseCode(courseCode);
				console.log('[RateMyGaucho] Course code found:', courseCode, 'normalized to:', normalizedCode);
				
				if (courseRec) {
					console.log('[RateMyGaucho] Course matched:', courseCode, '->', courseRec.courseName);
				} else {
					console.log('[RateMyGaucho] Course not found in lookup:', normalizedCode);
					// Debug: show similar entries to help identify the issue
					if (courseLookup) {
						const similarCourses = Array.from(courseLookup.keys())
							.filter(key => key.startsWith(normalizedCode.split(' ')[0]))
							.slice(0, 3);
						console.log('[RateMyGaucho] Similar courses in lookup:', similarCourses);
					}
				}
			} else if (row) {
				console.log('[RateMyGaucho] No course code found in row for instructor:', info.raw);
			}
			
			const match = matchInstructor(info, lookup);
			if (match) {
				matchedCount++;
				console.log('[RateMyGaucho] MATCHED:', info.raw, '->', match.firstName, match.lastName, match.rmpScore);
				renderCard(node, match, courseRec);
			} else {
				console.log('[RateMyGaucho] NO MATCH for:', info.raw);
			}
		}
		
		console.log(`[RateMyGaucho] Summary: ${matchedCount}/${totalProcessed} instructors matched`);
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

function renderCard(anchorNode, record, courseRec = null) {
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

	// Course metadata section
	if (courseRec) {
		const courseMeta = renderCourseMeta(courseRec);
		if (courseMeta) {
			card.appendChild(courseMeta);
		}
	}

	const actions = document.createElement('div');
	actions.className = 'rmg-actions';

	const link = document.createElement('a');
	link.className = 'rmg-link';
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	link.href = record.profileUrl || 'https://ucsbplat.com/instructor/';
	link.textContent = 'UCSB Plat';

	// Removed Courses button as requested

	card.appendChild(badge);
	card.appendChild(stars);
	card.appendChild(sub);
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

function renderCourseMeta(courseRec) {
	const courseMeta = document.createElement('div');
	courseMeta.className = 'rmg-course';

	// Grading Basis chip
	if (courseRec.gradingBasis) {
		const chip = document.createElement('span');
		chip.className = 'rmg-chip';
		chip.textContent = courseRec.gradingBasis;
		courseMeta.appendChild(chip);
	}

	// Enrollment Trend Sparkline
	if (courseRec.enrollmentTrend && courseRec.enrollmentTrend.length > 1) {
		const enrollSpark = document.createElement('div');
		enrollSpark.className = 'rmg-spark rmg-spark--enroll';
		enrollSpark.setAttribute('aria-label', `Enrollment trend: ${courseRec.enrollmentTrend.join(', ')}`);
		
		const maxVal = Math.max(...courseRec.enrollmentTrend.filter(v => typeof v === 'number' && !isNaN(v)));
		if (maxVal > 0) {
			courseRec.enrollmentTrend.forEach(val => {
				if (typeof val === 'number' && !isNaN(val)) {
					const bar = document.createElement('span');
					bar.style.height = `${Math.max(2, (val / maxVal) * 16)}px`;
					bar.title = `Enrollment: ${val}`;
					enrollSpark.appendChild(bar);
				}
			});
			courseMeta.appendChild(enrollSpark);
		}
	}

	// Grading Trend
	if (courseRec.gradingTrend && courseRec.gradingTrend.length > 0) {
		const gradeSpark = document.createElement('div');
		gradeSpark.className = 'rmg-spark rmg-spark--grade';
		gradeSpark.setAttribute('aria-label', `Grading trend: ${courseRec.gradingTrend.join(' ')}`);
		
		courseRec.gradingTrend.slice(0, 8).forEach(grade => {
			if (typeof grade === 'string' && grade.trim()) {
				const tick = document.createElement('span');
				tick.title = `Grade: ${grade}`;
				tick.textContent = grade.charAt(0);
				gradeSpark.appendChild(tick);
			}
		});
		
		if (gradeSpark.children.length > 0) {
			courseMeta.appendChild(gradeSpark);
		}
	}

	// Recent Review snippet
	if (courseRec.recentReviews && courseRec.recentReviews.length > 0) {
		const firstReview = courseRec.recentReviews[0];
		if (typeof firstReview === 'string' && firstReview.trim()) {
			const quote = document.createElement('div');
			quote.className = 'rmg-quote';
			// Truncate to ~120 chars with ellipsis
			const reviewText = firstReview.length > 120 ? 
				firstReview.slice(0, 120) + '…' : firstReview;
			quote.textContent = `"${reviewText}"`;
			courseMeta.appendChild(quote);
		}
	}

	return courseMeta.children.length > 0 ? courseMeta : null;
}
