import { listRecentJobs } from '$lib/server/queue/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	return { entries: listRecentJobs(locals.session!.userId) };
};
