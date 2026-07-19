<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let cover = $derived(data.playlist.thumbnails.at(-1)?.url ?? '');
	let queueState = $state<'idle' | 'working' | 'queued' | 'error'>('idle');
	let queueError = $state('');
	let syncBusy = $state(false);

	async function toggleSync() {
		syncBusy = true;
		try {
			await fetch('/api/playlists', {
				method: data.synced ? 'DELETE' : 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ browseId: data.playlist.browseId })
			});
			await invalidateAll();
		} finally {
			syncBusy = false;
		}
	}

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
	<title>{data.playlist.title} - myoutarr</title>
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
				class="rounded-full px-6 py-2 text-sm font-medium transition disabled:opacity-50
					{data.isDownloaded && queueState === 'idle'
					? 'border border-ok bg-ok/15 text-ok hover:bg-ok/25'
					: 'bg-accent text-accent-ink hover:bg-accent-hover'}"
			>
				{queueState === 'working'
					? 'Queuing…'
					: queueState === 'queued'
						? 'Queued ✓'
						: data.isDownloaded
							? 'Downloaded ✓'
							: 'Download playlist'}
			</button>
			<button
				onclick={toggleSync}
				disabled={syncBusy}
				class={[
					'rounded-full border px-5 py-2 text-sm font-medium transition disabled:opacity-50',
					data.synced
						? 'border-accent text-accent hover:bg-surface-2'
						: 'border-line text-ink-muted hover:bg-surface-2 hover:text-ink'
				]}
				title="Automatically download songs added to this playlist and keep the Jellyfin playlist in sync"
			>
				{syncBusy ? '…' : data.synced ? 'Syncing ✓' : 'Sync new songs'}
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
			{#if track.videoId}
				<a href="/song/{track.videoId}" class="shrink-0">
					<img
						src={track.thumbnails.at(-1)?.url}
						alt=""
						loading="lazy"
						class="h-10 w-10 rounded bg-surface-3 object-cover"
					/>
				</a>
			{:else}
				<img
					src={track.thumbnails.at(-1)?.url}
					alt=""
					loading="lazy"
					class="h-10 w-10 rounded bg-surface-3 object-cover"
				/>
			{/if}
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm text-ink">
					{#if track.videoId}
						<a href="/song/{track.videoId}" class="hover:underline">{track.title}</a>
					{:else}
						{track.title}
					{/if}
				</p>
				<p class="truncate text-xs text-ink-muted">
					{#each track.artists as artist, i (artist.id ?? artist.name)}
						{#if i > 0},&nbsp;{/if}
						{#if artist.id}
							<a href="/artist/{artist.id}" class="hover:underline hover:text-ink">{artist.name}</a>
						{:else}
							{artist.name}
						{/if}
					{/each}
					{#if track.album}
						&nbsp;·&nbsp;
						{#if track.album.id}
							<a href="/album/{track.album.id}" class="hover:underline hover:text-ink"
								>{track.album.name}</a
							>
						{:else}
							{track.album.name}
						{/if}
					{/if}
				</p>
			</div>
			{#if track.isDownloaded}
				<span
					class="flex items-center gap-1 text-xs text-ok bg-ok/10 rounded-full px-2 py-0.5"
					title="Downloaded"
				>
					<svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5" aria-hidden="true">
						<path
							fill-rule="evenodd"
							d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 0 1 1.4-1.4l3.8 3.79 6.8-6.8a1 1 0 0 1 1.4 0Z"
							clip-rule="evenodd"
						/>
					</svg>
					Downloaded
				</span>
			{/if}
			<span class="text-xs tabular-nums text-ink-faint">{track.duration ?? ''}</span>
		</li>
	{/each}
</ul>
