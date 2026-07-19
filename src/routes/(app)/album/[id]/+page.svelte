<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let cover = $derived(data.album.thumbnails.at(-1)?.url ?? '');
	let artistNames = $derived(data.album.artists.map((a) => a.name).join(', '));
	let queueState = $state<'idle' | 'working' | 'queued' | 'error'>('idle');
	let queueError = $state('');
	let deleteState = $state<'idle' | 'working' | 'done' | 'error'>('idle');
	let isDownloaded = $state(data.isDownloaded);
	// Per-track deleted state: videoId -> true when deleted client-side
	let deletedTracks = $state<Record<string, boolean>>({});

	async function download(videoId?: string) {
		queueState = 'working';
		queueError = '';
		try {
			const response = await fetch('/api/queue', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(
					videoId
						? { kind: 'song', videoId, albumBrowseId: data.album.browseId }
						: { kind: 'album', browseId: data.album.browseId }
				)
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
	<title>{data.album.title} - myoutarr</title>
</svelte:head>

<header class="mb-8 flex flex-col items-start gap-6 sm:flex-row sm:items-end">
	<img src={cover} alt="" class="h-48 w-48 rounded-lg object-cover bg-surface-3 shadow-lg" />
	<div class="min-w-0">
		<p class="text-xs uppercase tracking-wide text-ink-faint">
			{data.album.albumType}{data.album.year ? ` · ${data.album.year}` : ''}
		</p>
		<h1 class="mt-1 text-4xl font-bold tracking-tight">{data.album.title}</h1>
		<p class="mt-2 text-sm text-ink-muted">
			{#each data.album.artists as artist, index (artist.name)}
				{#if index > 0},&nbsp;{/if}
				{#if artist.id}<a href="/artist/{artist.id}" class="hover:text-ink hover:underline"
						>{artist.name}</a
					>{:else}{artist.name}{/if}
			{/each}
			&nbsp;·&nbsp;{data.album.trackCount} tracks{#if data.album.duration}&nbsp;·&nbsp;{data.album
					.duration}{/if}
		</p>
		<div class="mt-4 flex items-center gap-3">
			{#if isDownloaded && queueState === 'idle'}
				<!-- Downloaded → hover becomes Delete album -->
				<form
					method="POST"
					action="?/delete"
					use:enhance={() => {
						deleteState = 'working';
						return async ({ result, update }) => {
							await update();
							if (result.type === 'success') {
								isDownloaded = false;
								deleteState = 'done';
							} else {
								deleteState = 'error';
							}
						};
					}}
				>
					<input type="hidden" name="relative" value={data.albumRelativeDir} />
					<button
						type="submit"
						disabled={deleteState === 'working'}
						class="group/del rounded-full border px-6 py-2 text-sm font-medium transition disabled:opacity-50
							border-ok bg-ok/15 text-ok hover:border-danger hover:bg-danger/15 hover:text-danger"
						title="Delete album from library"
					>
						<span class="group-hover/del:hidden">
							{deleteState === 'working' ? 'Deleting…' : 'Downloaded ✓'}
						</span>
						<span class="hidden group-hover/del:inline">Delete album</span>
					</button>
				</form>
			{:else}
				<button
					onclick={() => download()}
					disabled={queueState === 'working'}
					class="rounded-full px-6 py-2 text-sm font-medium transition disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent-hover"
				>
					{queueState === 'working'
						? 'Queuing…'
						: queueState === 'queued'
							? 'Queued ✓'
							: 'Download album'}
				</button>
			{/if}
			{#if queueState === 'error'}
				<span class="text-sm text-accent-hover" role="alert">{queueError}</span>
			{/if}
			{#if deleteState === 'error'}
				<span class="text-sm text-danger" role="alert">Delete failed</span>
			{/if}
		</div>
	</div>
</header>

<ul class="divide-y divide-line overflow-hidden rounded-xl bg-surface">
	{#each data.album.tracks as track (track.trackNumber)}
		<li class="group flex items-center gap-4 px-4 py-2.5 transition hover:bg-surface-2">
			<span class="w-6 text-right text-sm tabular-nums text-ink-faint">{track.trackNumber}</span>
			<div class="min-w-0 flex-1">
				<p
					class="truncate text-sm {track.isAvailable ? 'text-ink' : 'text-ink-faint line-through'}"
				>
					{track.title}
				</p>
				{#if track.artists.length > 0 && track.artists
						.map((a) => a.name)
						.join(', ') !== artistNames}
					<p class="truncate text-xs text-ink-muted">
						{track.artists.map((a) => a.name).join(', ')}
					</p>
				{/if}
			</div>
			<span class="text-xs tabular-nums text-ink-faint">{track.duration ?? ''}</span>
			{#if track.isAvailable && track.videoId}
				{#if track.isDownloaded && !deletedTracks[track.videoId!]}
					<!-- Track checkmark → hover becomes Delete track -->
					<form
						method="POST"
						action="?/delete"
						use:enhance={() => {
							return async ({ result, update }) => {
								await update();
								if (result.type === 'success') {
									deletedTracks = { ...deletedTracks, [track.videoId!]: true };
									isDownloaded = false;
								}
							};
						}}
					>
						<input type="hidden" name="relative" value={track.trackRelativePath ?? ''} />
						<button
							type="submit"
							class="group/del shrink-0 rounded-full p-2 transition text-ok hover:text-danger hover:bg-danger/10 lg:invisible lg:group-hover:visible"
							title="Delete track from library"
							aria-label="Delete {track.title}"
						>
							<!-- Default: checkmark -->
							<svg viewBox="0 0 24 24" class="h-4 w-4 group-hover/del:hidden" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
								<path d="M20 6 9 17l-5-5" />
							</svg>
							<!-- Hover: trash icon -->
							<svg viewBox="0 0 24 24" class="h-4 w-4 hidden group-hover/del:block" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
							</svg>
						</button>
					</form>
				{:else if !deletedTracks[track.videoId!]}
					<button
						onclick={() => download(track.videoId!)}
						class="rounded-full p-2 text-ink-muted transition hover:bg-surface-3 hover:text-ink lg:invisible lg:group-hover:visible"
						aria-label="Download {track.title}"
						title="Download this track"
					>
						<svg
							viewBox="0 0 24 24"
							class="h-4 w-4"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" />
						</svg>
					</button>
				{/if}
			{/if}
		</li>
	{/each}
</ul>
