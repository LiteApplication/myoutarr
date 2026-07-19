import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type DB } from '../db/index.ts';
import {
	batchDrained,
	cancelBatch,
	cancelJob,
	claimNextJob,
	completeJob,
	createBatch,
	failJob,
	findCompletedDownload,
	listQueue,
	listRecentJobs,
	pauseQueue,
	recoverOrphans,
	resumeQueue,
	retryJob,
	type Job,
	type NewTrack
} from './store.ts';
import { RetryableJobError, WorkerPool, type JobRunner } from './worker.ts';

let dir: string;
let db: DB;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'myoutarr-queue-'));
	db = openDatabase(path.join(dir, 'test.db'));
});

afterEach(() => {
	vi.useRealTimers();
	db.close();
	rmSync(dir, { recursive: true, force: true });
});

function tracks(n: number): NewTrack[] {
	return Array.from({ length: n }, (_, i) => ({
		videoId: `v${i}`,
		meta: { title: `Track ${i}`, artist: 'A', album: 'B', trackNumber: i + 1 }
	}));
}

function makeBatch(n = 3) {
	return createBatch(
		{ kind: 'album', sourceId: 's1', title: 'Album', createdBy: 'u1' },
		tracks(n),
		db
	);
}

describe('skip already-downloaded', () => {
	it('finds a completed download by video id when its file still exists', () => {
		const existing = path.join(dir, 'Track 0.opus');
		writeFileSync(existing, 'x');
		const { jobs } = makeBatch(1);
		completeJob(jobs[0].id, existing, db);
		expect(findCompletedDownload(jobs[0].videoId, db)).toBe(existing);
	});

	it('does not skip when the earlier file is gone', () => {
		const { jobs } = makeBatch(1);
		completeJob(jobs[0].id, path.join(dir, 'missing.opus'), db);
		expect(findCompletedDownload(jobs[0].videoId, db)).toBeNull();
		expect(findCompletedDownload('never-downloaded', db)).toBeNull();
	});

	it('inserts a pre-completed job for a track with existingPath (no re-download)', () => {
		const existing = path.join(dir, 'have.opus');
		writeFileSync(existing, 'x');
		const { jobs } = createBatch(
			{ kind: 'playlist', sourceId: 'p1', title: 'Mix', createdBy: 'u1' },
			[
				{
					videoId: 'have',
					meta: { title: 'Have', artist: 'A', album: 'B' },
					existingPath: existing
				},
				{ videoId: 'need', meta: { title: 'Need', artist: 'A', album: 'B' } }
			],
			db
		);
		expect(jobs[0]).toMatchObject({ status: 'completed', progress: 1, outputPath: existing });
		expect(jobs[1]).toMatchObject({ status: 'queued', outputPath: null });
		// The worker only ever claims the track that still needs downloading.
		expect(claimNextJob(db)?.videoId).toBe('need');
		expect(claimNextJob(db)).toBeNull();
	});
});

