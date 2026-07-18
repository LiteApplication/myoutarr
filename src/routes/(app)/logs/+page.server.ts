import { listRecentJobs } from '$lib/server/queue/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	return { entries: listRecentJobs() };
};
