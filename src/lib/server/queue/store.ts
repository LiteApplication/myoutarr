import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { DB } from '../db/index.ts';
import { getDb } from '../db/index.ts';

export type JobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type BatchKind = 'song' | 'album' | 'artist' | 'playlist';

export interface JobMeta {
	title: string;
	artist: string;
	album: string;
	albumArtist?: string;
	year?: string;
	genre?: string;
	trackNumber?: number;
	discNumber?: number;
	totalTracks?: number;
	thumbnail?: string;
	albumBrowseId?: string;
	mbArtistId?: string;
	mbAlbumId?: string;
	mbReleaseGroupId?: string;
}

export interface Job {
	id: string;
	batchId: string;
	videoId: string;
	status: JobStatus;
	position: number;
	attempts: number;
	progress: number;
	meta: JobMeta;
	error: string | null;
	nextRetryAt: number | null;
	outputPath: string | null;
}

export interface Batch {
	id: string;
	kind: BatchKind;
	sourceId: string;
	title: string;
	artist: string | null;
	thumbnail: string | null;
	createdAt: number;
	createdBy: string;
}

export interface NewTrack {
	videoId: string;
	meta: JobMeta;
	/**
	 * When set, the track is already in the library at this path: its job is
	 * inserted pre-completed so it isn't re-downloaded, yet still participates in
	 * playlist sync. See `findCompletedDownload`.
	 */
	existingPath?: string;
}

interface JobRow {
	id: string;
	batch_id: string;
	video_id: string;
	status: JobStatus;
	position: number;
	attempts: number;
	progress: number;
	meta: string;
	error: string | null;
	next_retry_at: number | null;
	output_path: string | null;
}

function rowToJob(row: JobRow): Job {
	return {
		id: row.id,
		batchId: row.batch_id,
		videoId: row.video_id,
		status: row.status,
		position: row.position,
		attempts: row.attempts,
		progress: row.progress,
		meta: JSON.parse(row.meta) as JobMeta,
		error: row.error,
		nextRetryAt: row.next_retry_at,
		outputPath: row.output_path
	};
}

