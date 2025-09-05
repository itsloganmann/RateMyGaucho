(function debugBanner(){ try { console.log('[RateMyGaucho] content v1.0.4 at', location.href); } catch(_){} })();

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

async function ensureRatingsLoaded() {
	if (__rmg_lookup) return __rmg_lookup;
	if (__rmg_loading) return __rmg_loading;
	__rmg_loading = (async () => {
		try {
			const csvUrl = chrome.runtime.getURL('data/ucsb_professors_rmp.csv');
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
		if (cols.length < 5) continue;
		const [department, first_name, last_name, rmp_score, num_reviews, difficulty, would_take_again] = cols;
		const rec = {
			department: (department||'').trim(),
			firstName: (first_name||'').trim(),
			lastName: (last_name||'').trim(),
			rmpScore: Number(rmp_score),
			numReviews: Number(num_reviews),
			difficulty: difficulty !== undefined ? Number(difficulty) : undefined,
			wouldTakeAgain: would_take_again !== undefined ? Number(would_take_again) : undefined
		};
		if (!Number.isFinite(rec.rmpScore) || !Number.isFinite(rec.numReviews)) continue;
		out.push(rec);
	}
	return out;
}

function buildLookup(records) {
	const map = new Map();
	for (const rec of records) {
		const deptKey = makeKey(rec.lastName, rec.firstName, rec.department);
		const anyKey = makeKey(rec.lastName, rec.firstName, '');
		(map.get(deptKey) || map.set(deptKey, []).get(deptKey)).push(rec);
		(map.get(anyKey) || map.set(anyKey, []).get(anyKey)).push(rec);
	}
	return map;
}

function normalizeName(s = '') {
	return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function makeKey(last, first, dept) {
	const ln = normalizeName(last);
	const fi = normalizeName(first).slice(0, 1);
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
		if (!lookup) return;
		const sample = nodes.slice(0, 3).map(n => (n.textContent||'').trim().replace(/\s+/g,' '));
		console.log('[RateMyGaucho] sample candidate texts:', sample);
		for (const node of nodes) {
			if (node.dataset.rmgInitialized === '1') continue;
			node.dataset.rmgInitialized = '1';
			const info = extractInstructorInfo(node);
			const match = matchInstructor(info, lookup);
			if (match) renderCard(node, match);
		}
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
			if (score >= 4) {
				const row = cell.closest && cell.closest('tr, .row, .resultsRow, .SSR_CLSRSLT_WRK, .sectionRow, .CourseRow');
				if (!row) continue;
				const hasAdd = !!Array.from(row.querySelectorAll('a,button,input')).find(el => /add/i.test((el.textContent || el.value || '').trim()));
				if (hasAdd) set.add(cell);
			}
		}
	} catch {}

	return Array.from(set);
}

function nameScore(txt) {
	const clean = txt.trim().replace(/\s+/g, ' ');
	if (!clean) return 0;
	// Immediately reject obvious non-name cells
	if (/(Space|Max|Units|Building|Hall|Room|Course|Info|Final|Save|Cart|Closed|Open)/i.test(clean)) return 0;
	if (/\d{2,}/.test(clean)) return 0;
	const words = clean.split(' ').filter(Boolean);
	let score = 0;
	// "Last, First" pattern
	if (/,\s*[A-Za-z]/.test(clean)) score += 3;
	// "First Last" (require at least two words)
	if (words.length >= 2 && /^[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,3}$/.test(clean)) score += 3;
	// "LAST I N" pattern (all caps last + initials)
	if (/^[A-Z][A-Z'\-]+(?:\s+[A-Z](?:\.|\b)){1,3}$/.test(clean)) score += 3;
	// Bonus for presence of initials tokens
	if (words.some(w => w.length === 1 || /\.$/.test(w))) score += 1;
	// Reasonable length
	if (clean.length <= 40) score += 1;
	return score;
}

function extractInstructorInfo(node) {
	const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
	const names = text.split(/;|\u00a0|\/|,\s*(?=[A-Z])|\sand\s/i).map(s => s.trim()).filter(Boolean);
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
	}
	if (clean.includes(',')) {
		const [last, rest] = clean.split(',').map(s => s.trim());
		const first = (rest || '').split(' ')[0] || '';
		keys.push(makeKey(last, first, dept));
	}
	const parts = clean.split(' ').filter(Boolean);
	if (parts.length >= 2) {
		// Treat as "First ... Last"
		keys.push(makeKey(parts[parts.length - 1], parts[0], dept));
		// Treat as "Last First [Middle...]"
		keys.push(makeKey(parts[0], parts[1], dept));
	}
	const withoutDept = Array.from(keys).map(k => k.replace(/\|[^|]*$/, '|'));
	for (const k of withoutDept) keys.push(k);
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

function renderCard(anchorNode, record) {
	const card = document.createElement('div');
	const rating = Number(record.rmpScore || 0);
	card.className = 'rmg-card ' + (rating >= 4 ? 'rmg-good' : rating >= 3 ? 'rmg-ok' : 'rmg-bad');

	function slugifyForPlat(lastName, firstName) {
		const ln = (lastName || '').toUpperCase().replace(/[^A-Z]/g, '');
		const fi = (firstName || '').toUpperCase().replace(/[^A-Z]/g, '');
		if (!ln) return '';
		return `${ln} ${fi}`.trim();
	}

	const badge = document.createElement('span');
	badge.className = 'rmg-badge';
	badge.textContent = rating.toFixed(1);
	badge.classList.add(
		rating >= 4 ? 'rmg-badge--good' : rating >= 3 ? 'rmg-badge--ok' : 'rmg-badge--bad'
	);

	const title = document.createElement('span');
	title.className = 'rmg-title';
	title.textContent = `${record.firstName} ${record.lastName}`.trim();
	title.style.maxWidth = '14ch';

	const sub = document.createElement('span');
	sub.className = 'rmg-subtle';
	sub.textContent = `${record.numReviews} reviews`;

	const stars = document.createElement('span');
	stars.className = 'rmg-stars';
	const full = Math.max(0, Math.min(5, Math.floor(rating)));
	const half = rating - full >= 0.5 ? 1 : 0;
	const empty = 5 - full - half;
	stars.textContent = '★'.repeat(full) + (half ? '☆' : '') + '☆'.repeat(empty);

	// Meta line for difficulty / would-take-again if present
	const meta = document.createElement('span');
	meta.className = 'rmg-meta';
	const parts = [];
	if (Number.isFinite(record.difficulty)) parts.push(`Diff ${record.difficulty.toFixed(1)}`);
	if (Number.isFinite(record.wouldTakeAgain)) parts.push(`WTA ${record.wouldTakeAgain}%`);
	meta.textContent = parts.join(' • ');

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
	const platName = slugifyForPlat(record.lastName, record.firstName);
	link.href = platName ? `https://ucsbplat.com/instructor/${encodeURIComponent(platName)}` : 'https://ucsbplat.com/instructor/';
	link.textContent = 'UCSB Plat';

	const link2 = document.createElement('a');
	link2.className = 'rmg-link rmg-link--secondary';
	link2.target = '_blank';
	link2.rel = 'noopener noreferrer';
	link2.href = 'https://ucsbplat.com/curriculum/';
	link2.textContent = 'Courses';

	card.appendChild(badge);
	card.appendChild(title);
	card.appendChild(sub);
	card.appendChild(stars);
	if (meta.textContent) card.appendChild(meta);
	card.appendChild(meter);
	actions.appendChild(link);
	actions.appendChild(link2);
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
