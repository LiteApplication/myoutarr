import type { DB } from '../db/index.ts';
import { getDb } from '../db/index.ts';
import { splitArtists } from '../library/artists.ts';
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

interface ArtistCredit {
	name: string;
	joinphrase?: string;
	artist?: { id: string; name: string };
}

interface RgSearchResponse {
	'release-groups'?: {
		id: string;
		score: number;
		title: string;
		'first-release-date'?: string;
		'artist-credit'?: ArtistCredit[];
	}[];
}

interface RgLookupResponse {
	genres?: { name: string; count: number }[];
}

interface RgReleasesResponse {
	releases?: { id: string }[];
}

interface ReleaseRecordingsResponse {
	media?: { tracks?: { position: number; title: string }[] }[];
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

/* -------------------------------------------------------------------------- */
/* Artist credits.                                                             */
/*                                                                             */
/* MusicBrainz models a credit as a *list* of artists, which is exactly what   */
/* Jellyfin wants and what YT Music only gives us as one string ("A, B & C").  */
/* So we take MB's list when we can get it, and fall back to whatever the      */
/* caller already knew otherwise.                                              */
/* -------------------------------------------------------------------------- */

/** "A", " & ", "B" → "A & B" - MusicBrainz's own rendering of a credit. */
function renderCredit(credits: ArtistCredit[]): string {
	return credits.map((c) => `${c.name}${c.joinphrase ?? ''}`).join('');
}

function creditNames(credits: ArtistCredit[]): string[] {
	return credits.map((c) => c.artist?.name ?? c.name).filter((name) => name !== '');
}

/**
 * Does an MB credit plausibly describe the same act as the credit we already
 * have? Titles collide constantly ("Alive", "Greatest Hits"), so this is the
 * guard that stops us pinning someone else's artists onto our track.
 *
 * Accepted: the same rendering modulo punctuation ("A, B" vs "A & B"); every MB
 * artist already named in our string (MB simply splits what YT ran together);
 * or the lead artist agreeing, which lets MB *add* the featured guests YT Music
 * left out. Anything else is treated as a different piece of music.
 */
function creditCorresponds(ours: string, credits: ArtistCredit[]): boolean {
	if (credits.length === 0) return false;
	const want = normalize(ours);
	if (want === '') return false;
	if (normalize(renderCredit(credits)) === want) return true;

	const padded = ` ${want} `;
	const names = creditNames(credits)
		.map(normalize)
		.filter((name) => name !== '');
	if (names.length === 0) return false; // a nameless credit tells us nothing
	if (names.every((name) => padded.includes(` ${name} `))) return true;

	const ourLead = normalize(splitArtists(ours)[0] ?? '');
	return ourLead !== '' && names[0] === ourLead;
}

interface RecordingSearchResponse {
	recordings?: {
		score: number;
		title: string;
		'artist-credit'?: ArtistCredit[];
	}[];
}

/**
 * The artists MusicBrainz credits for one song. Searches recordings (where
 * per-track credits actually live, unlike the release group) constrained to the
 * album, then keeps the first hit whose title and credit both correspond.
 * Returns null when nothing corresponds - the caller keeps its own answer.
 */
export async function lookupSongArtists(
	title: string,
	album: string,
	credit: string,
	db: DB = getDb(),
	fetchImpl: typeof fetch = fetch
): Promise<string[] | null> {
	const key = `credit:rec:${normalize(title)}|${normalize(album)}|${normalize(credit)}`;
	const cached = cacheGet<string[] | { miss: true }>(key, db);
	if (cached) return 'miss' in cached ? null : cached;

	const query = encodeURIComponent(`recording:"${title}" AND release:"${album}"`);
	const search = await mbFetch<RecordingSearchResponse>(
		`/recording/?query=${query}&limit=10&fmt=json`,
		fetchImpl
	);

	const wantTitle = normalize(title);
	const found = (search.recordings ?? [])
		.filter((rec) => rec.score >= MIN_SCORE && normalize(rec.title) === wantTitle)
		.map((rec) => rec['artist-credit'] ?? [])
		.find((credits) => creditCorresponds(credit, credits));

	// An empty list would blank the artist tag - treat it as no answer at all.
	const names = found && creditNames(found).length > 0 ? creditNames(found) : null;
	cachePut(key, names ?? { miss: true }, db);
	return names;
}

/**
 * The artists MusicBrainz credits for one album, under the same correspondence
 * rule as `lookupSongArtists`. Returns null when nothing corresponds.
 */
export async function lookupAlbumArtists(
	album: string,
	credit: string,
	db: DB = getDb(),
	fetchImpl: typeof fetch = fetch
): Promise<string[] | null> {
	const key = `credit:rg:${normalize(album)}|${normalize(credit)}`;
	const cached = cacheGet<string[] | { miss: true }>(key, db);
	if (cached) return 'miss' in cached ? null : cached;

	const query = encodeURIComponent(
		`releasegroup:"${album}" AND artist:"${splitArtists(credit)[0] ?? credit}"`
	);
	const search = await mbFetch<RgSearchResponse>(
		`/release-group/?query=${query}&limit=10&fmt=json`,
		fetchImpl
	);

	const wantTitle = normalize(album);
	const found = (search['release-groups'] ?? [])
		.filter((rg) => rg.score >= MIN_SCORE && normalize(rg.title) === wantTitle)
		.map((rg) => rg['artist-credit'] ?? [])
		.find((credits) => creditCorresponds(credit, credits));

	// An empty list would blank the artist tag - treat it as no answer at all.
	const names = found && creditNames(found).length > 0 ? creditNames(found) : null;
	cachePut(key, names ?? { miss: true }, db);
	return names;
}

function capitalize(value: string): string {
	return value.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Find the real track number for a title within a release-group, by scanning
 * the tracklist of one of its releases. Used when the caller has no reliable
 * track number of its own (e.g. a track sourced from a playlist, where the
 * playlist position is not the album track number). Returns null - never a
 * guess - when no release or matching track title can be found.
 */
export async function findTrackNumber(
	releaseGroupId: string,
	title: string,
	db: DB = getDb(),
	fetchImpl: typeof fetch = fetch
): Promise<number | null> {
	const key = `track:${releaseGroupId}|${normalize(title)}`;
	const cached = cacheGet<{ trackNumber: number } | { miss: true }>(key, db);
	if (cached) return 'miss' in cached ? null : cached.trackNumber;

	const releaseId = await mbFetch<RgReleasesResponse>(
		`/release-group/${releaseGroupId}?inc=releases&fmt=json`,
		fetchImpl
	)
		.then((r) => r.releases?.[0]?.id)
		.catch(() => undefined);

	if (!releaseId) {
		cachePut(key, { miss: true }, db);
		return null;
	}

	const release = await mbFetch<ReleaseRecordingsResponse>(
		`/release/${releaseId}?inc=recordings&fmt=json`,
		fetchImpl
	).catch(() => null);

	const wantTitle = normalize(title);
	for (const medium of release?.media ?? []) {
		const track = medium.tracks?.find((t) => normalize(t.title) === wantTitle);
		if (track) {
			cachePut(key, { trackNumber: track.position }, db);
			return track.position;
		}
	}

	cachePut(key, { miss: true }, db);
	return null;
}

/**
 * Enrichment hook for the download pipeline. Fills genre, canonical year and
 * MBIDs, splits combined artist credits it can verify, plus the track number
 * when the caller didn't already know a real one; any failure degrades to the
 * original YT Music metadata.
 */
export async function enrichMeta(
	meta: JobMeta,
	db: DB = getDb(),
	fetchImpl: typeof fetch = fetch
): Promise<JobMeta> {
	// Independent of the release-group match below, and worth doing even when
	// that lookup comes up empty.
	meta = await resolveMetaArtists(meta, db, fetchImpl);
	try {
		const match = await findRelease(meta.albumArtist ?? meta.artist, meta.album, db, fetchImpl);
		if (!match) return meta;
		const trackNumber =
			meta.trackNumber ??
			(await findTrackNumber(match.releaseGroupId, meta.title, db, fetchImpl).catch(() => null)) ??
			undefined;
		return {
			...meta,
			genre: meta.genre ?? match.genres[0],
			year: meta.year ?? match.year,
			mbArtistId: match.artistId,
			mbReleaseGroupId: match.releaseGroupId,
			trackNumber
		};
	} catch {
		return meta;
	}
}

/**
 * Fill `artists` / `albumArtists` with MusicBrainz's own credit lists, which
 * beat YT Music's: MB models each artist separately, spells them canonically,
 * and knows the featured guests YT Music folds into one string. What YT Music
 * gave us is the fallback - used whenever MB has nothing that corresponds, and
 * as the reference the correspondence check compares against, so a same-titled
 * song by someone else can never overwrite the credits.
 */
async function resolveMetaArtists(
	meta: JobMeta,
	db: DB,
	fetchImpl: typeof fetch
): Promise<JobMeta> {
	const albumCredit = meta.albumArtist ?? meta.artist;
	const song = await lookupSongArtists(meta.title, meta.album, meta.artist, db, fetchImpl).catch(
		() => null
	);
	const album = await lookupAlbumArtists(meta.album, albumCredit, db, fetchImpl).catch(() => null);
	return {
		...meta,
		artists: song ?? meta.artists ?? [meta.artist],
		albumArtists: album ?? meta.albumArtists ?? [albumCredit]
	};
}
