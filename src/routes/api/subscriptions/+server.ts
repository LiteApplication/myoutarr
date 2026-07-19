import { listSubscriptions, subscribe, unsubscribe } from '$lib/server/subscriptions/store';
import { getArtistReleases } from '$lib/server/ytmusic/api';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** YT Music artist channel ids look like `UC…`; validate before hitting the worker. */
const ARTIST_ID = /^UC[A-Za-z0-9_-]{10,}$/;

export const GET: RequestHandler = ({ locals }) => {
	return json({ subscriptions: listSubscriptions(locals.session!.userId) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	let body: { browseId?: unknown };
	try {
		body = (await request.json()) as { browseId?: unknown };
	} catch {
		return json({ error: 'invalid JSON body' }, { status: 400 });
	}
	const browseId = typeof body.browseId === 'string' ? body.browseId : '';
	if (!ARTIST_ID.test(browseId)) {
		return json({ error: 'browseId must be a YT Music artist id (UC…)' }, { status: 400 });
	}
	try {
		// Seed the seen-set with the current discography so future checks only
		// enqueue genuinely new releases.
		const artist = await getArtistReleases(browseId);
		const sub = subscribe(
			{
				browseId,
				name: artist.name,
				thumbnail: artist.thumbnail,
				createdBy: locals.session!.userId
			},
			artist.releases.map((r) => r.browseId)
		);
		return json({ subscription: sub }, { status: 201 });
	} catch (cause) {
		return json({ error: (cause as Error).message }, { status: 502 });
	}
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	let body: { browseId?: unknown };
	try {
		body = (await request.json()) as { browseId?: unknown };
	} catch {
		return json({ error: 'invalid JSON body' }, { status: 400 });
	}
	const browseId = typeof body.browseId === 'string' ? body.browseId : '';
	if (!browseId) return json({ error: 'browseId is required' }, { status: 400 });
	const removed = unsubscribe(browseId, locals.session!.userId);
	return json({ removed });
};
