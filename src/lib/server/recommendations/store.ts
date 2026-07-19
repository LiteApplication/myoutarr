import { randomUUID } from 'node:crypto';
import type { DB } from '../db/index.ts';
import { getDb } from '../db/index.ts';

export interface RecommendationPlaylist {
	id: string;
	name: string;
	dailyCount: number;
	createdBy: string;
	createdAt: number;
	lastCheckedAt: number | null;
}

interface RecommendationPlaylistRow {
	id: string;
	name: string;
	daily_count: number;
	created_by: string;
	created_at: number;
	last_checked_at: number | null;
}

/** A track that lives in a recommendation playlist (seed or recommended). */
export interface RecommendationTrack {
	videoId: string;
	title: string;
	artist: string;
}

function rowToPlaylist(row: RecommendationPlaylistRow): RecommendationPlaylist {
	return {
		id: row.id,
		name: row.name,
		dailyCount: row.daily_count,
		createdBy: row.created_by,
		createdAt: row.created_at,
		lastCheckedAt: row.last_checked_at
	};
}

/**
 * Create a recommendation playlist and seed its track pool with the given songs,
 * atomically. The seeds are flagged `is_seed = 1`; they double as the initial
 * radio-seed pool and the dedupe set. Returns the created playlist.
 */
export function createPlaylist(
	input: { name: string; dailyCount: number; createdBy: string },
	seeds: RecommendationTrack[],
	db: DB = getDb()
): RecommendationPlaylist {
	const now = Date.now();
	const id = randomUUID();
	const insertPlaylist = db.prepare(
		`INSERT INTO recommendation_playlists (id, name, daily_count, created_by, created_at)
		 VALUES (?, ?, ?, ?, ?)`
	);
	const insertSeed = db.prepare(
		`INSERT INTO recommendation_tracks (playlist_id, video_id, title, artist, is_seed, added_at)
		 VALUES (?, ?, ?, ?, 1, ?)
		 ON CONFLICT (playlist_id, video_id) DO NOTHING`
	);
	db.transaction(() => {
		insertPlaylist.run(id, input.name, input.dailyCount, input.createdBy, now);
		for (const seed of seeds) insertSeed.run(id, seed.videoId, seed.title, seed.artist, now);
	})();
	return getPlaylist(id, db) as RecommendationPlaylist;
}

export function deletePlaylist(id: string, db: DB = getDb()): boolean {
	// recommendation_tracks rows cascade via the foreign key.
	return db.prepare('DELETE FROM recommendation_playlists WHERE id = ?').run(id).changes > 0;
}

export function getPlaylist(id: string, db: DB = getDb()): RecommendationPlaylist | null {
	const row = db.prepare('SELECT * FROM recommendation_playlists WHERE id = ?').get(id) as
		RecommendationPlaylistRow | undefined;
	return row ? rowToPlaylist(row) : null;
}

export function listPlaylists(db: DB = getDb()): RecommendationPlaylist[] {
	const rows = db
		.prepare('SELECT * FROM recommendation_playlists ORDER BY name COLLATE NOCASE')
		.all() as RecommendationPlaylistRow[];
	return rows.map(rowToPlaylist);
}

/** How many tracks the playlist currently holds (seeds + recommendations). */
export function trackCount(id: string, db: DB = getDb()): number {
	const row = db
		.prepare('SELECT COUNT(*) AS n FROM recommendation_tracks WHERE playlist_id = ?')
		.get(id) as { n: number };
	return row.n;
}

/** Every video id in the playlist - the dedupe/"seen" set for a run. */
export function playlistTrackVideoIds(id: string, db: DB = getDb()): Set<string> {
	const rows = db
		.prepare('SELECT video_id FROM recommendation_tracks WHERE playlist_id = ?')
		.all(id) as { video_id: string }[];
	return new Set(rows.map((r) => r.video_id));
}

/** Up to `k` current tracks sampled at random, to seed the day's radio. */
export function sampleSeedTracks(id: string, k: number, db: DB = getDb()): RecommendationTrack[] {
	const rows = db
		.prepare(
			`SELECT video_id, title, artist FROM recommendation_tracks
			 WHERE playlist_id = ? ORDER BY RANDOM() LIMIT ?`
		)
		.all(id, k) as { video_id: string; title: string; artist: string }[];
	return rows.map((r) => ({ videoId: r.video_id, title: r.title, artist: r.artist }));
}

/** Bulk-insert tracks into the playlist's pool, ignoring ones already present. */
export function addTracks(
	id: string,
	tracks: RecommendationTrack[],
	isSeed: boolean,
	db: DB = getDb(),
	now: number = Date.now()
): void {
	const stmt = db.prepare(
		`INSERT INTO recommendation_tracks (playlist_id, video_id, title, artist, is_seed, added_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT (playlist_id, video_id) DO NOTHING`
	);
	db.transaction(() => {
		for (const t of tracks) stmt.run(id, t.videoId, t.title, t.artist, isSeed ? 1 : 0, now);
	})();
}

/** Playlists whose last run is older than `intervalMs` (or never run). */
export function duePlaylists(
	intervalMs: number,
	db: DB = getDb(),
	now: number = Date.now()
): RecommendationPlaylist[] {
	const rows = db
		.prepare(
			`SELECT * FROM recommendation_playlists
			 WHERE last_checked_at IS NULL OR last_checked_at <= ?
			 ORDER BY name COLLATE NOCASE`
		)
		.all(now - intervalMs) as RecommendationPlaylistRow[];
	return rows.map(rowToPlaylist);
}

export function markChecked(id: string, db: DB = getDb(), now: number = Date.now()): void {
	db.prepare('UPDATE recommendation_playlists SET last_checked_at = ? WHERE id = ?').run(now, id);
}
