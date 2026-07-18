import { getPool } from '$lib/server/app';
import { checkDueSubscriptions } from '$lib/server/subscriptions/check';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Force an immediate check of every subscription, regardless of when each was
 * last checked (interval 0 makes them all due). This is the manual "check now"
 * trigger behind the button on the Subscriptions page.
 */
export const POST: RequestHandler = async () => {
	try {
		const result = await checkDueSubscriptions(0);
		if (result.enqueued > 0) getPool().poke();
		return json({ enqueued: result.enqueued });
	} catch (cause) {
		return json({ error: (cause as Error).message }, { status: 502 });
	}
};
