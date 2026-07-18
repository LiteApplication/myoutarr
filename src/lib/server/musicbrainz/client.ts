import type { DB } from '../db/index.ts';
import { getDb } from '../db/index.ts';
import type { JobMeta } from '../queue/store.ts';

const MB_BASE = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'myoutarr/0.1.0 ( https://github.com/LiteApplication/myoutarr )';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MIN_SCORE = 85;

/**
 * MusicBrainz allows 1 request/second and requires an identifying User-Agent.
 * Violating either gets clients blocked, so every request goes through this
 * queue. Single replica ⇒ a process-local limiter is globally correct.
 */
let lastRequestAt = 0;
let chain: Promise<unknown> = Promise.resolve();

function rateLimited<T>(task: () => Promise<T>): Promise<T> {
	const next = chain.then(async () => {
		const wait = lastRequestAt + 1100 - Date.now();
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		lastRequestAt = Date.now();
		return task();
	});
	chain = next.catch(() => {});
	return next as Promise<T>;
}

async function mbFetch<T>(path: string, fetchImpl: typeof fetch): Promise<T> {
	return rateLimited(async () => {
		const response = await fetchImpl(`${MB_BASE}${path}`, {
			headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
			signal: AbortSignal.timeout(10_000)
		});
		if (!response.ok) throw new Error(`MusicBrainz responded ${response.status}`);
		return (await response.json()) as T;
	});
}

function cacheGet<T>(key: string, db: DB): T | null {
	const row = db.prepare('SELECT value, fetched_at FROM mb_cache WHERE key = ?').get(key) as
		{ value: string; fetched_at: number } | undefined;
	if (!row || Date.now() - row.fetched_at > CACHE_TTL_MS) return null;
	try {
		return JSON.parse(row.value) as T;
	} catch {
		return null;
	}
}

function cachePut(key: string, value: unknown, db: DB): void {
	db.prepare(
		`INSERT INTO mb_cache (key, value, fetched_at) VALUES (?, ?, ?)
		 ON CONFLICT (key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at`
	).run(key, JSON.stringify(value), Date.now());
}

function normalize(value: string): string {
	return value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export interface MbMatch {
	releaseGroupId: string;
	artistId?: string;
	title: string;
	artist: string;
	year?: string;
	genres: string[];
	score: number;
}

interface RgSearchResponse {
	'release-groups'?: {
		id: string;
		score: number;
		title: string;
		'first-release-date'?: string;
		'artist-credit'?: { name: string; artist?: { id: string; name: string } }[];
	}[];
}

interface RgLookupResponse {
	genres?: { name: string; count: number }[];
}

/**
 * Find the best release-group match for an artist+album pair.
 * Returns null rather than guessing when confidence is low.
 */
export async function findRelease(
	artist: string,
	album: string,
	db: DB = getDb(),
	fetchImpl: typeof fetch = fetch
): Promise<MbMatch | null> {
	const key = `rg:${normalize(artist)}|${normalize(album)}`;
	const cached = cacheGet<MbMatch | { miss: true }>(key, db);
	if (cached) return 'miss' in cached ? null : cached;

	const query = encodeURIComponent(`releasegroup:"${album}" AND artist:"${artist}"`);
	const search = await mbFetch<RgSearchResponse>(
		`/release-group/?query=${query}&limit=5&fmt=json`,
		fetchImpl
	);

	const wantTitle = normalize(album);
	const wantArtist = normalize(artist);
	const best = (search['release-groups'] ?? [])
		.filter((rg) => rg.score >= MIN_SCORE)
		.find((rg) => {
			const gotTitle = normalize(rg.title);
			const credit = rg['artist-credit']?.[0];
			const gotArtist = normalize(credit?.artist?.name ?? credit?.name ?? '');
			const titleOk =
				gotTitle === wantTitle || gotTitle.startsWith(wantTitle) || wantTitle.startsWith(gotTitle);
			const artistOk = gotArtist === wantArtist;
			return titleOk && artistOk;
		});

	if (!best) {
		cachePut(key, { miss: true }, db);
		return null;
	}

	// Second (rate-limited) call for genres - the whole reason we're here.
	const lookup = await mbFetch<RgLookupResponse>(
		`/release-group/${best.id}?inc=genres&fmt=json`,
		fetchImpl
	).catch(() => ({ genres: [] }) as RgLookupResponse);

	const credit = best['artist-credit']?.[0];
	const match: MbMatch = {
		releaseGroupId: best.id,
		artistId: credit?.artist?.id,
		title: best.title,
		artist: credit?.artist?.name ?? credit?.name ?? artist,
		year: best['first-release-date']?.slice(0, 4),
		genres: (lookup.genres ?? [])
			.sort((a, b) => b.count - a.count)
			.slice(0, 3)
			.map((g) => capitalize(g.name)),
		score: best.score
	};
	cachePut(key, match, db);
	return match;
}

function capitalize(value: string): string {
	return value.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Enrichment hook for the download pipeline. Fills genre, canonical year and
 * MBIDs; any failure degrades to the original YT Music metadata.
 */
export async function enrichMeta(
	meta: JobMeta,
	db: DB = getDb(),
	fetchImpl: typeof fetch = fetch
): Promise<JobMeta> {
	try {
		const match = await findRelease(meta.albumArtist ?? meta.artist, meta.album, db, fetchImpl);
		if (!match) return meta;
		return {
			...meta,
			genre: meta.genre ?? match.genres[0],
			year: meta.year ?? match.year,
			mbArtistId: match.artistId,
			mbReleaseGroupId: match.releaseGroupId
		};
	} catch {
		return meta;
	}
}
