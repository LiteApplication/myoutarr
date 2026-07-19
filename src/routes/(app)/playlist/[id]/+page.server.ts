import { getPlaylistSubscription } from '$lib/server/playlists/store';
import { findCompletedDownload } from '$lib/server/queue/store';
import { getPlaylist } from '$lib/server/ytmusic/api';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	try {
		const sub = getPlaylistSubscription(params.id, locals.session!.userId);
		const playlist = await getPlaylist(params.id);
		const tracksWithStatus = playlist.tracks.map((track) => ({
			...track,
			isDownloaded: track.videoId ? findCompletedDownload(track.videoId) !== null : false
		}));
		const isDownloaded =
			tracksWithStatus.length > 0 && tracksWithStatus.every((t) => !t.videoId || t.isDownloaded);
		return {
			playlist: {
				...playlist,
				tracks: tracksWithStatus
			},
			synced: sub !== null && sub.enabled,
			isDownloaded
		};
	} catch (cause) {
		error(502, `Could not load playlist: ${(cause as Error).message}`);
	}
};
