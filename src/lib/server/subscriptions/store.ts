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
		 ON CONFLICT (browse_id) DO UPDATE SET name = excluded.name, thumbnail = excluded.thumbnail`
	);
	const upsertSeen = db.prepare(
		`INSERT INTO subscription_seen (browse_id, release_id, seen_at) VALUES (?, ?, ?)
		 ON CONFLICT (browse_id, release_id) DO NOTHING`
	);
	db.transaction(() => {
		upsertSub.run(input.browseId, input.name, input.thumbnail, input.createdBy, now);
		for (const releaseId of seedReleaseIds) upsertSeen.run(input.browseId, releaseId, now);
	})();
	return getSubscription(input.browseId, db) as Subscription;
}

export function unsubscribe(browseId: string, db: DB = getDb()): boolean {
	// subscription_seen rows cascade via the foreign key.
	return (
		db.prepare('DELETE FROM artist_subscriptions WHERE browse_id = ?').run(browseId).changes > 0
	);
}

export function getSubscription(browseId: string, db: DB = getDb()): Subscription | null {
	const row = db.prepare('SELECT * FROM artist_subscriptions WHERE browse_id = ?').get(browseId) as
		SubscriptionRow | undefined;
	return row ? rowToSubscription(row) : null;
}

export function isSubscribed(browseId: string, db: DB = getDb()): boolean {
	return (
		db.prepare('SELECT 1 FROM artist_subscriptions WHERE browse_id = ?').get(browseId) !== undefined
	);
}

export function listSubscriptions(db: DB = getDb()): Subscription[] {
	const rows = db
		.prepare('SELECT * FROM artist_subscriptions ORDER BY name COLLATE NOCASE')
		.all() as SubscriptionRow[];
	return rows.map(rowToSubscription);
}

/** Subscriptions whose last check is older than `intervalMs` (or never checked). */
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
export function seenReleaseIds(browseId: string, db: DB = getDb()): Set<string> {
	const rows = db
		.prepare('SELECT release_id FROM subscription_seen WHERE browse_id = ?')
		.all(browseId) as { release_id: string }[];
	return new Set(rows.map((r) => r.release_id));
}

export function markReleaseSeen(
	browseId: string,
	releaseId: string,
	db: DB = getDb(),
	now: number = Date.now()
): void {
	db.prepare(
		`INSERT INTO subscription_seen (browse_id, release_id, seen_at) VALUES (?, ?, ?)
		 ON CONFLICT (browse_id, release_id) DO NOTHING`
	).run(browseId, releaseId, now);
}

export function markChecked(browseId: string, db: DB = getDb(), now: number = Date.now()): void {
	db.prepare('UPDATE artist_subscriptions SET last_checked_at = ? WHERE browse_id = ?').run(
		now,
		browseId
	);
}
