import { getPool } from '$lib/server/app';
import { enqueue, type EnqueueRequest } from '$lib/server/queue/enqueue';
import { listQueue } from '$lib/server/queue/store';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	return json({ batches: listQueue() });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	let body: EnqueueRequest;
	try {
		body = (await request.json()) as EnqueueRequest;
	} catch {
		return json({ error: 'invalid JSON body' }, { status: 400 });
	}
	if (!['song', 'album', 'playlist', 'artist'].includes(body?.kind)) {
		return json({ error: 'kind must be song | album | playlist | artist' }, { status: 400 });
	}
	try {
		const batches = await enqueue(body, locals.session!.userId);
		getPool().poke();
		return json({ batches: batches.map((b) => ({ id: b.id, title: b.title })) }, { status: 201 });
	} catch (cause) {
		return json({ error: (cause as Error).message }, { status: 502 });
	}
};
