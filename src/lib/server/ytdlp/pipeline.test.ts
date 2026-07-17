import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../db/index.ts';
import { createSentinel } from '../library/publish.ts';
import { claimNextJob, createBatch, listQueue } from '../queue/store.ts';
import { WorkerPool } from '../queue/worker.ts';
import { YtdlpPipeline } from './runner.ts';

const HERE = import.meta.dirname;
const PROJECT = path.resolve(HERE, '../../../..');
const PYTHON = path.join(PROJECT, '.venv/bin/python');
const FIXTURE = path.join(tmpdir(), 'myoutarr-fixture.opus');

// Wrapper so the pipeline can spawn "yt-dlp" as a single binary path.
let fakeBin: string;

beforeAll(() => {
	if (!existsSync(FIXTURE)) {
		// 2 seconds of A440 — a real, taggable Opus file.
		execFileSync('ffmpeg', [
			'-y',
			'-loglevel',
			'error',
			'-f',
			'lavfi',
			'-i',
			'sine=frequency=440:duration=2',
			'-c:a',
			'libopus',
			FIXTURE
		]);
	}
	fakeBin = path.join(tmpdir(), 'myoutarr-fake-ytdlp.sh');
	execFileSync('bash', [
		'-c',
		`printf '#!/bin/bash\\nexec "${PYTHON}" "${HERE}/fake_ytdlp.py" "$@"\\n' > ${fakeBin} && chmod +x ${fakeBin}`
	]);
});

let dir: string;
let db: DB;
let library: string;
let scratch: string;
let staging: string;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'myoutarr-pipe-'));
	db = openDatabase(path.join(dir, 'test.db'));
	library = path.join(dir, 'music');
	scratch = path.join(dir, 'scratch');
	staging = path.join(library, '.myoutarr-staging');
	mkdirSync(library, { recursive: true });
	mkdirSync(scratch, { recursive: true });
	createSentinel(library);
	process.env.FAKE_YTDLP_FIXTURE = FIXTURE;
	process.env.FAKE_YTDLP_MODE = 'ok';
});

afterEach(() => {
	db.close();
	rmSync(dir, { recursive: true, force: true });
});

function pipeline(): YtdlpPipeline {
	return new YtdlpPipeline({
		db,
		ytdlpBin: fakeBin,
		pythonBin: PYTHON,
		tagScript: path.join(PROJECT, 'python/tag.py'),
		libraryRoot: library,
		staging,
		scratchRoot: scratch,
		fetchImpl: (async () => new Response('nope', { status: 404 })) as typeof fetch
	});
}

function seedAlbum() {
	return createBatch(
		{ kind: 'album', sourceId: 'MPREb_x', title: 'Discovery', artist: 'Daft Punk', createdBy: 'u' },
		[
			{
				videoId: 'IluRBvnYMoY',
				meta: {
					title: 'One More Time',
					artist: 'Daft Punk',
					album: 'Discovery',
					albumArtist: 'Daft Punk',
					year: '2001',
					trackNumber: 1,
					totalTracks: 2
				}
			},
			{
				videoId: 'FGBhQbmPwH8',
				meta: {
					title: 'Aerodynamic <live> & loud',
					artist: 'Daft Punk',
					album: 'Discovery',
					albumArtist: 'Daft Punk',
					year: '2001',
					trackNumber: 2,
					totalTracks: 2
				}
			}
		],
		db
	);
}

describe('full pipeline', () => {
	it('downloads, tags, publishes, and writes NFOs end to end', async () => {
		const { batch } = seedAlbum();
		const pool = new WorkerPool(pipeline(), { db, concurrency: () => 2, maxRetries: () => 0 });
		pool.start();
		const start = Date.now();
		while (listQueue(db)[0].jobs.some((j) => !['completed', 'failed'].includes(j.status))) {
			if (Date.now() - start > 30_000) throw new Error('pipeline timeout');
			await new Promise((r) => setTimeout(r, 50));
		}
		await pool.stop();

		const jobs = listQueue(db)[0].jobs;
		expect(jobs.map((j) => j.status)).toEqual(['completed', 'completed']);

		const albumDir = path.join(library, 'Daft Punk', 'Discovery (2001)');
		expect(existsSync(path.join(albumDir, '01 - One More Time.opus'))).toBe(true);
		// XML-hostile title survived sanitisation into a safe filename…
		expect(existsSync(path.join(albumDir, '02 - Aerodynamic _live_ & loud.opus'))).toBe(true);

		// …and was escaped inside the NFO.
		const nfo = readFileSync(path.join(albumDir, 'album.nfo'), 'utf8');
		expect(nfo).toContain('Aerodynamic &lt;live&gt; &amp; loud');
		expect(nfo).toContain('<year>2001</year>');
		expect(existsSync(path.join(library, 'Daft Punk', 'artist.nfo'))).toBe(true);

		// Real mutagen tags in the real Opus file.
		const probe = execFileSync(PYTHON, [
			'-c',
			`from mutagen.oggopus import OggOpus; a = OggOpus(${JSON.stringify(
				path.join(albumDir, '01 - One More Time.opus')
			)}); print(a['title'][0], '|', a['album'][0], '|', a['date'][0], '|', a['tracknumber'][0])`
		]).toString();
		expect(probe.trim()).toBe('One More Time | Discovery | 2001 | 1');

		// Scratch and staging fully cleaned.
		expect(existsSync(path.join(staging, jobs[0].id))).toBe(false);
		expect(existsSync(path.join(scratch, jobs[0].id))).toBe(false);

		expect(batch.id).toBeTruthy();
	}, 40_000);

	it('classifies permanent failures without retrying', async () => {
		process.env.FAKE_YTDLP_MODE = 'fail-permanent';
		seedAlbum();
		const job = claimNextJob(db)!;
		const failure = await pipeline()
			.run(job, () => {}, new AbortController().signal)
			.then(
				() => null,
				(cause: Error & { retryable?: boolean }) => cause
			);
		expect(failure?.message).toMatch(/Video unavailable/);
		expect(failure?.retryable).toBeUndefined();
	});

	it('classifies transient failures as retryable', async () => {
		process.env.FAKE_YTDLP_MODE = 'fail-transient';
		seedAlbum();
		const job = claimNextJob(db)!;
		await expect(pipeline().run(job, () => {}, new AbortController().signal)).rejects.toMatchObject(
			{ retryable: true }
		);
	});

	it('reports monotonic progress during a run', async () => {
		seedAlbum();
		const job = claimNextJob(db)!;
		const fractions: number[] = [];
		await pipeline().run(job, (f) => fractions.push(f), new AbortController().signal);
		expect(fractions.length).toBeGreaterThanOrEqual(4);
		const sorted = [...fractions].sort((a, b) => a - b);
		expect(fractions).toEqual(sorted);
		expect(fractions.at(-1)).toBe(1);
	});
});
