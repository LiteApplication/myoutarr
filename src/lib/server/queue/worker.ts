import type { DB } from '../db/index.ts';
import { getDb } from '../db/index.ts';
import { publish } from '../events.ts';
import { getSettings } from '../settings.ts';
import type { Job } from './store.ts';
import {
	batchDrained,
	claimNextJob,
	completeJob,
	failJob,
	getJob,
	recoverOrphans,
	setProgress
} from './store.ts';

export interface RunResult {
	outputPath: string;
}

export class RetryableJobError extends Error {
	readonly retryable = true;
}

/**
 * Executes one claimed job. Implemented by the yt-dlp pipeline; swapped for a
 * fake in tests. `signal` aborts the underlying processes on cancel/shutdown.
 */
export interface JobRunner {
	run(job: Job, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<RunResult>;
}

export interface WorkerPoolOptions {
	db?: DB;
	concurrency?: () => number;
	maxRetries?: () => number;
	onBatchDrained?: (batchId: string) => void;
}

export class WorkerPool {
	private readonly db: DB;
	private readonly concurrency: () => number;
	private readonly maxRetries: () => number;
	private readonly onBatchDrained?: (batchId: string) => void;
	private readonly aborts = new Map<string, AbortController>();
	private active = 0;
	private stopped = false;
	private retryTimer: NodeJS.Timeout | null = null;

	constructor(
		private readonly runner: JobRunner,
		options: WorkerPoolOptions = {}
	) {
		this.db = options.db ?? getDb();
		this.concurrency = options.concurrency ?? (() => getSettings(this.db).concurrency);
		this.maxRetries = options.maxRetries ?? (() => getSettings(this.db).maxRetries);
		this.onBatchDrained = options.onBatchDrained;
	}

	/** Boot: requeue orphans from a previous process, then start filling slots. */
	start(): void {
		const orphans = recoverOrphans(this.db);
		if (orphans > 0) publish({ type: 'queue', payload: { recovered: orphans } });
		this.poke();
	}

	/** Fill free slots with runnable jobs. Cheap and idempotent — call anytime. */
	poke(): void {
		if (this.stopped) return;
		while (this.active < this.concurrency()) {
			const job = claimNextJob(this.db);
			if (!job) {
				this.scheduleRetryWake();
				return;
			}
			this.active += 1;
			void this.execute(job).finally(() => {
				this.active -= 1;
				this.poke();
			});
		}
	}

	/** Wake up when the earliest backoff gate opens, so retries don't stall. */
	private scheduleRetryWake(): void {
		if (this.retryTimer) return;
		const row = this.db
			.prepare(
				"SELECT MIN(next_retry_at) AS t FROM jobs WHERE status = 'queued' AND next_retry_at IS NOT NULL"
			)
			.get() as { t: number | null };
		if (row.t === null) return;
		const delay = Math.max(row.t - Date.now(), 50);
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null;
			this.poke();
		}, delay);
		this.retryTimer.unref?.();
	}

	private async execute(job: Job): Promise<void> {
		const abort = new AbortController();
		this.aborts.set(job.id, abort);
		this.emitJob(job.id);
		try {
			const result = await this.runner.run(
				job,
				(fraction) => {
					setProgress(job.id, fraction, this.db);
					publish({ type: 'job', payload: { id: job.id, status: 'running', progress: fraction } });
				},
				abort.signal
			);
			// Cancellation may have landed while the runner was finishing up.
			const current = getJob(job.id, this.db);
			if (current?.status === 'running') completeJob(job.id, result.outputPath, this.db);
		} catch (cause) {
			const current = getJob(job.id, this.db);
			if (current?.status === 'running') {
				const retryable = abort.signal.aborted
					? false
					: cause instanceof RetryableJobError ||
						['EIO', 'ESTALE'].includes((cause as NodeJS.ErrnoException).code ?? '');
				failJob(
					job.id,
					(cause as Error).message,
					{ maxRetries: this.maxRetries(), retryable },
					this.db
				);
			}
		} finally {
			this.aborts.delete(job.id);
			this.emitJob(job.id);
			if (batchDrained(job.batchId, this.db)) {
				publish({ type: 'batch', payload: { id: job.batchId, drained: true } });
				this.onBatchDrained?.(job.batchId);
			}
		}
	}

	private emitJob(id: string): void {
		const job = getJob(id, this.db);
		if (job) {
			publish({
				type: 'job',
				payload: {
					id: job.id,
					batchId: job.batchId,
					status: job.status,
					progress: job.progress,
					error: job.error,
					title: job.meta.title
				}
			});
		}
	}

	/** Abort the underlying processes of a cancelled job. */
	abortJob(id: string): void {
		this.aborts.get(id)?.abort();
	}

	async stop(): Promise<void> {
		this.stopped = true;
		if (this.retryTimer) clearTimeout(this.retryTimer);
		for (const [, controller] of this.aborts) controller.abort();
		// Slots drain via execute()'s finally; nothing else to await here because
		// aborted runners reject promptly.
	}

	get activeCount(): number {
		return this.active;
	}
}
