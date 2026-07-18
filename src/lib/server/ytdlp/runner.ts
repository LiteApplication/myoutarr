import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { DB } from '../db/index.ts';
import { getDb } from '../db/index.ts';
import { musicDir, potProviderBaseUrl, scratchDir, ytdlpJsRuntimes } from '../env.ts';
import { renderTemplate, resolveLibraryPath } from '../library/naming.ts';
import { albumNfo, artistNfo } from '../library/nfo.ts';
import { publishFile, writeSidecar } from '../library/publish.ts';
import { getJobOwner } from '../queue/store.ts';
import type { Job, JobMeta } from '../queue/store.ts';
import type { JobRunner, RunResult } from '../queue/worker.ts';
import { RetryableJobError } from '../queue/worker.ts';
import { getSettings } from '../settings.ts';
import { buildYtdlpArgs } from './args.ts';
import { resolveCookiesFile } from './cookies.ts';
import { parseProgressLine } from './progress.ts';

const AUDIO_EXTENSIONS = ['opus', 'm4a', 'mp3', 'flac', 'ogg', 'webm'];

/** Fraction of the progress bar given to the download phase; the rest is tag+publish. */
const DOWNLOAD_SHARE = 0.85;

export interface PipelineOptions {
	db?: DB;
	ytdlpBin?: string;
	pythonBin?: string;
	tagScript?: string;
	libraryRoot?: string;
	staging?: string;
	scratchRoot?: string;
	/** Directory holding per-account cookies (defaults to the config dir). */
	cookiesRoot?: string;
	/** Optional metadata enrichment hook (MusicBrainz); identity by default. */
	enrich?: (meta: JobMeta) => Promise<JobMeta>;
	fetchImpl?: typeof fetch;
}

export class YtdlpPipeline implements JobRunner {
	private readonly db: DB;
	private readonly ytdlpBin: string;
	private readonly pythonBin: string;
	private readonly tagScript: string;
	private readonly enrich: (meta: JobMeta) => Promise<JobMeta>;
	private readonly fetchImpl: typeof fetch;

