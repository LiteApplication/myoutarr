import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { musicDir, stagingDir } from '../env.ts';

export const MOUNT_SENTINEL = '.myoutarr-mount-ok';

export class MountMissingError extends Error {
	constructor(root: string) {
		super(
			`Music volume sentinel missing at ${path.join(root, MOUNT_SENTINEL)} — ` +
				'refusing to write. Is the GlusterFS mount up?'
		);
		this.name = 'MountMissingError';
	}
}

/**
 * The bind-mount footgun: if the network mount drops, the empty directory
 * underneath silently absorbs writes that vanish when the mount returns.
 * A sentinel file created at setup proves the real volume is mounted.
 */
export function assertMounted(root: string = musicDir()): void {
	if (!existsSync(path.join(root, MOUNT_SENTINEL))) {
		throw new MountMissingError(root);
	}
}

export function createSentinel(root: string = musicDir()): void {
	writeFileSync(
		path.join(root, MOUNT_SENTINEL),
		'This file tells myoutarr the music volume is mounted. Do not delete.\n'
	);
}

/**
 * Publish a finished, fully-tagged file into the library:
 *   1. copy from node-local scratch into staging *on the library volume*
 *   2. rename() into place — intra-volume, therefore atomic
 *
 * A direct rename from scratch would cross filesystems (EXDEV) and degrade to
 * a non-atomic copy that Jellyfin could scan half-written. Never do that.
 */
export function publishFile(options: {
	sourcePath: string;
	targetPath: string;
	jobId: string;
	libraryRoot?: string;
	staging?: string;
}): void {
	const root = options.libraryRoot ?? musicDir();
	const staging = options.staging ?? stagingDir();
	assertMounted(root);

	const stageDir = path.join(staging, options.jobId);
	const staged = path.join(stageDir, path.basename(options.targetPath));
	mkdirSync(stageDir, { recursive: true });
	mkdirSync(path.dirname(options.targetPath), { recursive: true });
	try {
		copyFileSync(options.sourcePath, staged);
		try {
			renameSync(staged, options.targetPath);
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code === 'EXDEV') {
				// Staging misconfigured onto a different filesystem than the library.
				// Refusing beats silently losing atomicity.
				throw new Error(
					'staging and library are on different filesystems (EXDEV): ' +
						'publish would not be atomic. Check volume configuration.',
					{ cause }
				);
			}
			throw cause;
		}
	} finally {
		rmSync(stageDir, { recursive: true, force: true });
	}
}

/** Write a sidecar (NFO, cover) next to published music, sentinel-guarded. */
export function writeSidecar(targetPath: string, content: string | Buffer, root?: string): void {
	assertMounted(root ?? musicDir());
	mkdirSync(path.dirname(targetPath), { recursive: true });
	if (typeof content === 'string') writeFileSync(targetPath, content, 'utf8');
	else writeFileSync(targetPath, content);
}
