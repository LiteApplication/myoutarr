import type { DB } from '../db/index.ts';
import { getDb } from '../db/index.ts';
import { publish } from '../events.ts';
import { enqueueAlbumById } from '../queue/enqueue.ts';
import { getArtistReleases } from '../ytmusic/api.ts';
import {
	dueSubscriptions,
	markChecked,
	markReleaseSeen,
	seenReleaseIds,
	type Subscription
} from './store.ts';

export interface CheckResult {
	/** Number of new-release batches enqueued. */
	enqueued: number;
	/** Batch ids created, for the caller to poke the worker pool. */
	batchIds: string[];
}

/**
 * The two external operations a check performs, injectable so tests can run
 * fully offline (matching the repo's dependency-injection convention over
 * module mocking).
 */
export interface CheckDeps {
	getReleases: typeof getArtistReleases;
	enqueueAlbum: typeof enqueueAlbumById;
}

const defaultDeps: CheckDeps = { getReleases: getArtistReleases, enqueueAlbum: enqueueAlbumById };

/**
 * Check one subscribed artist for releases not yet in its seen-set and enqueue
 * each new one as an album batch. Every release we successfully resolve is
 * marked seen (even if it had no downloadable tracks) so it isn't reconsidered;
 * a release that fails to resolve is left unseen and retried on the next check.
 */
export async function checkSubscription(
	sub: Subscription,
	db: DB = getDb(),
	deps: CheckDeps = defaultDeps
): Promise<CheckResult> {
	const { releases } = await deps.getReleases(sub.browseId);
	const seen = seenReleaseIds(sub.browseId, sub.createdBy, db);
	const batchIds: string[] = [];

	for (const release of releases) {
		if (seen.has(release.browseId)) continue;
		try {
			const batch = await deps.enqueueAlbum(release.browseId, sub.createdBy, sub.name, db);
			markReleaseSeen(sub.browseId, sub.createdBy, release.browseId, db);
			if (batch) {
				batchIds.push(batch.id);
				console.log(`subscription: enqueued "${batch.title}" by ${sub.name}`);
			}
		} catch (cause) {
			// Transient resolve/enqueue failure - leave unseen, retry next check.
			console.error(
				`subscription: failed to enqueue release ${release.browseId} for ${sub.name}:`,
				(cause as Error).message
			);
		}
	}

	markChecked(sub.browseId, sub.createdBy, db);
	return { enqueued: batchIds.length, batchIds };
}

/**
 * Check every subscription due for a refresh (last checked longer ago than
 * `intervalMs`). Failures on one artist don't abort the rest. Returns the total
 * number of batches enqueued across all artists.
 */
export async function checkDueSubscriptions(
	intervalMs: number,
	db: DB = getDb(),
	deps: CheckDeps = defaultDeps
): Promise<CheckResult> {
	const subs = dueSubscriptions(intervalMs, db);
	const batchIds: string[] = [];
	for (const sub of subs) {
		try {
			const result = await checkSubscription(sub, db, deps);
			batchIds.push(...result.batchIds);
		} catch (cause) {
			console.error(`subscription: check failed for ${sub.name}:`, (cause as Error).message);
		}
	}
	if (batchIds.length > 0) {
		publish({ type: 'queue', payload: { enqueued: batchIds } });
	}
	return { enqueued: batchIds.length, batchIds };
}
