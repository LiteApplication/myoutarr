import { getDb } from '$lib/server/db/index';
import { listRecentJobs } from '$lib/server/queue/store';
import { listSubscriptions } from '$lib/server/subscriptions/store';
import { listPlaylistSubscriptions } from '$lib/server/playlists/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const db = getDb();

	// Library statistics
	const completedCount = (
		db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE status = 'completed'").get() as { c: number }
	).c;
	const failedCount = (
		db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE status = 'failed'").get() as { c: number }
	).c;
	const queuedCount = (
		db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE status IN ('queued', 'running')").get() as {
			c: number;
		}
	).c;

	const artistSubCount = (
		db.prepare('SELECT COUNT(*) AS c FROM artist_subscriptions').get() as { c: number }
	).c;
	const playlistSubCount = (
		db.prepare('SELECT COUNT(*) AS c FROM playlist_subscriptions').get() as { c: number }
	).c;

	const stats = {
		completedCount,
		failedCount,
		queuedCount,
		subscriptionsCount: artistSubCount + playlistSubCount
	};

	// Get 5 recent downloads
	const recentDownloads = listRecentJobs(db, 5);

	// Get sub lists to display on home page
	const artistSubs = listSubscriptions(db).slice(0, 4);
	const playlistSubs = listPlaylistSubscriptions(db).slice(0, 4);

	return {
		stats,
		recentDownloads,
		artistSubs,
		playlistSubs
	};
};
