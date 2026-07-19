import { getPool, reconcileDrainedBatches } from '$lib/server/app';
import { checkDuePlaylistSubscriptions } from '$lib/server/playlists/check';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Force an immediate check of every enabled followed playlist, regardless of
 * when each was last checked (interval 0 makes them all due). This is the manual
 * "check now" trigger behind the button on the Playlist Sync page.
 */
export const POST: RequestHandler = async () => {
	try {
		const result = await checkDuePlaylistSubscriptions(0);
		if (result.enqueued > 0) {
			getPool().poke();
			reconcileDrainedBatches(result.batchIds);
		}
		return json({ enqueued: result.enqueued });
	} catch (cause) {
		return json({ error: (cause as Error).message }, { status: 502 });
	}
};
