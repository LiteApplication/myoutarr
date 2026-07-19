import { checkDuePlaylistSubscriptions } from '../playlists/check.ts';
import { getSettings } from '../settings.ts';
import { checkDueSubscriptions } from './check.ts';

/**
 * How often the scheduler wakes to look for artists due a check. Kept short
 * relative to the per-artist interval so a restart re-checks promptly and the
 * effective cadence still tracks `subscriptionCheckHours`.
 */
const TICK_MS = 60 * 60 * 1000; // hourly
/** Let the app settle (worker pool, ytmusic worker) before the first check. */
const BOOT_DELAY_MS = 30_000;

let bootTimer: NodeJS.Timeout | null = null;
let tickTimer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Start the daily subscription checker. `onEnqueued` is invoked with the batch
 * ids produced by a tick, so the caller can poke the worker pool and reconcile
 * any batch already satisfied from the library. Idempotent: calling twice is a
 * no-op. Ticks are serialised - a slow check never overlaps the next wake.
 *
 * Artist auto-download honours the global `subscriptionsEnabled` switch; playlist
 * sync is gated per-playlist (its own `enabled` flag) and always considered here.
 * Both share the `subscriptionCheckHours` cadence.
 */
export function startSubscriptionScheduler(onEnqueued: (batchIds: string[]) => void): void {
	if (tickTimer) return;

	const runTick = async () => {
		if (running) return;
		running = true;
		try {
			const settings = getSettings();
			const intervalMs = Math.max(1, settings.subscriptionCheckHours) * 60 * 60 * 1000;
			const batchIds: string[] = [];
			if (settings.subscriptionsEnabled) {
				batchIds.push(...(await checkDueSubscriptions(intervalMs)).batchIds);
			}
			batchIds.push(...(await checkDuePlaylistSubscriptions(intervalMs)).batchIds);
			if (batchIds.length > 0) onEnqueued(batchIds);
		} catch (cause) {
			console.error('subscription scheduler tick failed:', (cause as Error).message);
		} finally {
			running = false;
		}
	};

	bootTimer = setTimeout(() => void runTick(), BOOT_DELAY_MS);
	bootTimer.unref?.();
	tickTimer = setInterval(() => void runTick(), TICK_MS);
	tickTimer.unref?.();
}

export function stopSubscriptionScheduler(): void {
	if (bootTimer) clearTimeout(bootTimer);
	if (tickTimer) clearInterval(tickTimer);
	bootTimer = null;
	tickTimer = null;
	running = false;
}
