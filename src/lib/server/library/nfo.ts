/** Jellyfin-compatible NFO sidecars. Values are always XML-escaped. */

function esc(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function tag(name: string, value: string | undefined | null): string {
	return value ? `  <${name}>${esc(value)}</${name}>\n` : '';
}

export interface AlbumNfoInput {
	title: string;
	albumArtist: string;
	year?: string;
	genres?: string[];
	mbAlbumId?: string;
	mbReleaseGroupId?: string;
	tracks: { position: number; title: string; duration?: string }[];
}

export function albumNfo(input: AlbumNfoInput): string {
	let xml = '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<album>\n';
	xml += tag('title', input.title);
	xml += tag('artist', input.albumArtist);
	xml += tag('albumartist', input.albumArtist);
	xml += tag('year', input.year);
	for (const genre of input.genres ?? []) xml += tag('genre', genre);
	xml += tag('musicbrainzalbumid', input.mbAlbumId);
	xml += tag('musicbrainzreleasegroupid', input.mbReleaseGroupId);
	for (const track of input.tracks) {
		xml += '  <track>\n';
		xml += `    <position>${track.position}</position>\n`;
		xml += `    <title>${esc(track.title)}</title>\n`;
		if (track.duration) xml += `    <duration>${esc(track.duration)}</duration>\n`;
		xml += '  </track>\n';
	}
	xml += '</album>\n';
	return xml;
}

export interface ArtistNfoInput {
	name: string;
	sortName?: string;
	mbArtistId?: string;
	genres?: string[];
	biography?: string;
}

export function artistNfo(input: ArtistNfoInput): string {
	let xml = '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<artist>\n';
	xml += tag('name', input.name);
	xml += tag('sortname', input.sortName ?? input.name);
	xml += tag('musicbrainzartistid', input.mbArtistId);
	for (const genre of input.genres ?? []) xml += tag('genre', genre);
	xml += tag('biography', input.biography);
	xml += '</artist>\n';
	return xml;
}