/** Create a batch and expand it into one job per track, atomically. */
export function createBatch(
	input: {
		kind: BatchKind;
		sourceId: string;
		title: string;
		artist?: string;
		thumbnail?: string;
		createdBy: string;
		/** Materialise into the Jellyfin playlist by prepending, not appending. */
		prepend?: boolean;
	},
	tracks: NewTrack[],
	db: DB = getDb()
): { batch: Batch; jobs: Job[] } {
	if (tracks.length === 0) throw new Error('batch has no downloadable tracks');
	const batch: Batch = {
		id: randomUUID(),
		kind: input.kind,
		sourceId: input.sourceId,
		title: input.title,
		artist: input.artist ?? null,
		thumbnail: input.thumbnail ?? null,
		createdAt: Date.now(),
		createdBy: input.createdBy
	};
	const insertBatch = db.prepare(
		`INSERT INTO batches (id, kind, source_id, title, artist, thumbnail, created_at, created_by, prepend)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	const nextPosition =
		((db.prepare('SELECT MAX(position) AS p FROM jobs').get() as { p: number | null }).p ?? -1) + 1;
	const insertJob = db.prepare(
		`INSERT INTO jobs (id, batch_id, video_id, position, meta) VALUES (?, ?, ?, ?, ?)`
	);
	// Tracks already in the library are inserted pre-completed: the worker never
	// claims a non-'queued' job, so they are skipped rather than re-downloaded.
	const insertDone = db.prepare(
		`INSERT INTO jobs (id, batch_id, video_id, position, meta, status, progress, started_at, finished_at, output_path)
		 VALUES (?, ?, ?, ?, ?, 'completed', 1, ?, ?, ?)`
	);
	const jobs: Job[] = [];
	db.transaction(() => {
		insertBatch.run(
			batch.id,
			batch.kind,
			batch.sourceId,
			batch.title,
			batch.artist,
			batch.thumbnail,
			batch.createdAt,
			batch.createdBy,
			input.prepend ? 1 : 0
		);
		tracks.forEach((track, index) => {
			const id = randomUUID();
			const position = nextPosition + index;
			if (track.existingPath) {
				insertDone.run(
					id,
					batch.id,
					track.videoId,
					position,
					JSON.stringify(track.meta),
					batch.createdAt,
					batch.createdAt,
					track.existingPath
				);
			} else {
				insertJob.run(id, batch.id, track.videoId, position, JSON.stringify(track.meta));
			}
			jobs.push({
				id,
				batchId: batch.id,
				videoId: track.videoId,
				status: track.existingPath ? 'completed' : 'queued',
				position,
				attempts: 0,
				progress: track.existingPath ? 1 : 0,
				meta: track.meta,
				error: null,
				nextRetryAt: null,
				outputPath: track.existingPath ?? null
			});
		});
	})();
	return { batch, jobs };
}

/**
 * Atomically claim the next runnable job. A single UPDATE…RETURNING keeps two
 * pool slots from grabbing the same row.
 */
export function claimNextJob(db: DB = getDb(), now: number = Date.now()): Job | null {
	const row = db
		.prepare(
			`UPDATE jobs SET status = 'running', started_at = ?, attempts = attempts + 1
			 WHERE id = (
				SELECT id FROM jobs
				WHERE status = 'queued' AND (next_retry_at IS NULL OR next_retry_at <= ?)
				ORDER BY position LIMIT 1
			 )
			 RETURNING *`
		)
		.get(now, now) as JobRow | undefined;
	return row ? rowToJob(row) : null;
}

export function setProgress(id: string, progress: number, db: DB = getDb()): void {
	db.prepare("UPDATE jobs SET progress = ? WHERE id = ? AND status = 'running'").run(progress, id);
}

export function completeJob(id: string, outputPath: string, db: DB = getDb()): void {
	db.prepare(
		"UPDATE jobs SET status = 'completed', progress = 1, finished_at = ?, output_path = ?, error = NULL WHERE id = ?"
	).run(Date.now(), outputPath, id);
}

/** Fail a job; requeue with exponential backoff while attempts remain. */
export function failJob(
	id: string,
	message: string,
	options: { maxRetries: number; retryable: boolean },
	db: DB = getDb()
): 'requeued' | 'failed' {
	const row = db.prepare('SELECT attempts FROM jobs WHERE id = ?').get(id) as
		{ attempts: number } | undefined;
	if (!row) return 'failed';
	const canRetry = options.retryable && row.attempts <= options.maxRetries;
	if (canRetry) {
		const backoffMs = Math.min(60_000 * 2 ** (row.attempts - 1), 15 * 60_000);
		db.prepare(
			"UPDATE jobs SET status = 'queued', error = ?, next_retry_at = ?, progress = 0 WHERE id = ?"
		).run(message, Date.now() + backoffMs, id);
		return 'requeued';
	}
	db.prepare("UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(
		message,
		Date.now(),
		id
	);
	return 'failed';
}

/** Cancel every unfinished job in a batch (running jobs are aborted by the pool). */
export function cancelBatch(batchId: string, db: DB = getDb()): string[] {
	const rows = db
		.prepare(
			`UPDATE jobs SET status = 'cancelled', finished_at = ?
			 WHERE batch_id = ? AND status IN ('queued', 'paused', 'running')
			 RETURNING id, status`
		)
		.all(Date.now(), batchId) as { id: string }[];
	return rows.map((r) => r.id);
}

export function cancelJob(id: string, db: DB = getDb()): boolean {
	return (
		db
			.prepare(
				`UPDATE jobs SET status = 'cancelled', finished_at = ?
			 WHERE id = ? AND status IN ('queued', 'paused', 'running')`
			)
			.run(Date.now(), id).changes > 0
	);
}

export function retryJob(id: string, db: DB = getDb()): boolean {
	return (
		db
			.prepare(
				`UPDATE jobs SET status = 'queued', error = NULL, next_retry_at = NULL, attempts = 0, progress = 0
			 WHERE id = ? AND status IN ('failed', 'cancelled')`
			)
			.run(id).changes > 0
	);
}

export function pauseQueue(db: DB = getDb()): void {
	db.prepare("UPDATE jobs SET status = 'paused' WHERE status = 'queued'").run();
}

export function resumeQueue(db: DB = getDb()): void {
	db.prepare("UPDATE jobs SET status = 'queued' WHERE status = 'paused'").run();
}

/** Boot recovery: jobs left 'running' by a dead process go back to the queue. */
export function recoverOrphans(db: DB = getDb()): number {
	return db
		.prepare(
			"UPDATE jobs SET status = 'queued', progress = 0, attempts = attempts - 1 WHERE status = 'running'"
		)
		.run().changes;
}

/**
 * The library path of an already-downloaded copy of `videoId`, or null. Used to
 * skip re-downloading a track that is already in the library: the most recent
 * completed job for the video whose output file still exists on disk. The
 * existence check means a deleted (or unmounted) file falls through to a fresh
 * download rather than being wrongly skipped.
 */
export function findCompletedDownload(videoId: string, db: DB = getDb()): string | null {
	const row = db
		.prepare(
			`SELECT output_path FROM jobs
			 WHERE video_id = ? AND status = 'completed' AND output_path IS NOT NULL
			 ORDER BY finished_at DESC LIMIT 1`
		)
		.get(videoId) as { output_path: string } | undefined;
	if (!row) return null;
	return existsSync(row.output_path) ? row.output_path : null;
}

export function getJob(id: string, db: DB = getDb()): Job | null {
	const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
	return row ? rowToJob(row) : null;
}

/** The user id (Jellyfin account) that enqueued the batch a job belongs to. */
export function getJobOwner(jobId: string, db: DB = getDb()): string | null {
	const row = db
		.prepare(
			`SELECT b.created_by AS created_by
			 FROM jobs j JOIN batches b ON b.id = j.batch_id
			 WHERE j.id = ?`
		)
		.get(jobId) as { created_by: string } | undefined;
	return row?.created_by ?? null;
}

export interface BatchWithJobs extends Batch {
	jobs: Job[];
}

export function listQueue(db: DB = getDb(), limit = 50): BatchWithJobs[] {
	const batches = db
		.prepare('SELECT * FROM batches ORDER BY created_at DESC LIMIT ?')
		.all(limit) as {
		id: string;
		kind: BatchKind;
		source_id: string;
		title: string;
		artist: string | null;
		thumbnail: string | null;
		created_at: number;
		created_by: string;
	}[];
	const jobsFor = db.prepare('SELECT * FROM jobs WHERE batch_id = ? ORDER BY position');
	return batches.map((b) => ({
		id: b.id,
		kind: b.kind,
		sourceId: b.source_id,
		title: b.title,
		artist: b.artist,
		thumbnail: b.thumbnail,
		createdAt: b.created_at,
		createdBy: b.created_by,
		jobs: (jobsFor.all(b.id) as JobRow[]).map(rowToJob)
	}));
}

export interface LogEntry {
	id: string;
	status: JobStatus;
	attempts: number;
	error: string | null;
	startedAt: number | null;
	finishedAt: number | null;
	outputPath: string | null;
	title: string;
	artist: string;
	batchId: string;
	batchTitle: string;
	batchKind: BatchKind;
	thumbnail: string | null;
}

interface LogRow {
	id: string;
	status: JobStatus;
	attempts: number;
	error: string | null;
	started_at: number | null;
	finished_at: number | null;
	output_path: string | null;
	meta: string;
	batch_id: string;
	batch_title: string;
	batch_kind: BatchKind;
	batch_thumbnail: string | null;
}

/**
 * Recent job history: jobs that have reached a terminal state, most recently
 * finished first. Backs the Logs view - reads straight from the job table, no
 * separate log store needed.
 */
export function listRecentJobs(db: DB = getDb(), limit = 200): LogEntry[] {
	const rows = db
		.prepare(
			`SELECT j.id, j.status, j.attempts, j.error, j.started_at, j.finished_at,
			        j.output_path, j.meta, j.batch_id,
			        b.title AS batch_title, b.kind AS batch_kind, b.thumbnail AS batch_thumbnail
			 FROM jobs j JOIN batches b ON b.id = j.batch_id
			 WHERE j.status IN ('completed', 'failed', 'cancelled')
			 ORDER BY j.finished_at DESC
			 LIMIT ?`
		)
		.all(limit) as LogRow[];
	return rows.map((row) => {
		const meta = JSON.parse(row.meta) as JobMeta;
		return {
			id: row.id,
			status: row.status,
			attempts: row.attempts,
			error: row.error,
			startedAt: row.started_at,
			finishedAt: row.finished_at,
			outputPath: row.output_path,
			title: meta.title ?? '(unknown)',
			artist: meta.artist ?? '',
			batchId: row.batch_id,
			batchTitle: row.batch_title,
			batchKind: row.batch_kind,
			thumbnail: row.batch_thumbnail
		};
	});
}

/** True when every job in the batch has reached a terminal state. */
export function batchDrained(batchId: string, db: DB = getDb()): boolean {
	const row = db
		.prepare(
			`SELECT COUNT(*) AS open FROM jobs
			 WHERE batch_id = ? AND status IN ('queued', 'running', 'paused')`
		)
		.get(batchId) as { open: number };
	return row.open === 0;
}
