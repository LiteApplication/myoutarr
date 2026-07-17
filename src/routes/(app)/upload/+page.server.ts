import { ingestUpload } from '$lib/server/library/edit';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'Choose an audio file to upload.' });
		}
		const title = String(form.get('title') ?? '').trim();
		const artist = String(form.get('artist') ?? '').trim();
		const album = String(form.get('album') ?? '').trim();
		if (!title || !artist || !album) {
			return fail(400, { error: 'Title, artist, and album are required.' });
		}
		const trackRaw = String(form.get('trackNumber') ?? '').trim();
		try {
			const data = Buffer.from(await file.arrayBuffer());
			const result = await ingestUpload(file.name, data, {
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
