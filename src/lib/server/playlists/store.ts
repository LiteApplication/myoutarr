import type { DB } from '../db/index.ts';
import { getDb } from '../db/index.ts';

export interface PlaylistSubscription {
	browseId: string;
	title: string;
	thumbnail: string | null;
	enabled: boolean;
	createdBy: string;
	createdAt: number;
	lastCheckedAt: number | null;
}

interface PlaylistSubscriptionRow {
	browse_id: string;
	title: string;
	thumbnail: string | null;
	enabled: number;
	created_by: string;
	created_at: number;
	last_checked_at: number | null;
}

function rowToSubscription(row: PlaylistSubscriptionRow): PlaylistSubscription {
	return {
		browseId: row.browse_id,
		title: row.title,
		thumbnail: row.thumbnail,
		enabled: row.enabled === 1,
		createdBy: row.created_by,
		createdAt: row.created_at,
		lastCheckedAt: row.last_checked_at
	};
}

/**
 * Follow (or refresh) a playlist and seed its seen-set with the given video ids,
 * atomically. Seeding means a later check only downloads songs added *after* the
 * playlist was followed - the current tracklist is left to the manual "download
 * playlist" flow. Re-following updates the title/thumbnail, re-enables it, and
 * tops up the seen-set without re-downloading anything.
 */
export function subscribePlaylist(
	input: { browseId: string; title: string; thumbnail: string | null; createdBy: string },
	seedVideoIds: string[],
	db: DB = getDb()
): PlaylistSubscription {
	const now = Date.now();
	const upsertSub = db.prepare(
		`INSERT INTO playlist_subscriptions (browse_id, title, thumbnail, created_by, created_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (browse_id, created_by) DO UPDATE SET
			title = excluded.title, thumbnail = excluded.thumbnail, enabled = 1`
	);
	const upsertSeen = db.prepare(
		`INSERT INTO playlist_seen (browse_id, created_by, video_id, seen_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT (browse_id, created_by, video_id) DO NOTHING`
	);
	db.transaction(() => {
		upsertSub.run(input.browseId, input.title, input.thumbnail, input.createdBy, now);
		for (const videoId of seedVideoIds)
			upsertSeen.run(input.browseId, input.createdBy, videoId, now);
	})();
	return getPlaylistSubscription(input.browseId, input.createdBy, db) as PlaylistSubscription;
}

export function unsubscribePlaylist(
	browseId: string,
	createdBy: string,
	db: DB = getDb()
): boolean {
	// playlist_seen rows cascade via the foreign key.
	return (
		db
			.prepare('DELETE FROM playlist_subscriptions WHERE browse_id = ? AND created_by = ?')
			.run(browseId, createdBy).changes > 0
	);
}

/** Toggle polling for one playlist without dropping its seen-set. */
export function setPlaylistEnabled(
	browseId: string,
	createdBy: string,
	enabled: boolean,
	db: DB = getDb()
): boolean {
	return (
		db
			.prepare(
				'UPDATE playlist_subscriptions SET enabled = ? WHERE browse_id = ? AND created_by = ?'
			)
			.run(enabled ? 1 : 0, browseId, createdBy).changes > 0
	);
}

export function getPlaylistSubscription(
	browseId: string,
	createdBy: string,
	db: DB = getDb()
): PlaylistSubscription | null {
	const row = db
		.prepare('SELECT * FROM playlist_subscriptions WHERE browse_id = ? AND created_by = ?')
		.get(browseId, createdBy) as PlaylistSubscriptionRow | undefined;
	return row ? rowToSubscription(row) : null;
}

export function isPlaylistSubscribed(
	browseId: string,
	createdBy: string,
	db: DB = getDb()
): boolean {
	return (
		db
			.prepare('SELECT 1 FROM playlist_subscriptions WHERE browse_id = ? AND created_by = ?')
			.get(browseId, createdBy) !== undefined
	);
}

/** One user's followed playlists. */
export function listPlaylistSubscriptions(
	createdBy: string,
	db: DB = getDb()
): PlaylistSubscription[] {
	const rows = db
		.prepare(
			'SELECT * FROM playlist_subscriptions WHERE created_by = ? ORDER BY title COLLATE NOCASE'
		)
		.all(createdBy) as PlaylistSubscriptionRow[];
	return rows.map(rowToSubscription);
}

/**
 * Enabled subscriptions (across all users) whose last check is older than
 * `intervalMs` (or never). Background checks run for everyone; each row carries
 * the owning user in `createdBy`.
 */
export function duePlaylistSubscriptions(
	intervalMs: number,
	db: DB = getDb(),
	now: number = Date.now()
): PlaylistSubscription[] {
	const rows = db
		.prepare(
			`SELECT * FROM playlist_subscriptions
			 WHERE enabled = 1 AND (last_checked_at IS NULL OR last_checked_at <= ?)
			 ORDER BY title COLLATE NOCASE`
		)
		.all(now - intervalMs) as PlaylistSubscriptionRow[];
	return rows.map(rowToSubscription);
}

/** The set of video ids the subscription has already accounted for. */
export function seenVideoIds(browseId: string, createdBy: string, db: DB = getDb()): Set<string> {
	const rows = db
		.prepare('SELECT video_id FROM playlist_seen WHERE browse_id = ? AND created_by = ?')
		.all(browseId, createdBy) as { video_id: string }[];
	return new Set(rows.map((r) => r.video_id));
}

export function markVideosSeen(
	browseId: string,
	createdBy: string,
	videoIds: string[],
	db: DB = getDb(),
	now: number = Date.now()
): void {
	const stmt = db.prepare(
		`INSERT INTO playlist_seen (browse_id, created_by, video_id, seen_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT (browse_id, created_by, video_id) DO NOTHING`
	);
	db.transaction(() => {
		for (const videoId of videoIds) stmt.run(browseId, createdBy, videoId, now);
	})();
}

export function markPlaylistChecked(
	browseId: string,
	createdBy: string,
	db: DB = getDb(),
	now: number = Date.now()
): void {
	db.prepare(
		'UPDATE playlist_subscriptions SET last_checked_at = ? WHERE browse_id = ? AND created_by = ?'
	).run(now, browseId, createdBy);
}
