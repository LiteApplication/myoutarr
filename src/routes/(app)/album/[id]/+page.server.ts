import { getAlbum } from '$lib/server/ytmusic/api';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	try {
		return { album: await getAlbum(params.id) };
	} catch (cause) {
		error(502, `Could not load album: ${(cause as Error).message}`);
	}
};
