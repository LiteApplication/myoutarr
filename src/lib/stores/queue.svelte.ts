import { browser } from '$app/environment';
import { SvelteSet } from 'svelte/reactivity';

export interface QueueJob {
	id: string;
	batchId: string;
	videoId: string;
	status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
	progress: number;
	error: string | null;
	meta: { title: string; artist: string; album: string; thumbnail?: string };
}

export interface QueueBatch {
	id: string;
	kind: string;
	sourceId: string;
	title: string;
	artist: string | null;
	thumbnail: string | null;
	createdAt: number;
	/** Set once the batch has been materialised into a Jellyfin playlist. */
	jellyfinPlaylistId: string | null;
	jobs: QueueJob[];
}

class QueueStore {
	batches = $state<QueueBatch[]>([]);
	connected = $state(false);
	private source: EventSource | null = null;
	private retryDelay = 1000;

	/** Job ids present before the current queue session started; excluded from session progress. */
	private baselineJobIds = new Set<string>();
	/** Job ids that have entered the queue since it was last empty. */
	private sessionJobIds = new SvelteSet<string>();

	get activeJobs(): QueueJob[] {
		return this.batches.flatMap((b) => b.jobs.filter((j) => j.status === 'running'));
	}

	get openCount(): number {
		return this.batches.reduce(
			(count, batch) =>
				count + batch.jobs.filter((j) => ['queued', 'running', 'paused'].includes(j.status)).length,
			0
		);
	}

	private get allJobs(): QueueJob[] {
		return this.batches.flatMap((b) => b.jobs);
	}

	/** Fraction (0..1) of the current session's jobs completed, or null if idle. */
	get sessionProgress(): number | null {
		if (this.sessionJobIds.size === 0) return null;
		let sum = 0;
		for (const job of this.allJobs) {
			if (!this.sessionJobIds.has(job.id)) continue;
			if (job.status === 'running') sum += job.progress;
			else if (job.status !== 'queued' && job.status !== 'paused') sum += 1;
		}
		return sum / this.sessionJobIds.size;
	}

	private syncSession(): void {
		if (this.openCount === 0) {
			// Idle: fold everything currently loaded into the baseline so the next
			// batch of jobs starts a fresh session at 0%.
			this.baselineJobIds = new Set(this.allJobs.map((j) => j.id));
			this.sessionJobIds.clear();
			return;
		}
		for (const job of this.allJobs) {
			if (!this.baselineJobIds.has(job.id)) this.sessionJobIds.add(job.id);
		}
	}

	async refresh(): Promise<void> {
		const response = await fetch('/api/queue');
		if (response.ok) {
			const data = (await response.json()) as { batches: QueueBatch[] };
			this.batches = data.batches;
		}
		this.syncSession();
	}

	connect(): void {
		if (!browser || this.source) return;
		void this.refresh();
		this.source = new EventSource('/api/events');
		this.source.onopen = () => {
			this.connected = true;
			this.retryDelay = 1000;
		};
		// Deltas exist for progress smoothness; anything structural refetches.
		this.source.addEventListener('job', (event) => {
			const payload = JSON.parse((event as MessageEvent).data) as {
				id: string;
				status: QueueJob['status'];
				progress: number;
				error?: string | null;
			};
			let structural = true;
			for (const batch of this.batches) {
				const job = batch.jobs.find((j) => j.id === payload.id);
				if (job) {
					structural = job.status !== payload.status;
					job.status = payload.status;
					job.progress = payload.progress;
					if (payload.error !== undefined) job.error = payload.error;
					break;
				}
			}
			if (structural) void this.refresh();
			else this.syncSession();
		});
		this.source.addEventListener('queue', () => void this.refresh());
		this.source.addEventListener('batch', () => void this.refresh());
		this.source.onerror = () => {
			this.connected = false;
			this.source?.close();
			this.source = null;
			setTimeout(() => this.connect(), this.retryDelay);
			this.retryDelay = Math.min(this.retryDelay * 2, 15_000);
		};
	}

	async action(
		action: 'pause' | 'resume' | 'cancel' | 'retry',
		target: { batchId?: string; jobId?: string } = {}
	): Promise<void> {
		await fetch(`/api/queue/${action}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(target)
		});
		await this.refresh();
	}
}

export const queue = new QueueStore();
