import { findCompletedDownload } from '$lib/server/queue/store';
import { getSong } from '$lib/server/ytmusic/api';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	try {
		const song = await getSong(params.id);
		const relatedWithStatus = song.related.map((track) => ({
			...track,
			isDownloaded: findCompletedDownload(track.videoId) !== null
		}));
		return {
			song: {
				...song,
				related: relatedWithStatus
			},
			isDownloaded: findCompletedDownload(params.id) !== null
		};
	} catch (cause) {
		error(502, `Could not load song: ${(cause as Error).message}`);
	}
};
