import { getPlaylist } from '$lib/server/ytmusic/api';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	try {
		return { playlist: await getPlaylist(params.id) };
	} catch (cause) {
		error(502, `Could not load playlist: ${(cause as Error).message}`);
	}
};
