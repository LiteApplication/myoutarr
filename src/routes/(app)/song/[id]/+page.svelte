<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let cover = $derived(data.song.thumbnails.at(-1)?.url ?? '');
	let queueState = $state<'idle' | 'working' | 'queued' | 'error'>('idle');
	let queueError = $state('');

	// Track ids currently being queued from the "related" list, so each row can
	// reflect its own state independently of the main download button.
	let relatedState = $state<Record<string, 'working' | 'queued' | 'error'>>({});

	async function queueSong(videoId: string, albumId: string | null) {
		const response = await fetch('/api/queue', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				kind: 'song',
				videoId,
				...(albumId ? { albumBrowseId: albumId } : {})
			})
		});
		if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			throw new Error(body.error ?? `queue responded ${response.status}`);
		}
	}

	async function download() {
		queueState = 'working';
		queueError = '';
		try {
			await queueSong(data.song.videoId, data.song.album?.id ?? null);
			queueState = 'queued';
		} catch (cause) {
			queueState = 'error';
			queueError = (cause as Error).message;
		}
	}

	async function downloadRelated(videoId: string, albumId: string | null) {
		relatedState = { ...relatedState, [videoId]: 'working' };
		try {
			await queueSong(videoId, albumId);
			relatedState = { ...relatedState, [videoId]: 'queued' };
		} catch {
			relatedState = { ...relatedState, [videoId]: 'error' };
		}
	}
</script>

<svelte:head>
	<title>{data.song.title} - myoutarr</title>
</svelte:head>

<header class="mb-8 flex flex-col items-start gap-6 sm:flex-row sm:items-end">
	{#if cover}
		<img
			src={cover}
			alt=""
			class="h-40 w-40 rounded-lg bg-surface-3 object-cover shadow-lg sm:h-48 sm:w-48"
		/>
	{/if}
	<div class="min-w-0">
		<p class="text-xs uppercase tracking-wide text-ink-faint">Song</p>
		<h1 class="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{data.song.title}</h1>
		<p class="mt-2 text-sm text-ink-muted">
			{#each data.song.artists as artist, index (artist.name)}
				{#if index > 0},&nbsp;{/if}
				{#if artist.id}<a href="/artist/{artist.id}" class="hover:text-ink hover:underline"
						>{artist.name}</a
					>{:else}{artist.name}{/if}
			{/each}
			{#if data.song.album}
				&nbsp;·&nbsp;{#if data.song.album.id}<a
						href="/album/{data.song.album.id}"
						class="hover:text-ink hover:underline">{data.song.album.name}</a
					>{:else}{data.song.album.name}{/if}
			{/if}
			{#if data.song.duration}&nbsp;·&nbsp;{data.song.duration}{/if}
		</p>
		<div class="mt-4 flex flex-wrap items-center gap-3">
			<button
				onclick={download}
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
							: 'Download song'}
			</button>
			{#if queueState === 'error'}
				<span class="text-sm text-danger" role="alert">{queueError}</span>
			{/if}
		</div>
	</div>
</header>

{#if data.song.related.length > 0}
	<section>
		<h2 class="mb-3 text-lg font-semibold">Related songs</h2>
		<ul class="divide-y divide-line overflow-hidden rounded-xl bg-surface">
			{#each data.song.related as track (track.videoId)}
				<li
					class="group flex items-center gap-3 px-3 py-2.5 transition hover:bg-surface-2 sm:gap-4 sm:px-4"
				>
					<a href="/song/{track.videoId}" class="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
						<img
							src={track.thumbnails.at(-1)?.url}
							alt=""
							loading="lazy"
							class="h-10 w-10 shrink-0 rounded bg-surface-3 object-cover"
						/>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm text-ink">{track.title}</p>
							<p class="truncate text-xs text-ink-muted">
								{track.artists.map((a) => a.name).join(', ')}
								{#if track.album}&nbsp;·&nbsp;{track.album.name}{/if}
							</p>
						</div>
					</a>
					<span class="hidden text-xs tabular-nums text-ink-faint sm:inline">
						{track.duration ?? ''}
					</span>
					<button
						onclick={() => downloadRelated(track.videoId, track.album?.id ?? null)}
						disabled={relatedState[track.videoId] === 'working'}
						class="shrink-0 rounded-full p-2 text-ink-muted transition hover:bg-surface-3 hover:text-ink disabled:opacity-50 lg:invisible lg:group-hover:visible"
						class:!visible={relatedState[track.videoId] || track.isDownloaded}
						aria-label="Download {track.title}"
						title={track.isDownloaded ? 'Already downloaded' : 'Download this track'}
					>
						{#if relatedState[track.videoId] === 'queued' || (track.isDownloaded && !relatedState[track.videoId])}
							<svg
								viewBox="0 0 24 24"
								class="h-4 w-4 text-ok"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path d="M20 6 9 17l-5-5" />
							</svg>
						{:else if relatedState[track.videoId] === 'error'}
							<span class="text-xs text-danger">!</span>
						{:else}
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
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}
