import { getSong } from '$lib/server/ytmusic/api';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	try {
		return { song: await getSong(params.id) };
	} catch (cause) {
		error(502, `Could not load song: ${(cause as Error).message}`);
	}
};
