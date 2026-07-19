import { building } from '$app/environment';
import { getDb } from './db/index.ts';
import {
	scheduleIncrementalPlaylistSync,
	scheduleRefresh,
	syncPlaylistBatch
} from './jellyfin/sync.ts';
import { enrichMeta } from './musicbrainz/client.ts';
import { WorkerPool } from './queue/worker.ts';
import {
	startRecommendationScheduler,
	stopRecommendationScheduler
} from './recommendations/scheduler.ts';
import { getSettings } from './settings.ts';
import {
	startSubscriptionScheduler,
	stopSubscriptionScheduler
} from './subscriptions/scheduler.ts';
import { stopYtMusic } from './ytmusic/client.ts';
import { YtdlpPipeline } from './ytdlp/runner.ts';

/**
 * Process-wide services. Constructed lazily on first use so `vite build`
 * (which imports server modules) never spawns workers or opens databases.
 */
let pool: WorkerPool | null = null;
let batchDrainedHandlers: ((batchId: string) => void)[] = [];

export function onBatchDrained(handler: (batchId: string) => void): void {
	batchDrainedHandlers.push(handler);
}

export function getPool(): WorkerPool {
	if (building) throw new Error('worker pool must not start during build');
	if (!pool) {
		// Built-in drain reactions: refresh Jellyfin, then materialise playlists.
		onBatchDrained((batchId) => {
			scheduleRefresh();
			void syncPlaylistBatch(batchId).catch((cause) =>
				console.error('playlist sync failed:', (cause as Error).message)
			);
		});
		const pipeline = new YtdlpPipeline({
			enrich: async (meta) => (getSettings().musicBrainz ? enrichMeta(meta) : meta)
		});
		pool = new WorkerPool(pipeline, {
			onBatchDrained: (batchId) => {
				for (const handler of batchDrainedHandlers) {
					try {
						handler(batchId);
					} catch (cause) {
						console.error('batch-drained handler failed:', cause);
					}
				}
			},
			// As each track of a playlist lands, grow the Jellyfin playlist so it
			// appears progressively rather than only when the whole batch drains.
			onJobCompleted: (batchId) => {
				const batch = getDb()
					.prepare("SELECT id, sync_jellyfin FROM batches WHERE id = ? AND kind = 'playlist'")
					.get(batchId) as { id: string; sync_jellyfin: number } | undefined;
				if (!batch || batch.sync_jellyfin === 0) return;
				scheduleRefresh();
				scheduleIncrementalPlaylistSync(batchId);
			}
		});
		pool.start();

		// Daily check for new releases from subscribed artists and new songs in
		// followed playlists; enqueued batches are picked up by poking this pool,
		// and any batch already satisfied from the library is reconciled to drain.
		startSubscriptionScheduler((batchIds) => {
			pool?.poke();
			reconcileDrainedBatches(batchIds);
		});

		// Daily radio expansion of recommendation playlists, on the same cadence.
		startRecommendationScheduler((batchIds) => {
			pool?.poke();
			reconcileDrainedBatches(batchIds);
		});

		const shutdown = () => {
			stopSubscriptionScheduler();
			stopRecommendationScheduler();
			void pool?.stop();
			stopYtMusic();
		};
		process.once('SIGTERM', shutdown);
		process.once('SIGINT', shutdown);
	}
	return pool;
}

/**
 * Fire the drain reaction for batches that are already fully terminal right
 * after enqueue - e.g. a playlist whose tracks were all already in the library,
 * so the worker never runs a job to trigger the drain. Call after `enqueue`.
 */
export function reconcileDrainedBatches(batchIds: string[]): void {
	const pool = getPool();
	for (const id of batchIds) pool.notifyIfDrained(id);
}

/**
 * Ensure background services (worker pool, subscription scheduler) are running.
 * Called from `hooks.server.ts` so orphan recovery and the daily subscription
 * check start when the app is first used, not only on the first enqueue.
 */
export function ensureServices(): void {
	if (!building) getPool();
}

/** Test hook. */
export function resetApp(): void {
	stopSubscriptionScheduler();
	stopRecommendationScheduler();
	pool = null;
	batchDrainedHandlers = [];
}
