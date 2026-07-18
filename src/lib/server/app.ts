import { building } from '$app/environment';
import { scheduleRefresh, syncPlaylistBatch } from './jellyfin/sync.ts';
import { enrichMeta } from './musicbrainz/client.ts';
import { WorkerPool } from './queue/worker.ts';
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
			}
		});
		pool.start();

		// Daily check for new releases from subscribed artists; enqueued batches
		// are picked up by poking this same pool.
		startSubscriptionScheduler(() => pool?.poke());

		const shutdown = () => {
			stopSubscriptionScheduler();
			void pool?.stop();
			stopYtMusic();
		};
		process.once('SIGTERM', shutdown);
		process.once('SIGINT', shutdown);
	}
	return pool;
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
	pool = null;
	batchDrainedHandlers = [];
}
