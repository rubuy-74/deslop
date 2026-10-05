/**
 * Anti-Slop Worker: receives up to 4 video frames (multipart/form-data),
 * forwards them to Clef (clef-flash by default) with the client-supplied
 * questionnaire, and returns the raw Clef response plus timing.
 *
 * Request (POST /analyze):
 *   form-data fields:
 *     frames  : 1-4 image blobs (webp/jpeg/png)
 *     state   : string sent to Clef as `state`
 *     questions: JSON string of the Clef questions schema
 *     model   : optional, "clef-flash" (default) | "clef"  (also ?model=)
 *
 * Response: Clef's JSON ({ model, answers, usage }) plus `clefMs`.
 */

export interface Env {
	// Workers AI binding (typed loosely to avoid a workers-types dependency).
	AI: { run(model: string, input: unknown): Promise<unknown> };
	// R2 bucket holding user feedback reports (fine-tuning dataset).
	FEEDBACK_BUCKET: R2Bucket;
	// Shared verdict cache: platform:videoId -> Clef verdict. THE cost lever —
	// first viewer pays the Clef call, everyone after gets it free. Stores
	// verdicts about VIDEOS only, never user data (privacy policy promise).
	VERDICTS: KvNamespace;
	// Per-install daily analysis counter (installId -> count, no video data).
	QUOTA: KvNamespace;
	// Shared secret required in the X-Slop-Token header when set (deployed).
	// Unset in local dev so `wrangler dev` keeps working without a header.
	SLOP_TOKEN?: string;
}

// Loose KV type (avoids a workers-types dependency).
interface KvNamespace {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
	delete(key: string): Promise<void>;
}

const MAX_FEEDBACK_BYTES = 2_000_000; // 3 frames base64 + metadata, with margin
const VERDICT_TTL_S = 30 * 24 * 3600; // 30 days
const QUOTA_TTL_S = 25 * 3600; // 25h — outlives the day boundary
const DAILY_QUOTA = 300; // Clef-calling analyses per install per day (cache hits free)

/** Cache keys are stable across users: strip query/hash from canonical URLs. */
function normalizeVideoId(raw: string): string {
	try {
		const u = new URL(raw);
		return u.origin + u.pathname;
	} catch {
		return raw;
	}
}

const CORS_HEADERS: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
	// X-Cache is a response header: expose it so non-extension clients
	// (same-origin page fetches under CORS) can read the hit/miss marker.
	'Access-Control-Expose-Headers': 'X-Cache',
};

const MODEL_IDS: Record<string, string> = {
	'clef-flash': '@cf/cloudflare/clef-flash',
	clef: '@cf/cloudflare/clef',
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
	});
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

/**
 * POST /feedback — stores a user correction report verbatim in R2.
 * Reports are the fine-tuning dataset: frames + engine verdict + the user's
 * correction and free-text explanation.
 */
