import { getPool } from '$lib/server/app';
import { publish } from '$lib/server/events';
import { cancelBatch, cancelJob, pauseQueue, resumeQueue, retryJob } from '$lib/server/queue/store';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * POST /api/queue/pause | resume - whole queue
 * POST /api/queue/cancel  { batchId } or { jobId }
 * POST /api/queue/retry   { jobId }
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => ({}))) as { batchId?: string; jobId?: string };

	switch (params.action) {
		case 'pause':
			pauseQueue();
			publish({ type: 'queue', payload: { paused: true } });
			return json({ ok: true });
		case 'resume':
			resumeQueue();
			publish({ type: 'queue', payload: { paused: false } });
			getPool().poke();
			return json({ ok: true });
		case 'cancel': {
			if (body.batchId) {
				const cancelled = cancelBatch(body.batchId);
				for (const id of cancelled) getPool().abortJob(id);
				publish({ type: 'queue', payload: { cancelledBatch: body.batchId } });
				return json({ ok: true, cancelled: cancelled.length });
			}
			if (body.jobId) {
				const ok = cancelJob(body.jobId);
				if (ok) getPool().abortJob(body.jobId);
				publish({ type: 'queue', payload: { cancelledJob: body.jobId } });
				return json({ ok });
			}
			return json({ error: 'batchId or jobId required' }, { status: 400 });
		}
		case 'retry': {
			if (!body.jobId) return json({ error: 'jobId required' }, { status: 400 });
			const ok = retryJob(body.jobId);
			if (ok) getPool().poke();
			return json({ ok });
		}
		default:
			return json({ error: 'unknown action' }, { status: 404 });
	}
};
