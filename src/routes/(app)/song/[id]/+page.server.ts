import { deleteLibraryEntry } from '$lib/server/library/delete';
import { scheduleRefresh } from '$lib/server/jellyfin/sync';
import { findCompletedDownload } from '$lib/server/queue/store';
import { getSong } from '$lib/server/ytmusic/api';
import { musicDir } from '$lib/server/env';
import { error, fail } from '@sveltejs/kit';
import path from 'node:path';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	try {
		const song = await getSong(params.id);
		const relatedWithStatus = song.related.map((track) => ({
			...track,
			isDownloaded: findCompletedDownload(track.videoId) !== null
		}));
		const outputPath = findCompletedDownload(params.id);
		return {
			song: {
				...song,
				related: relatedWithStatus
			},
			isDownloaded: outputPath !== null,
			outputPath
		};
	} catch (cause) {
		error(502, `Could not load song: ${(cause as Error).message}`);
	}
};

export const actions: Actions = {
	delete: async ({ request }) => {
		const form = await request.formData();
		const outputPath = String(form.get('outputPath') ?? '').trim();
		if (!outputPath) return fail(400, { error: 'Nothing to delete.' });
		try {
			const root = musicDir();
			const relative = path.relative(root, outputPath);
			deleteLibraryEntry(relative);
			scheduleRefresh();
			return { deleted: true };
		} catch (cause) {
			return fail(500, { error: (cause as Error).message });
		}
	}
};
