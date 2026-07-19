import { getPool, reconcileDrainedBatches } from '$lib/server/app';
import { expandDuePlaylists } from '$lib/server/recommendations/check';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Force an immediate expansion of every recommendation playlist, regardless of
 * when each was last run (interval 0 makes them all due). Backs the "Expand now"
 * button on the Recommendations page.
 */
export const POST: RequestHandler = async () => {
	try {
		const result = await expandDuePlaylists(0);
		if (result.enqueued > 0) {
			getPool().poke();
			reconcileDrainedBatches(result.batchIds);
		}
		return json({ enqueued: result.enqueued });
	} catch (cause) {
		return json({ error: (cause as Error).message }, { status: 502 });
	}
};
