import { getSettings } from '../settings.ts';
import { expandDuePlaylists } from './check.ts';

/**
 * How often the scheduler wakes to look for playlists due an expansion. Kept
 * short relative to the per-playlist interval so a restart re-checks promptly
 * and the effective cadence still tracks `subscriptionCheckHours`.
 */
const TICK_MS = 60 * 60 * 1000; // hourly
/** Let the app settle (worker pool, ytmusic worker) before the first run. */
const BOOT_DELAY_MS = 45_000;

let bootTimer: NodeJS.Timeout | null = null;
let tickTimer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Start the daily recommendation-playlist expander. `onEnqueued` is invoked with
 * the batch ids produced by a tick so the caller can poke the worker pool and
 * reconcile any batch already satisfied from the library. Idempotent: calling
 * twice is a no-op. Ticks are serialised - a slow run never overlaps the next
 * wake. Gated by `recommendationsEnabled`; the cadence reuses
 * `subscriptionCheckHours`.
 */
export function startRecommendationScheduler(onEnqueued: (batchIds: string[]) => void): void {
	if (tickTimer) return;

	const runTick = async () => {
		if (running) return;
		running = true;
		try {
			const settings = getSettings();
			if (!settings.recommendationsEnabled) return;
			const intervalMs = Math.max(1, settings.subscriptionCheckHours) * 60 * 60 * 1000;
			const { batchIds } = await expandDuePlaylists(intervalMs);
			if (batchIds.length > 0) onEnqueued(batchIds);
		} catch (cause) {
			console.error('recommendation scheduler tick failed:', (cause as Error).message);
		} finally {
			running = false;
		}
	};

	bootTimer = setTimeout(() => void runTick(), BOOT_DELAY_MS);
	bootTimer.unref?.();
	tickTimer = setInterval(() => void runTick(), TICK_MS);
	tickTimer.unref?.();
}

export function stopRecommendationScheduler(): void {
	if (bootTimer) clearTimeout(bootTimer);
	if (tickTimer) clearInterval(tickTimer);
	bootTimer = null;
	tickTimer = null;
	running = false;
}
