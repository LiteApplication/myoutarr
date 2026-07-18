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
 * Start the daily subscription checker. `onEnqueued` is invoked after a tick
 * that produced new batches, so the caller can poke the worker pool. Idempotent:
 * calling twice is a no-op. Ticks are serialised - a slow check never overlaps
 * the next wake.
 */
export function startSubscriptionScheduler(onEnqueued: () => void): void {
	if (tickTimer) return;

	const runTick = async () => {
		if (running) return;
		running = true;
		try {
			const settings = getSettings();
			if (!settings.subscriptionsEnabled) return;
			const intervalMs = Math.max(1, settings.subscriptionCheckHours) * 60 * 60 * 1000;
			const result = await checkDueSubscriptions(intervalMs);
			if (result.enqueued > 0) onEnqueued();
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