	constructor(private readonly options: PipelineOptions = {}) {
		this.db = options.db ?? getDb();
		this.ytdlpBin = options.ytdlpBin ?? process.env.YTDLP_BIN ?? 'yt-dlp';
		this.pythonBin = options.pythonBin ?? process.env.YTM_PYTHON ?? 'python3';
		this.tagScript = options.tagScript ?? process.env.TAG_SCRIPT ?? 'python/tag.py';
		this.enrich = options.enrich ?? (async (meta) => meta);
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	async run(
		job: Job,
		onProgress: (fraction: number) => void,
		signal: AbortSignal
	): Promise<RunResult> {
		const scratch = path.join(this.options.scratchRoot ?? scratchDir(), job.id);
		mkdirSync(scratch, { recursive: true });
		try {
			await this.download(job, scratch, onProgress, signal);
			const audioFile = this.findAudioFile(scratch);

			const meta = await this.enrich(job.meta).catch(() => job.meta);
			const coverPath = await this.fetchCover(meta, scratch, signal);
			await this.tag(audioFile, meta, coverPath, signal);
			onProgress(0.92);

			const settings = getSettings(this.db);
			const libraryRoot = this.options.libraryRoot ?? musicDir();
			const ext = path.extname(audioFile).slice(1);
			const relative = renderTemplate(settings.namingTemplate, meta);
			const targetPath = resolveLibraryPath(libraryRoot, relative, ext);

			this.publishWithRetryClassification(audioFile, targetPath, job.id, libraryRoot);
			onProgress(0.97);

			this.writeSidecars(job, meta, targetPath, coverPath, libraryRoot);
			onProgress(1);
			return { outputPath: targetPath };
		} finally {
			rmSync(scratch, { recursive: true, force: true });
		}
	}

	private download(
		job: Job,
		scratch: string,
		onProgress: (fraction: number) => void,
		signal: AbortSignal
	): Promise<void> {
		const settings = getSettings(this.db);
		const cookiesRoot =
			this.options.cookiesRoot ?? path.dirname(this.options.scratchRoot ?? scratchDir());
		const owner = getJobOwner(job.id, this.db);
		const args = buildYtdlpArgs({
			videoId: job.videoId,
			scratchDir: scratch,
			settings,
			cookiesFile: resolveCookiesFile(owner, cookiesRoot),
			potProviderBaseUrl: potProviderBaseUrl(),
			jsRuntimes: ytdlpJsRuntimes()
		});
		return new Promise<void>((resolve, reject) => {
			const child = spawn(this.ytdlpBin, args, { stdio: ['ignore', 'pipe', 'pipe'], signal });
			const stderrTail: string[] = [];
			createInterface({ input: child.stdout }).on('line', (line) => {
				const update = parseProgressLine(line);
				if (update) onProgress(update.fraction * DOWNLOAD_SHARE);
			});
			createInterface({ input: child.stderr }).on('line', (line) => {
				// Mirror yt-dlp diagnostics to the server log so failures are visible
				// live, not just in the final error message.
				console.error(`[yt-dlp ${job.videoId}] ${line}`);
				stderrTail.push(line);
				if (stderrTail.length > 15) stderrTail.shift();
			});
			child.on('error', (cause) => reject(this.classifySpawnError(cause)));
			child.on('close', (code) => {
				if (code === 0) return resolve();
				const detail = stderrTail.join('\n');
				// Transient network trouble should retry; a private/removed video should not.
				const permanent =
					/Video unavailable|Private video|This video is not available|has been removed/i.test(
						detail
					);
				const message = `yt-dlp exited ${code}: ${detail.slice(-500) || 'no stderr'}`;
				reject(permanent ? new Error(message) : new RetryableJobError(message));
			});
		});
	}

	private classifySpawnError(cause: Error & { code?: string }): Error {
		if (cause.name === 'AbortError') return cause;
		if (cause.code === 'ENOENT') {
			return new Error(`yt-dlp binary not found at '${this.ytdlpBin}'`);
		}
		return new RetryableJobError(`failed to start yt-dlp: ${cause.message}`);
	}

	private findAudioFile(scratch: string): string {
		const files = readdirSync(scratch).filter((f) =>
			AUDIO_EXTENSIONS.includes(path.extname(f).slice(1))
		);
		if (files.length === 0) {
			throw new RetryableJobError('yt-dlp reported success but produced no audio file');
		}
		// Prefer the requested container if several remain (e.g. source + extracted).
		const preferred = files.find((f) => f.startsWith('track.')) ?? files[0];
		return path.join(scratch, preferred);
	}

	private async fetchCover(
		meta: JobMeta,
		scratch: string,
		signal: AbortSignal
	): Promise<string | undefined> {
		if (!meta.thumbnail) return undefined;
		try {
			const response = await this.fetchImpl(meta.thumbnail, { signal });
			if (!response.ok) return undefined;
			const buffer = Buffer.from(await response.arrayBuffer());
			const coverPath = path.join(scratch, 'cover.img');
			writeFileSync(coverPath, buffer);
			return coverPath;
		} catch {
			return undefined; // cover is best-effort; never fail the download over it
		}
	}

	private tag(
		audioFile: string,
		meta: JobMeta,
		coverPath: string | undefined,
		signal: AbortSignal
	): Promise<void> {
		const metaFile = path.join(path.dirname(audioFile), 'meta.json');
		writeFileSync(
			metaFile,
			JSON.stringify({
				title: meta.title,
				artist: meta.artist,
				album: meta.album,
				albumartist: meta.albumArtist ?? meta.artist,
				date: meta.year,
				genre: meta.genre,
				tracknumber: meta.trackNumber,
				totaltracks: meta.totalTracks,
				discnumber: meta.discNumber,
				mb_artist_id: meta.mbArtistId,
				mb_album_id: meta.mbAlbumId,
				mb_releasegroup_id: meta.mbReleaseGroupId,
				cover: coverPath
			})
		);
		return new Promise<void>((resolve, reject) => {
			const child = spawn(this.pythonBin, [this.tagScript, audioFile, metaFile], {
				stdio: ['ignore', 'ignore', 'pipe'],
				signal
			});
			let stderr = '';
			child.stderr.on('data', (chunk) => (stderr += chunk));
			child.on('error', reject);
			child.on('close', (code) =>
				code === 0 ? resolve() : reject(new Error(`tagging failed: ${stderr.slice(0, 500)}`))
			);
		});
	}

	private publishWithRetryClassification(
		audioFile: string,
		targetPath: string,
		jobId: string,
		libraryRoot: string
	): void {
		try {
			publishFile({
				sourcePath: audioFile,
				targetPath,
				jobId,
				libraryRoot,
				staging: this.options.staging
			});
		} catch (cause) {
			const code = (cause as NodeJS.ErrnoException).code;
			// Gluster brick outages surface as EIO/ESTALE - worth retrying later.
			if (code === 'EIO' || code === 'ESTALE') {
				throw new RetryableJobError(`library write failed (${code}): ${(cause as Error).message}`);
			}
			throw cause;
		}
	}

	/** album.nfo / artist.nfo / folder.jpg beside the published track. */
	private writeSidecars(
		job: Job,
		meta: JobMeta,
		targetPath: string,
		coverPath: string | undefined,
		libraryRoot: string
	): void {
		const albumDir = path.dirname(targetPath);
		const artistDir = path.dirname(albumDir);

		const siblings = this.db
			.prepare('SELECT meta FROM jobs WHERE batch_id = ? ORDER BY position')
			.all(job.batchId) as { meta: string }[];
		const tracks = siblings
			.map((row) => JSON.parse(row.meta) as JobMeta)
			.filter((m) => m.album === meta.album)
			.map((m, index) => ({ position: m.trackNumber ?? index + 1, title: m.title }));

		writeSidecar(
			path.join(albumDir, 'album.nfo'),
			albumNfo({
				title: meta.album,
				albumArtist: meta.albumArtist ?? meta.artist,
				year: meta.year,
				genres: meta.genre ? [meta.genre] : [],
				mbAlbumId: meta.mbAlbumId,
				mbReleaseGroupId: meta.mbReleaseGroupId,
				tracks
			}),
			libraryRoot
		);

		// Only write artist.nfo when the layout actually has an artist directory
		// (the default template does; a flat custom template may not).
		if (path.resolve(artistDir) !== path.resolve(libraryRoot)) {
			writeSidecar(
				path.join(artistDir, 'artist.nfo'),
				artistNfo({
					name: meta.albumArtist ?? meta.artist,
					mbArtistId: meta.mbArtistId,
					genres: meta.genre ? [meta.genre] : []
				}),
				libraryRoot
			);
		}

		if (coverPath && existsSync(coverPath)) {
			writeSidecar(path.join(albumDir, 'folder.jpg'), readFileSync(coverPath), libraryRoot);
		}
	}
}