describe('queue store', () => {
	it('expands a batch into ordered per-track jobs', () => {
		const { jobs } = makeBatch(3);
		expect(jobs).toHaveLength(3);
		expect(jobs.map((j) => j.position)).toEqual([0, 1, 2]);
		expect(jobs.every((j) => j.status === 'queued')).toBe(true);
	});

	it('refuses an empty batch', () => {
		expect(() =>
			createBatch({ kind: 'album', sourceId: 's', title: 'T', createdBy: 'u' }, [], db)
		).toThrow(/no downloadable tracks/);
	});

	it('claims jobs in position order, one at a time', () => {
		makeBatch(2);
		const first = claimNextJob(db);
		const second = claimNextJob(db);
		const third = claimNextJob(db);
		expect(first?.videoId).toBe('v0');
		expect(second?.videoId).toBe('v1');
		expect(third).toBeNull();
		expect(first?.attempts).toBe(1);
	});

	it('never double-claims under concurrent claimers (replicas:1 invariant in code)', () => {
		makeBatch(20);
		// Two simulated pool slots interleaving claims on the same DB.
		const claimed: string[] = [];
		for (let i = 0; i < 20; i++) {
			const job = claimNextJob(db);
			if (job) claimed.push(job.id);
		}
		expect(new Set(claimed).size).toBe(20);
		expect(claimNextJob(db)).toBeNull();
	});

	it('respects the retry backoff gate', () => {
		makeBatch(1);
		const job = claimNextJob(db)!;
		expect(failJob(job.id, 'net down', { maxRetries: 3, retryable: true }, db)).toBe('requeued');
		// Gate is in the future → not claimable now…
		expect(claimNextJob(db, Date.now())).toBeNull();
		// …but claimable once the clock passes it.
		expect(claimNextJob(db, Date.now() + 61_000)?.id).toBe(job.id);
	});

	it('fails permanently after max retries', () => {
		makeBatch(1);
		let verdict: 'requeued' | 'failed' = 'requeued';
		for (let attempt = 0; attempt < 5 && verdict === 'requeued'; attempt++) {
			const job = claimNextJob(db, Date.now() + attempt * 16 * 60_000)!;
			verdict = failJob(job.id, 'still broken', { maxRetries: 2, retryable: true }, db);
		}
		expect(verdict).toBe('failed');
		const queue = listQueue(db);
		expect(queue[0].jobs[0].status).toBe('failed');
		expect(queue[0].jobs[0].error).toBe('still broken');
	});

	it('does not retry non-retryable failures', () => {
		makeBatch(1);
		const job = claimNextJob(db)!;
		expect(failJob(job.id, 'video unavailable', { maxRetries: 3, retryable: false }, db)).toBe(
			'failed'
		);
	});

	it('recovers orphaned running jobs on boot without burning an attempt', () => {
		makeBatch(2);
		claimNextJob(db);
		claimNextJob(db);
		expect(recoverOrphans(db)).toBe(2);
		const next = claimNextJob(db)!;
		expect(next.attempts).toBe(1); // recovery refunded the attempt
	});

	it('cancels a whole batch and can retry a cancelled job', () => {
		const { batch } = makeBatch(3);
		claimNextJob(db);
		const cancelled = cancelBatch(batch.id, db);
		expect(cancelled).toHaveLength(3);
		expect(batchDrained(batch.id, db)).toBe(true);
		const jobId = listQueue(db)[0].jobs[0].id;
		expect(retryJob(jobId, db)).toBe(true);
		expect(batchDrained(batch.id, db)).toBe(false);
	});

	it('pause/resume flips queued jobs only', () => {
		makeBatch(2);
		const running = claimNextJob(db)!;
		pauseQueue(db);
		expect(claimNextJob(db)).toBeNull();
		resumeQueue(db);
		expect(claimNextJob(db)).not.toBeNull();
		expect(cancelJob(running.id, db)).toBe(true);
	});

	it('completes a job with its output path', () => {
		makeBatch(1);
		const job = claimNextJob(db)!;
		completeJob(job.id, '/music/A/B/01 - Track 0.opus', db);
		const stored = listQueue(db)[0].jobs[0];
		expect(stored.status).toBe('completed');
		expect(stored.progress).toBe(1);
		expect(stored.outputPath).toBe('/music/A/B/01 - Track 0.opus');
	});

	it('lists only terminal jobs as recent history, most recent first', () => {
		vi.useFakeTimers();
		makeBatch(3);
		const a = claimNextJob(db)!;
		vi.setSystemTime(1000);
		completeJob(a.id, '/music/x.opus', db);
		const b = claimNextJob(db)!;
		vi.setSystemTime(2000); // b finishes strictly after a
		failJob(b.id, 'boom', { maxRetries: 0, retryable: false }, db);
		// third job stays queued and must not appear in the log

		const log = listRecentJobs(db);
		expect(log).toHaveLength(2);
		expect(log.every((e) => e.status !== 'queued')).toBe(true);
		// finished_at DESC → the failure (finished last) comes first
		expect(log[0].id).toBe(b.id);
		expect(log[0].status).toBe('failed');
		expect(log[0].error).toBe('boom');
		expect(log[0].title).toBe('Track 1');
		expect(log[0].batchTitle).toBe('Album');
		expect(log[1].id).toBe(a.id);
		expect(log[1].outputPath).toBe('/music/x.opus');
	});
});

