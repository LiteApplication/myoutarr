import type { Settings } from '../settings.ts';

/** What we know about an audio file's fidelity, from tags/stream info alone. */
export interface AudioQuality {
	codec: string;
	lossless: boolean;
	/** Average kbps. Meaningful for lossy codecs; lossless ranks on bit depth. */
	bitrateKbps: number;
	bitDepth?: number;
}

/**
 * Lossy codecs are not comparable at equal bitrates: Opus at 128k is roughly
 * AAC at 160k or MP3 at 190k. Scale to an "MP3-equivalent" bitrate.
 */
const CODEC_EFFICIENCY: Record<string, number> = {
	opus: 1.5,
	aac: 1.25,
	vorbis: 1.25,
	mp3: 1
};

/** A lossy copy must beat the existing one by this factor to count as an upgrade. */
const UPGRADE_MARGIN = 1.25;

export function qualityScore(q: AudioQuality): number {
	if (q.lossless) return 10_000 + (q.bitDepth ?? 16) * 100;
	return q.bitrateKbps * (CODEC_EFFICIENCY[q.codec] ?? 1);
}

/**
 * Lidarr's upgrade rule: replace only when strictly better. Lossless always
 * beats lossy, deeper lossless beats shallower, and lossy-to-lossy needs a real
 * margin so Opus 128k vs 134k never churns files back and forth.
 */
export function isUpgrade(candidate: AudioQuality, existing: AudioQuality): boolean {
	if (candidate.lossless !== existing.lossless) return candidate.lossless;
	if (candidate.lossless) return (candidate.bitDepth ?? 16) > (existing.bitDepth ?? 16);
	return qualityScore(candidate) >= qualityScore(existing) * UPGRADE_MARGIN;
}

/**
 * What a fresh download would be. YouTube serves lossy audio only, so even with
 * `audioFormat: 'flac'` the result is a transcode, never lossless - ranking it
 * as FLAC would let it "upgrade" a real rip.
 */
export function candidateQuality(
	settings: Pick<Settings, 'audioFormat' | 'audioQuality'>
): AudioQuality {
	switch (settings.audioFormat) {
		case 'm4a':
			return { codec: 'aac', lossless: false, bitrateKbps: 128 };
		case 'mp3':
			// LAME VBR scale: -q 0 (~245k) down to -q 10 (~65k).
			return {
				codec: 'mp3',
				lossless: false,
				bitrateKbps: Math.max(65, 245 - settings.audioQuality * 18)
			};
		default:
			// 'opus', and 'flac' (a transcode of the same Opus source).
			return { codec: 'opus', lossless: false, bitrateKbps: 128 };
	}
}
