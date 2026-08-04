/**
 * Multi-artist credits reach us as one string ("A, B & C") - that is how YT
 * Music presents them and how the metadata editor stores them. Jellyfin only
 * creates separate artist entities when the underlying tag is *multi-valued*,
 * so every place that assigns artists to a song or an album splits the credit
 * on "," and "&" first.
 *
 * Names containing those characters ("Earth, Wind & Fire", "Simon & Garfunkel")
 * are split too - that is the intended trade-off.
 */
export function splitArtists(value: string | undefined | null): string[] {
	if (!value) return [];
	const seen = new Set<string>();
	const names: string[] = [];
	for (const part of value.split(/[,&]/)) {
		const name = part.trim();
		if (name === '') continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		names.push(name);
	}
	return names;
}