describe('worker pool', () => {
	function runnerOf(
		fn: (job: Job, onProgress: (f: number) => void, signal: AbortSignal) => Promise<string>
	): JobRunner {
		return {
			run: async (job, onProgress, signal) => ({ outputPath: await fn(job, onProgress, signal) })
		};
	}

	async function drain(pool: WorkerPool, batchId: string, timeoutMs = 5000): Promise<void> {
		const start = Date.now();
		while (!batchDrained(batchId, db)) {
			if (Date.now() - start > timeoutMs) throw new Error('drain timeout');
			await new Promise((r) => setTimeout(r, 20));
		}
	}

	it('runs all jobs and respects the concurrency cap', async () => {
		const { batch } = makeBatch(6);
		let peak = 0;
		let inFlight = 0;
		const pool = new WorkerPool(
			runnerOf(async (job) => {
				inFlight += 1;
				peak = Math.max(peak, inFlight);
				await new Promise((r) => setTimeout(r, 30));
				inFlight -= 1;
				return `/out/${job.videoId}`;
			}),
			{ db, concurrency: () => 2, maxRetries: () => 0 }
		);
		pool.start();
		await drain(pool, batch.id);
		expect(peak).toBeLessThanOrEqual(2);
		const jobs = listQueue(db)[0].jobs;
		expect(jobs.every((j) => j.status === 'completed')).toBe(true);
		await pool.stop();
	});

	it('retries retryable failures and eventually succeeds', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
		try {
			const { batch } = makeBatch(1);
			let calls = 0;
			const pool = new WorkerPool(
				runnerOf(async (job) => {
					calls += 1;
					if (calls < 3) throw new RetryableJobError('flaky network');
					return `/out/${job.videoId}`;
				}),
				{ db, concurrency: () => 1, maxRetries: () => 5 }
			);
			pool.start();
			// Each failure schedules a backoff wake; advance through them.
			for (let i = 0; i < 6; i++) {
				await vi.advanceTimersByTimeAsync(16 * 60_000);
				if (batchDrained(batch.id, db)) break;
			}
			expect(calls).toBe(3);
			expect(listQueue(db)[0].jobs[0].status).toBe('completed');
			await pool.stop();
		} finally {
			vi.useRealTimers();
		}
	});

	it('marks non-retryable failures failed immediately', async () => {
		const { batch } = makeBatch(1);
		const pool = new WorkerPool(
			runnerOf(async () => {
				throw new Error('video unavailable');
			}),
			{ db, concurrency: () => 1, maxRetries: () => 3 }
		);
		pool.start();
		await drain(pool, batch.id);
		const job = listQueue(db)[0].jobs[0];
		expect(job.status).toBe('failed');
		expect(job.error).toBe('video unavailable');
		await pool.stop();
	});

	it('aborting a cancelled job leaves it cancelled, not failed', async () => {
		const { batch, jobs } = makeBatch(1);
		const pool = new WorkerPool(
			runnerOf(
				(_job, _p, signal) =>
					new Promise((_resolve, reject) => {
						signal.addEventListener('abort', () => reject(new Error('aborted')));
					})
			),
			{ db, concurrency: () => 1, maxRetries: () => 3 }
		);
		pool.start();
		await new Promise((r) => setTimeout(r, 50)); // let it claim and start
		cancelJob(jobs[0].id, db);
		pool.abortJob(jobs[0].id);
		await drain(pool, batch.id);
		expect(listQueue(db)[0].jobs[0].status).toBe('cancelled');
		await pool.stop();
	});

	it('fires onBatchDrained exactly once per drained batch', async () => {
		const { batch } = makeBatch(3);
		const drained: string[] = [];
		const pool = new WorkerPool(
			runnerOf(async (job) => `/out/${job.videoId}`),
			{ db, concurrency: () => 3, maxRetries: () => 0, onBatchDrained: (id) => drained.push(id) }
		);
		pool.start();
		await drain(pool, batch.id);
		await new Promise((r) => setTimeout(r, 50));
		expect(drained.filter((id) => id === batch.id)).toHaveLength(1);
		await pool.stop();
	});
});
