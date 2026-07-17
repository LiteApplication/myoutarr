import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

const CALL_TIMEOUT_MS = 30_000;
const RESTART_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000];

interface Pending {
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
	timer: NodeJS.Timeout;
}

export class YtMusicError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'YtMusicError';
	}
}

/**
 * Client for the long-lived Python ytmusicapi worker.
 * Frames are newline-delimited JSON matched by request id.
 * The child is restarted with backoff after crashes; in-flight calls fail fast.
 */
export class YtMusicWorker {
	private child: ChildProcessByStdio<Writable, Readable, null> | null = null;
	private nextId = 1;
	private pending = new Map<number, Pending>();
	private crashes = 0;
	private restartTimer: NodeJS.Timeout | null = null;
	private stopped = false;

	constructor(
		private readonly pythonBin: string,
		private readonly script: string,
		private readonly extraArgs: string[] = []
	) {}

	private ensureChild(): void {
		if (this.child || this.stopped) return;
		const child = spawn(this.pythonBin, [this.script, ...this.extraArgs], {
			stdio: ['pipe', 'pipe', 'inherit']
		});
		this.child = child;

		const lines = createInterface({ input: child.stdout });
		lines.on('line', (line) => this.onFrame(line));

		child.on('exit', (code, signal) => {
			if (this.child !== child) return;
			this.child = null;
			this.failAllPending(new YtMusicError(`worker exited (code=${code}, signal=${signal})`));
			if (this.stopped) return;
			const backoff = RESTART_BACKOFF_MS[Math.min(this.crashes, RESTART_BACKOFF_MS.length - 1)];
			this.crashes += 1;
			this.restartTimer = setTimeout(() => {
				this.restartTimer = null;
				this.ensureChild();
			}, backoff);
		});

		child.on('spawn', () => {
			// Reset the crash counter only after the child proves it can serve.
			this.call('ping', {})
				.then(() => {
					this.crashes = 0;
				})
				.catch(() => {});
		});
	}

	private onFrame(line: string): void {
		let frame: { id?: number; result?: unknown; error?: { message?: string } };
		try {
			frame = JSON.parse(line);
		} catch {
			return; // stray non-protocol output; worker keeps logs on stderr
		}
		if (typeof frame.id !== 'number') return;
		const entry = this.pending.get(frame.id);
		if (!entry) return;
		this.pending.delete(frame.id);
		clearTimeout(entry.timer);
		if (frame.error) {
			entry.reject(new YtMusicError(frame.error.message ?? 'unknown worker error'));
		} else {
			entry.resolve(frame.result);
		}
	}

	private failAllPending(reason: Error): void {
		for (const [, entry] of this.pending) {
			clearTimeout(entry.timer);
			entry.reject(reason);
		}
		this.pending.clear();
	}

	call<T>(method: string, params: Record<string, unknown>): Promise<T> {
		this.ensureChild();
		const child = this.child;
		if (!child?.stdin.writable) {
			return Promise.reject(new YtMusicError('worker unavailable (restarting)'));
		}
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new YtMusicError(`${method} timed out after ${CALL_TIMEOUT_MS}ms`));
			}, CALL_TIMEOUT_MS);
			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
			child.stdin.write(JSON.stringify({ id, method, params }) + '\n', (error) => {
				if (error) {
					this.pending.delete(id);
					clearTimeout(timer);
					reject(new YtMusicError(`write failed: ${error.message}`));
				}
			});
		});
	}

	stop(): void {
		this.stopped = true;
		if (this.restartTimer) clearTimeout(this.restartTimer);
		this.failAllPending(new YtMusicError('worker stopped'));
		this.child?.kill('SIGTERM');
		this.child = null;
	}
}

let instance: YtMusicWorker | null = null;

export function getYtMusic(): YtMusicWorker {
	if (!instance) {
		instance = new YtMusicWorker(
			process.env.YTM_PYTHON ?? '.venv/bin/python',
			process.env.YTM_WORKER ?? 'python/ytm_worker.py'
		);
	}
	return instance;
}

export function stopYtMusic(): void {
	instance?.stop();
	instance = null;
}
