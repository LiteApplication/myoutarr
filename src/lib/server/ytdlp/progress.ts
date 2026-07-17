/**
 * Parse yt-dlp's `--progress-template %(progress)j` output: one JSON object
 * per line on stdout. Non-JSON lines (postprocessor chatter) are ignored.
 */
export interface ProgressUpdate {
	/** 0..1 within the current download phase. */
	fraction: number;
	downloadedBytes: number;
	totalBytes: number | null;
	speedBps: number | null;
	status: 'downloading' | 'finished';
}

export function parseProgressLine(line: string): ProgressUpdate | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith('{')) return null;
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(trimmed);
	} catch {
		return null;
	}
	const status = raw.status;
	if (status !== 'downloading' && status !== 'finished') return null;

	const downloaded = typeof raw.downloaded_bytes === 'number' ? raw.downloaded_bytes : 0;
	const total =
		typeof raw.total_bytes === 'number'
			? raw.total_bytes
			: typeof raw.total_bytes_estimate === 'number'
				? raw.total_bytes_estimate
				: null;
	return {
		status,
		downloadedBytes: downloaded,
		totalBytes: total,
		speedBps: typeof raw.speed === 'number' ? raw.speed : null,
		fraction: status === 'finished' ? 1 : total && total > 0 ? Math.min(downloaded / total, 1) : 0
	};
}