async function handleFeedback(request: Request, env: Env): Promise<Response> {
	const body = await request.text();
	if (body.length > MAX_FEEDBACK_BYTES) {
		return json({ error: 'report too large' }, 413);
	}

	let report: Record<string, unknown>;
	try {
		report = JSON.parse(body);
	} catch {
		return json({ error: 'invalid JSON' }, 400);
	}

	if (report.reportedLabel !== 'slop' && report.reportedLabel !== 'organic') {
		return json({ error: 'reportedLabel must be "slop" or "organic"' }, 400);
	}
	if (typeof report.videoUrl !== 'string' || report.videoUrl.length === 0) {
		return json({ error: 'videoUrl required' }, 400);
	}
	if (!Array.isArray(report.frames) || report.frames.length === 0 || report.frames.length > 4) {
		return json({ error: 'frames must be an array of 1-4 data URLs' }, 400);
	}

	const platform = String(report.platform ?? 'unknown').replace(/[^a-z0-9-]/gi, '') || 'unknown';
	const videoId = String(report.videoUrl).split('/').filter(Boolean).pop()?.replace(/[^a-z0-9_-]/gi, '') ?? 'video';
	const ts = String(report.timestamp ?? new Date().toISOString()).replace(/[:.]/g, '-');
	const key = `feedback/${ts}_${platform}_${videoId}.json`;

	await env.FEEDBACK_BUCKET.put(key, body, {
		httpMetadata: { contentType: 'application/json' },
	});

	// A reported-wrong verdict must never be served again: invalidate the
	// cache entry so the next viewer triggers a fresh analysis.
	const videoUrl = String(report.videoUrl);
	if (platform !== 'unknown' && videoUrl.startsWith('http')) {
		await env.VERDICTS.delete(`verdict:${platform}:${normalizeVideoId(videoUrl)}`);
	}

	return json({ key }, 201);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}
		if (request.method !== 'POST') {
			return json({ error: 'Method Not Allowed' }, 405);
		}

		// Lightweight abuse filter: when a token is configured (deployed env),
		// reject requests that don't present it. Not real security — the token
		// is extractable from the extension — but it filters casual abuse.
		// The real backstop is the Cloudflare rate-limiting rule.
		if (env.SLOP_TOKEN && request.headers.get('x-slop-token') !== env.SLOP_TOKEN) {
			return json({ error: 'Unauthorized' }, 401);
		}

		if (new URL(request.url).pathname === '/feedback') {
			return handleFeedback(request, env);
		}

		let formData: FormData;
		try {
			formData = await request.formData();
		} catch {
			return json({ error: 'Expected multipart/form-data' }, 400);
		}

		const frameFiles = formData.getAll('frames').filter((f): f is File => f instanceof File);
		if (frameFiles.length === 0) {
			return json({ error: 'No frames provided' }, 400);
		}

		// 1. Shared verdict cache: the first viewer of a video pays the Clef
		// call, everyone after gets the cached verdict free. Only canonical
		// platform URLs are cacheable (per-session blob srcs are not).
		const platformField = formData.get('platform');
		const videoIdField = formData.get('videoId');
		const cacheKey =
			typeof platformField === 'string' && typeof videoIdField === 'string' && videoIdField.startsWith('http')
				? `verdict:${platformField}:${normalizeVideoId(videoIdField)}`
				: null;
		if (cacheKey) {
			const cached = await env.VERDICTS.get(cacheKey);
			if (cached) {
				return new Response(cached, {
					headers: { 'Content-Type': 'application/json', 'X-Cache': 'hit', ...CORS_HEADERS },
				});
			}
		}

		// 2. Per-install daily quota — applies ONLY to Clef-calling requests
		// (cache hits are free and uncounted). Keyed by install ID + day; the
		// value is just a count, never any video/user data.
		const installId = request.headers.get('x-install-id');
		let quotaKey: string | null = null;
		let quotaCount = 0;
		if (installId) {
			quotaKey = `quota:${installId}:${new Date().toISOString().slice(0, 10)}`;
			quotaCount = Number((await env.QUOTA.get(quotaKey)) ?? 0);
			if (quotaCount >= DAILY_QUOTA) {
				return json({ error: 'daily quota exceeded', quota: true }, 429);
			}
		}

		const stateField = formData.get('state');
		const questionsField = formData.get('questions');
		if (typeof stateField !== 'string' || typeof questionsField !== 'string') {
			return json({ error: 'Missing state or questions fields' }, 400);
		}

		let questions: unknown;
		try {
			questions = JSON.parse(questionsField);
		} catch {
			return json({ error: 'questions is not valid JSON' }, 400);
		}

		const url = new URL(request.url);
		const modelField = formData.get('model');
		const modelParam = url.searchParams.get('model') ??
			(typeof modelField === 'string' ? modelField : null) ??
			'clef-flash';
		const modelId = MODEL_IDS[modelParam];
		if (!modelId) {
			return json({ error: `Unknown model "${modelParam}"; use clef-flash or clef` }, 400);
		}

		// Clef accepts max 4 images, base64 only (data URL or {content_type, base64}).
		const images: Array<{ content_type: string; base64: string }> = [];
		for (const file of frameFiles.slice(0, 4)) {
			const buffer = await file.arrayBuffer();
			const contentType = ['image/webp', 'image/jpeg', 'image/png'].includes(file.type)
				? file.type
				: 'image/webp';
			images.push({ content_type: contentType, base64: arrayBufferToBase64(buffer) });
		}

		const started = Date.now();
		let result: unknown;
		try {
			result = await env.AI.run(modelId, {
				model: modelParam,
				state: stateField,
				images,
				questions,
			});
		} catch (err) {
			return json({ error: `Clef call failed: ${String(err)}` }, 502);
		}
		const clefMs = Date.now() - started;

		const body = typeof result === 'object' && result !== null ? result : { result };
		const responseBody = JSON.stringify({ ...body, clefMs });

		// Success: count it against the install's daily quota and populate the
		// shared cache so the next viewer gets this verdict free.
		if (quotaKey) {
			await env.QUOTA.put(quotaKey, String(quotaCount + 1), { expirationTtl: QUOTA_TTL_S });
		}
		if (cacheKey) {
			await env.VERDICTS.put(cacheKey, responseBody, { expirationTtl: VERDICT_TTL_S });
		}

		return new Response(responseBody, {
			headers: { 'Content-Type': 'application/json', 'X-Cache': cacheKey ? 'miss' : 'skip', ...CORS_HEADERS },
		});
	},
};
