import { getPlaylistSubscription } from '$lib/server/playlists/store';
import { getPlaylist } from '$lib/server/ytmusic/api';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	try {
		const sub = getPlaylistSubscription(params.id);
		return {
			playlist: await getPlaylist(params.id),
			synced: sub !== null && sub.enabled
		};
	} catch (cause) {
		error(502, `Could not load playlist: ${(cause as Error).message}`);
	}
};
