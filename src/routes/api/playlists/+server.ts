import {
	listPlaylistSubscriptions,
	setPlaylistEnabled,
	subscribePlaylist,
	unsubscribePlaylist
} from '$lib/server/playlists/store';
import { getPlaylist } from '$lib/server/ytmusic/api';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** YT Music playlist ids (VL…/PL…/OLAK5uy…/RD…) are word-safe and reasonably long. */
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,}$/;

export const GET: RequestHandler = () => {
	return json({ subscriptions: listPlaylistSubscriptions() });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	let body: { browseId?: unknown };
	try {
		body = (await request.json()) as { browseId?: unknown };
	} catch {
		return json({ error: 'invalid JSON body' }, { status: 400 });
	}
	const browseId = typeof body.browseId === 'string' ? body.browseId : '';
	if (!PLAYLIST_ID.test(browseId)) {
		return json({ error: 'browseId must be a YT Music playlist id' }, { status: 400 });
	}
	try {
		// Seed the seen-set with the current tracklist so future checks only
		// download songs added after the playlist was followed.
		const playlist = await getPlaylist(browseId);
		const sub = subscribePlaylist(
			{
				browseId,
				title: playlist.title,
				thumbnail: playlist.thumbnails.at(-1)?.url ?? null,
				createdBy: locals.session!.userId
			},
			playlist.tracks.map((t) => t.videoId).filter((id): id is string => Boolean(id))
		);
		return json({ subscription: sub }, { status: 201 });
	} catch (cause) {
		return json({ error: (cause as Error).message }, { status: 502 });
	}
};

export const PATCH: RequestHandler = async ({ request }) => {
	let body: { browseId?: unknown; enabled?: unknown };
	try {
		body = (await request.json()) as { browseId?: unknown; enabled?: unknown };
	} catch {
		return json({ error: 'invalid JSON body' }, { status: 400 });
	}
	const browseId = typeof body.browseId === 'string' ? body.browseId : '';
	if (!browseId) return json({ error: 'browseId is required' }, { status: 400 });
	if (typeof body.enabled !== 'boolean') {
		return json({ error: 'enabled must be a boolean' }, { status: 400 });
	}
	const updated = setPlaylistEnabled(browseId, body.enabled);
	return json({ updated });
};

export const DELETE: RequestHandler = async ({ request }) => {
	let body: { browseId?: unknown };
	try {
		body = (await request.json()) as { browseId?: unknown };
	} catch {
		return json({ error: 'invalid JSON body' }, { status: 400 });
	}
	const browseId = typeof body.browseId === 'string' ? body.browseId : '';
	if (!browseId) return json({ error: 'browseId is required' }, { status: 400 });
	const removed = unsubscribePlaylist(browseId);
	return json({ removed });
};
