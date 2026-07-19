import { getDb } from '$lib/server/db/index';
import { listRecentJobs } from '$lib/server/queue/store';
import { listSubscriptions } from '$lib/server/subscriptions/store';
import { listPlaylistSubscriptions } from '$lib/server/playlists/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const db = getDb();
	const userId = locals.session!.userId;

	// Library statistics - scoped to the signed-in user's own downloads.
	const jobCount = (status: string) =>
		(
			db
				.prepare(
					`SELECT COUNT(*) AS c FROM jobs j JOIN batches b ON b.id = j.batch_id
					 WHERE j.status = ? AND b.created_by = ?`
				)
				.get(status, userId) as { c: number }
		).c;
	const completedCount = jobCount('completed');
	const failedCount = jobCount('failed');
	const queuedCount = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM jobs j JOIN batches b ON b.id = j.batch_id
				 WHERE j.status IN ('queued', 'running') AND b.created_by = ?`
			)
			.get(userId) as { c: number }
	).c;

	const artistSubCount = (
		db
			.prepare('SELECT COUNT(*) AS c FROM artist_subscriptions WHERE created_by = ?')
			.get(userId) as { c: number }
	).c;
	const playlistSubCount = (
		db
			.prepare('SELECT COUNT(*) AS c FROM playlist_subscriptions WHERE created_by = ?')
			.get(userId) as { c: number }
	).c;

	const stats = {
		completedCount,
		failedCount,
		queuedCount,
		subscriptionsCount: artistSubCount + playlistSubCount
	};

	// Get 5 recent downloads
	const recentDownloads = listRecentJobs(userId, db, 5);

	// Get sub lists to display on home page
	const artistSubs = listSubscriptions(userId, db).slice(0, 4);
	const playlistSubs = listPlaylistSubscriptions(userId, db).slice(0, 4);

	return {
		stats,
		recentDownloads,
		artistSubs,
		playlistSubs
	};
};
