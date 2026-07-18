<script lang="ts">
	import MediaCard from '$lib/components/MediaCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const tabs = [
		{ value: undefined, label: 'All' },
		{ value: 'songs', label: 'Songs' },
		{ value: 'albums', label: 'Albums' },
		{ value: 'artists', label: 'Artists' },
		{ value: 'playlists', label: 'Playlists' }
	] as const;

	function tabHref(filter: string | undefined): string {
		const query = `q=${encodeURIComponent(data.query)}`;
		return filter ? `/search?${query}&filter=${filter}` : `/search?${query}`;
	}

	let songs = $derived(data.results.filter((r) => r.kind === 'song'));
	let cards = $derived(data.results.filter((r) => r.kind !== 'song'));
</script>

<svelte:head>
	<title>{data.query ? `${data.query} - search` : 'Search'} - myoutarr</title>
</svelte:head>

{#if data.query}
	<div class="mb-6 flex flex-wrap gap-2">
		{#each tabs as tab (tab.label)}
			<a
				href={tabHref(tab.value)}
				class="rounded-full px-4 py-1.5 text-sm transition
					{data.filter === tab.value
					? 'bg-ink text-canvas'
					: 'bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink'}"
			>
				{tab.label}
			</a>
		{/each}
	</div>

	{#if data.results.length === 0}
		<p class="mt-16 text-center text-ink-muted">Nothing found for “{data.query}”.</p>
	{/if}

	{#if songs.length > 0}
		<section class="mb-8">
			<h2 class="mb-3 text-lg font-semibold">Songs</h2>
			<ul class="divide-y divide-line overflow-hidden rounded-xl bg-surface">
				{#each songs as song (song.videoId)}
					<li class="flex items-center gap-4 px-4 py-2.5 transition hover:bg-surface-2">
						<img
							src={song.thumbnails.at(-1)?.url}
							alt=""
							loading="lazy"
							class="h-10 w-10 rounded object-cover bg-surface-3"
						/>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm text-ink">{song.title}</p>
							<p class="truncate text-xs text-ink-muted">
								{song.artists.map((a) => a.name).join(', ')}
								{#if song.album}&nbsp;·&nbsp;{song.album.name}{/if}
							</p>
						</div>
						<span class="text-xs text-ink-faint">{song.duration ?? ''}</span>
						{#if song.album?.id}
							<a
								href="/album/{song.album.id}"
								class="rounded-full px-3 py-1 text-xs text-ink-muted transition hover:bg-surface-3 hover:text-ink"
							>
								View album
							</a>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if cards.length > 0}
		<section>
			{#if songs.length > 0}<h2 class="mb-3 text-lg font-semibold">More</h2>{/if}
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
				{#each cards as item (item.kind + item.browseId)}
					{#if item.kind === 'album'}
						<MediaCard
							href="/album/{item.browseId}"
							title={item.title}
							subtitle="{item.albumType}{item.year ? ` · ${item.year}` : ''} · {item.artists
								.map((a) => a.name)
								.join(', ')}"
							thumbnails={item.thumbnails}
						/>
					{:else if item.kind === 'artist'}
						<MediaCard
							href="/artist/{item.browseId}"
							title={item.name}
							subtitle="Artist"
							thumbnails={item.thumbnails}
							round
						/>
					{:else if item.kind === 'playlist'}
						<MediaCard
							href="/playlist/{item.browseId}"
							title={item.title}
							subtitle="Playlist{item.author ? ` · ${item.author}` : ''}"
							thumbnails={item.thumbnails}
						/>
					{/if}
				{/each}
			</div>
		</section>
	{/if}
{:else}
	<p class="mt-16 text-center text-ink-muted">Type something in the search bar to get started.</p>
{/if}
