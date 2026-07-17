import { readTags } from '$lib/server/library/browse';
import { applyTags } from '$lib/server/library/edit';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const relative = url.searchParams.get('path');
	if (!relative) error(400, 'path query parameter required');
	try {
		return { path: relative, tags: await readTags(relative) };
	} catch (cause) {
		error(404, `Could not read tags: ${(cause as Error).message}`);
	}
};

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const relative = String(form.get('path') ?? '');
		const title = String(form.get('title') ?? '').trim();
		const artist = String(form.get('artist') ?? '').trim();
		const album = String(form.get('album') ?? '').trim();
		if (!relative || !title || !artist || !album) {
			return fail(400, { error: 'Title, artist, and album are required.' });
		}
		const trackRaw = String(form.get('trackNumber') ?? '').trim();
		try {
			const result = await applyTags(relative, {
				title,
				artist,
				album,
				albumArtist: String(form.get('albumArtist') ?? '').trim() || undefined,
				year: String(form.get('year') ?? '').trim() || undefined,
				genre: String(form.get('genre') ?? '').trim() || undefined,
				trackNumber: trackRaw ? Number(trackRaw) : undefined
			});
			redirect(
				303,
				`/library?path=${encodeURIComponent(result.newPath.split('/').slice(0, -1).join('/'))}`
			);
		} catch (cause) {
			if ((cause as { status?: number }).status === 303) throw cause;
			return fail(500, { error: (cause as Error).message });
		}
	}
};
