import { deleteLibraryEntry } from '$lib/server/library/delete';
import { scheduleRefresh } from '$lib/server/jellyfin/sync';
import { findCompletedDownload } from '$lib/server/queue/store';
import { getAlbum } from '$lib/server/ytmusic/api';
import { musicDir } from '$lib/server/env';
import { error, fail } from '@sveltejs/kit';
import path from 'node:path';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	try {
		const album = await getAlbum(params.id);
		const root = musicDir();
		const tracksWithStatus = album.tracks.map((track) => {
			const absPath =
				track.isAvailable && track.videoId ? findCompletedDownload(track.videoId) : null;
			return {
				...track,
				isDownloaded: absPath !== null,
				/** library-relative path for the delete action, null if not downloaded */
				trackRelativePath: absPath ? path.relative(root, absPath) : null
			};
		});
		const isDownloaded =
			tracksWithStatus.length > 0 &&
			tracksWithStatus.every((t) => !t.isAvailable || !t.videoId || t.isDownloaded);
		// Derive the album directory from the first downloaded track's output path
		const firstRelPath = tracksWithStatus.find((t) => t.trackRelativePath)?.trackRelativePath ?? null;
		const albumRelativeDir = firstRelPath ? path.dirname(firstRelPath) : null;
		return {
			album: {
				...album,
				tracks: tracksWithStatus
			},
			isDownloaded,
			albumRelativeDir
		};
	} catch (cause) {
		error(502, `Could not load album: ${(cause as Error).message}`);
	}
};

export const actions: Actions = {
	delete: async ({ request }) => {
		const form = await request.formData();
		const relative = String(form.get('relative') ?? '').trim();
		if (!relative) return fail(400, { error: 'Nothing to delete.' });
		try {
			deleteLibraryEntry(relative);
			scheduleRefresh();
			return { deleted: true };
		} catch (cause) {
			return fail(500, { error: (cause as Error).message });
		}
	}
};
