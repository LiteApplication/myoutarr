import { findCompletedDownload } from '$lib/server/queue/store';
import { getAlbum } from '$lib/server/ytmusic/api';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	try {
		const album = await getAlbum(params.id);
		const tracksWithStatus = album.tracks.map((track) => ({
			...track,
			isDownloaded:
				track.isAvailable && track.videoId ? findCompletedDownload(track.videoId) !== null : false
		}));
		const isDownloaded =
			tracksWithStatus.length > 0 &&
			tracksWithStatus.every((t) => !t.isAvailable || !t.videoId || t.isDownloaded);
		return {
			album: {
				...album,
				tracks: tracksWithStatus
			},
			isDownloaded
		};
	} catch (cause) {
		error(502, `Could not load album: ${(cause as Error).message}`);
	}
};
