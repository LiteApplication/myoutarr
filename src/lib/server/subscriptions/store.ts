import type { DB } from '../db/index.ts';
import { getDb } from '../db/index.ts';

export interface Subscription {
	browseId: string;
	name: string;
	thumbnail: string | null;
	createdBy: string;
	createdAt: number;
	lastCheckedAt: number | null;
}

interface SubscriptionRow {
	browse_id: string;
	name: string;
	thumbnail: string | null;
	created_by: string;
	created_at: number;
	last_checked_at: number | null;
}

function rowToSubscription(row: SubscriptionRow): Subscription {
	return {
		browseId: row.browse_id,
		name: row.name,
		thumbnail: row.thumbnail,
		createdBy: row.created_by,
		createdAt: row.created_at,
		lastCheckedAt: row.last_checked_at
	};
}

/**
 * Create (or refresh) a subscription and seed its seen-set with the releases
 * given, atomically. Seeding means the next check only enqueues releases that
 * appear *after* the subscription was created - the existing discography is left
 * to the manual "download artist" flow. Re-subscribing updates the name/thumbnail
 * and tops up the seen-set without re-downloading anything.
 */
export function subscribe(
	input: { browseId: string; name: string; thumbnail: string | null; createdBy: string },
	seedReleaseIds: string[],
	db: DB = getDb()
): Subscription {
	const now = Date.now();
	const upsertSub = db.prepare(
		`INSERT INTO artist_subscriptions (browse_id, name, thumbnail, created_by, created_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (browse_id, created_by) DO UPDATE SET name = excluded.name, thumbnail = excluded.thumbnail`
	);
	const upsertSeen = db.prepare(
		`INSERT INTO subscription_seen (browse_id, created_by, release_id, seen_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT (browse_id, created_by, release_id) DO NOTHING`
	);
	db.transaction(() => {
		upsertSub.run(input.browseId, input.name, input.thumbnail, input.createdBy, now);
		for (const releaseId of seedReleaseIds)
			upsertSeen.run(input.browseId, input.createdBy, releaseId, now);
	})();
	return getSubscription(input.browseId, input.createdBy, db) as Subscription;
}

export function unsubscribe(browseId: string, createdBy: string, db: DB = getDb()): boolean {
	// subscription_seen rows cascade via the foreign key.
	return (
		db
			.prepare('DELETE FROM artist_subscriptions WHERE browse_id = ? AND created_by = ?')
			.run(browseId, createdBy).changes > 0
	);
}

export function getSubscription(
	browseId: string,
	createdBy: string,
	db: DB = getDb()
): Subscription | null {
	const row = db
		.prepare('SELECT * FROM artist_subscriptions WHERE browse_id = ? AND created_by = ?')
		.get(browseId, createdBy) as SubscriptionRow | undefined;
	return row ? rowToSubscription(row) : null;
}

export function isSubscribed(browseId: string, createdBy: string, db: DB = getDb()): boolean {
	return (
		db
			.prepare('SELECT 1 FROM artist_subscriptions WHERE browse_id = ? AND created_by = ?')
			.get(browseId, createdBy) !== undefined
	);
}

/** One user's artist subscriptions. */
export function listSubscriptions(createdBy: string, db: DB = getDb()): Subscription[] {
	const rows = db
		.prepare('SELECT * FROM artist_subscriptions WHERE created_by = ? ORDER BY name COLLATE NOCASE')
		.all(createdBy) as SubscriptionRow[];
	return rows.map(rowToSubscription);
}

/**
 * Subscriptions (across all users) whose last check is older than `intervalMs`
 * (or never checked). Background checks run for everyone; each row carries the
 * owning user in `createdBy` for per-owner attribution.
 */
export function dueSubscriptions(
	intervalMs: number,
	db: DB = getDb(),
	now: number = Date.now()
): Subscription[] {
	const rows = db
		.prepare(
			`SELECT * FROM artist_subscriptions
			 WHERE last_checked_at IS NULL OR last_checked_at <= ?
			 ORDER BY name COLLATE NOCASE`
		)
		.all(now - intervalMs) as SubscriptionRow[];
	return rows.map(rowToSubscription);
}

/** Which of the given release ids the subscription has already accounted for. */
export function seenReleaseIds(browseId: string, createdBy: string, db: DB = getDb()): Set<string> {
	const rows = db
		.prepare('SELECT release_id FROM subscription_seen WHERE browse_id = ? AND created_by = ?')
		.all(browseId, createdBy) as { release_id: string }[];
	return new Set(rows.map((r) => r.release_id));
}

export function markReleaseSeen(
	browseId: string,
	createdBy: string,
	releaseId: string,
	db: DB = getDb(),
	now: number = Date.now()
): void {
	db.prepare(
		`INSERT INTO subscription_seen (browse_id, created_by, release_id, seen_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT (browse_id, created_by, release_id) DO NOTHING`
	).run(browseId, createdBy, releaseId, now);
}

export function markChecked(
	browseId: string,
	createdBy: string,
	db: DB = getDb(),
	now: number = Date.now()
): void {
	db.prepare(
		'UPDATE artist_subscriptions SET last_checked_at = ? WHERE browse_id = ? AND created_by = ?'
	).run(now, browseId, createdBy);
}
