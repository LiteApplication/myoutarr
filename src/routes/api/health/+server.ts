import { getDb } from '$lib/server/db/index';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	try {
		getDb().prepare('SELECT 1').get();
		return json({ status: 'ok' });
	} catch (error) {
		return json({ status: 'error', detail: (error as Error).message }, { status: 503 });
	}
};
