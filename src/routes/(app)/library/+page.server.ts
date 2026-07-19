import { listLibrary } from '$lib/server/library/browse';
import { deleteLibraryEntry } from '$lib/server/library/delete';
import { scheduleRefresh } from '$lib/server/jellyfin/sync';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const relative = url.searchParams.get('path') ?? '';
	try {
		return { path: relative, entries: listLibrary(relative), error: null };
	} catch (cause) {
		return { path: '', entries: [], error: (cause as Error).message };
	}
};

export const actions: Actions = {
	delete: async ({ request }) => {
		const form = await request.formData();
		const relative = String(form.get('path') ?? '').trim();
		if (!relative) return fail(400, { error: 'Nothing to delete.' });
		try {
			const result = deleteLibraryEntry(relative);
			scheduleRefresh();
			return { deleted: result.removed };
		} catch (cause) {
			return fail(500, { error: (cause as Error).message });
		}
	}
};
