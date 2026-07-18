<script lang="ts">
	import MediaCard from '$lib/components/MediaCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let hero = $derived(data.artist.thumbnails.at(-1)?.url ?? '');

	// Optimistic local override of the server-provided subscription state, keyed
	// by artist id so it's ignored (and effectively reset) after navigation.
	let override = $state<{ id: string; value: boolean } | null>(null);
	let subscribed = $derived(
		override && override.id === data.artist.browseId ? override.value : data.subscribed
	);
	let subBusy = $state(false);
	let subError = $state('');

	async function toggleSubscription() {
		subBusy = true;
		subError = '';
		const wasSubscribed = subscribed;
		try {
			const response = await fetch('/api/subscriptions', {
				method: wasSubscribed ? 'DELETE' : 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ browseId: data.artist.browseId })
			});
			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				throw new Error(body.error ?? `request failed (${response.status})`);
			}
			override = { id: data.artist.browseId, value: !wasSubscribed };
		} catch (cause) {
			subError = (cause as Error).message;
		} finally {
			subBusy = false;
		}
	}
</script>

<svelte:head>
	<title>{data.artist.name} - myoutarr</title>
</svelte:head>

<header class="mb-8 flex flex-col items-start gap-6 sm:flex-row sm:items-end">
	{#if hero}
		<img src={hero} alt="" class="h-40 w-40 rounded-full object-cover bg-surface-3 shadow-lg" />
	{/if}
	<div class="min-w-0">
		<p class="text-xs uppercase tracking-wide text-ink-faint">Artist</p>
		<h1 class="mt-1 text-4xl font-bold tracking-tight">{data.artist.name}</h1>
		{#if data.artist.description}
			<p class="mt-3 max-w-2xl text-sm text-ink-muted line-clamp-2-fixed">
				{data.artist.description}
			</p>
		{/if}
		<div class="mt-4 flex flex-wrap items-center gap-3">
			<button
				onclick={toggleSubscription}
				disabled={subBusy}
				class="rounded-full px-5 py-2 text-sm font-medium transition disabled:opacity-50
					{subscribed
					? 'border border-line bg-surface-2 text-ink hover:bg-surface-3'
					: 'bg-accent text-accent-ink hover:bg-accent-hover'}"
				title="Automatically download new releases from this artist (checked daily)"
			>
				{#if subBusy}
					Working…
				{:else if subscribed}
					Following ✓
				{:else}
					Follow for new releases
				{/if}
			</button>
			{#if subscribed && !subBusy}
				<span class="text-xs text-ink-faint">New releases download automatically</span>
			{/if}
			{#if subError}
				<span class="text-sm text-accent-hover" role="alert">{subError}</span>
			{/if}
		</div>
	</div>
</header>

{#if data.allAlbums.length > 0}
	<section class="mb-10">
		<h2 class="mb-3 text-lg font-semibold">Albums</h2>
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
			{#each data.allAlbums as album (album.browseId)}
				<MediaCard
					href="/album/{album.browseId}"
					title={album.title}
					subtitle="{album.albumType}{album.year ? ` · ${album.year}` : ''}"
					thumbnails={album.thumbnails}
				/>
			{/each}
		</div>
	</section>
{/if}

{#if data.artist.singles.length > 0}
	<section>
		<h2 class="mb-3 text-lg font-semibold">Singles & EPs</h2>
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
			{#each data.artist.singles as single (single.browseId)}
				<MediaCard
					href="/album/{single.browseId}"
					title={single.title}
					subtitle={single.year ?? 'Single'}
					thumbnails={single.thumbnails}
				/>
			{/each}
		</div>
	</section>
{/if}

{#if data.allAlbums.length === 0 && data.artist.singles.length === 0}
	<p class="mt-16 text-center text-ink-muted">No releases found for this artist.</p>
{/if}
