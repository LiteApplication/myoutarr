<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let cover = $derived(data.playlist.thumbnails.at(-1)?.url ?? '');
	let queueState = $state<'idle' | 'working' | 'queued' | 'error'>('idle');
	let queueError = $state('');

	async function downloadAll() {
		queueState = 'working';
		try {
			const response = await fetch('/api/queue', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ kind: 'playlist', browseId: data.playlist.browseId })
			});
			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				throw new Error(body.error ?? `queue responded ${response.status}`);
			}
			queueState = 'queued';
		} catch (cause) {
			queueState = 'error';
			queueError = (cause as Error).message;
		}
	}
</script>

<svelte:head>
	<title>{data.playlist.title} — myoutarr</title>
</svelte:head>

<header class="mb-8 flex flex-col items-start gap-6 sm:flex-row sm:items-end">
	{#if cover}
		<img src={cover} alt="" class="h-48 w-48 rounded-lg bg-surface-3 object-cover shadow-lg" />
	{/if}
	<div class="min-w-0">
		<p class="text-xs uppercase tracking-wide text-ink-faint">Playlist</p>
		<h1 class="mt-1 text-4xl font-bold tracking-tight">{data.playlist.title}</h1>
		<p class="mt-2 text-sm text-ink-muted">
			{data.playlist.author ?? ''} · {data.playlist.trackCount} tracks
		</p>
		<div class="mt-4 flex items-center gap-3">
			<button
				onclick={downloadAll}
				disabled={queueState === 'working'}
				class="rounded-full bg-accent px-6 py-2 text-sm font-medium text-accent-ink transition hover:bg-accent-hover disabled:opacity-50"
			>
				{queueState === 'working'
					? 'Queuing…'
					: queueState === 'queued'
						? 'Queued ✓'
						: 'Download playlist'}
			</button>
			{#if queueState === 'error'}
				<span class="text-sm text-danger" role="alert">{queueError}</span>
			{/if}
		</div>
	</div>
</header>

<ul class="divide-y divide-line overflow-hidden rounded-xl bg-surface">
	{#each data.playlist.tracks as track, index (track.videoId + index)}
		<li class="flex items-center gap-4 px-4 py-2.5 transition hover:bg-surface-2">
			<span class="w-6 text-right text-sm tabular-nums text-ink-faint">{index + 1}</span>
			<img
				src={track.thumbnails.at(-1)?.url}
				alt=""
				loading="lazy"
				class="h-10 w-10 rounded bg-surface-3 object-cover"
			/>
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm text-ink">{track.title}</p>
				<p class="truncate text-xs text-ink-muted">
					{track.artists.map((a) => a.name).join(', ')}
					{#if track.album}&nbsp;·&nbsp;{track.album.name}{/if}
				</p>
			</div>
			<span class="text-xs tabular-nums text-ink-faint">{track.duration ?? ''}</span>
		</li>
	{/each}
</ul>
