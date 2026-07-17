import { listLibrary } from '$lib/server/library/browse';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const relative = url.searchParams.get('path') ?? '';
	try {
		return { path: relative, entries: listLibrary(relative), error: null };
	} catch (cause) {
		return { path: '', entries: [], error: (cause as Error).message };
	}
};
