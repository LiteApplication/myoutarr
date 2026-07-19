<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const suggestions = [
		'Daft Punk',
		'Radiohead',
		'Kendrick Lamar',
		'Aphex Twin',
		'Billie Eilish',
		'Charli XCX'
	];

	const statusStyles: Record<string, string> = {
		completed: 'text-ok',
		failed: 'text-danger',
		cancelled: 'text-ink-faint'
	};

	function batchLinkHref(kind: string, sourceId: string, videoId: string): string {
		switch (kind) {
			case 'album':
				return `/album/${sourceId}`;
			case 'artist':
				return `/artist/${sourceId}`;
			case 'playlist':
				return `/playlist/${sourceId}`;
			case 'song':
				return `/song/${videoId}`;
			default:
				return '#';
		}
	}

	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		['year', 31536000000],
		['month', 2592000000],
		['day', 86400000],
		['hour', 3600000],
		['minute', 60000],
		['second', 1000]
	];

	function relative(ts: number | null): string {
		if (!ts) return '';
		const diff = ts - Date.now();
		for (const [unit, ms] of units) {
			if (Math.abs(diff) >= ms || unit === 'second') {
				return rtf.format(Math.round(diff / ms), unit);
			}
		}
		return '';
	}
</script>

<svelte:head>
	<title>myoutarr</title>
</svelte:head>

<div class="space-y-12">
	<!-- Hero / Search Section -->
	<div class="mx-auto max-w-2xl text-center mt-8">
		<div
			class="mx-auto grid h-16 w-16 place-items-center rounded-full bg-accent text-3xl font-black text-accent-ink"
		>
			m
		</div>
		<h1 class="mt-6 text-3xl font-bold tracking-tight">Find music for your Jellyfin library</h1>
		<p class="mt-2 text-sm text-ink-muted">
			Search for artists, albums, playlists or tracks below to queue them for download. Files are
			automatically tagged, structured, and synced.
		</p>

		<div class="mt-8">
			<form action="/search" method="GET" class="w-full">
				<div class="relative flex items-center">
					<input
						type="text"
						name="q"
						placeholder="Search songs, artists, albums, playlists..."
						required
						class="w-full rounded-2xl bg-surface-2 border border-line py-3.5 pl-12 pr-4 text-ink placeholder-ink-muted focus:border-accent focus:bg-surface-3 focus:outline-none transition-all shadow-sm"
					/>
					<svg
						viewBox="0 0 20 20"
						fill="currentColor"
						class="absolute left-4 h-5 w-5 text-ink-muted pointer-events-none"
					>
						<path
							fill-rule="evenodd"
							d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
							clip-rule="evenodd"
						/>
					</svg>
				</div>
			</form>
		</div>

		<div class="mt-4 flex flex-wrap justify-center gap-2">
			{#each suggestions as suggestion (suggestion)}
				<a
					href="/search?q={encodeURIComponent(suggestion)}"
					class="rounded-full bg-surface-2 px-4 py-1.5 text-xs text-ink-muted transition hover:bg-surface-3 hover:text-ink"
				>
					{suggestion}
				</a>
			{/each}
		</div>
	</div>

	<!-- Library Stats Grid -->
	<section class="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-5xl mx-auto">
		<div class="rounded-xl border border-line bg-surface p-5 shadow-sm">
			<p class="text-xs font-semibold uppercase tracking-wider text-ink-faint">Active Queue</p>
			<p class="mt-2 text-3xl font-bold text-accent">{data.stats.queuedCount}</p>
		</div>
		<div class="rounded-xl border border-line bg-surface p-5 shadow-sm">
			<p class="text-xs font-semibold uppercase tracking-wider text-ink-faint">Downloaded Tracks</p>
			<p class="mt-2 text-3xl font-bold text-ok">{data.stats.completedCount}</p>
		</div>
		<div class="rounded-xl border border-line bg-surface p-5 shadow-sm">
			<p class="text-xs font-semibold uppercase tracking-wider text-ink-faint">Active Syncs</p>
			<p class="mt-2 text-3xl font-bold text-ink">{data.stats.subscriptionsCount}</p>
		</div>
		<div class="rounded-xl border border-line bg-surface p-5 shadow-sm">
			<p class="text-xs font-semibold uppercase tracking-wider text-ink-faint">Failed Jobs</p>
			<p class="mt-2 text-3xl font-bold text-danger">{data.stats.failedCount}</p>
		</div>
	</section>

	<!-- Dashboard Layout: Recent Downloads & Subscriptions -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
		<!-- Left: Recent Activity -->
		<section class="space-y-4">
			<div class="flex items-center justify-between border-b border-line pb-2">
				<h2 class="text-lg font-bold">Recent Downloads</h2>
				<a href="/logs" class="text-xs text-accent hover:underline">View all logs</a>
			</div>

			{#if data.recentDownloads.length === 0}
				<p class="py-8 text-center text-sm text-ink-muted">No download history yet.</p>
			{:else}
				<ul class="rounded-xl bg-surface border border-line divide-y divide-line overflow-hidden">
					{#each data.recentDownloads as entry (entry.id)}
						<li class="p-3.5 hover:bg-surface-2 transition duration-150">
							<div class="flex items-center gap-3">
								{#if entry.thumbnail}
									<a href="/song/{entry.videoId}" class="shrink-0">
										<img
											src={entry.thumbnail}
											alt=""
											class="h-10 w-10 rounded object-cover bg-surface-3"
										/>
									</a>
								{/if}
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium text-ink">
										<a href="/song/{entry.videoId}" class="hover:underline">{entry.title}</a>
									</p>
									<p class="truncate text-xs text-ink-muted mt-0.5">
										{#if entry.artist}{entry.artist} ·
										{/if}
										<a
											href={batchLinkHref(entry.batchKind, entry.batchSourceId, entry.videoId)}
											class="hover:underline text-ink-muted hover:text-ink"
										>
											{entry.batchTitle}
										</a>
									</p>
								</div>
								<div class="shrink-0 text-right text-xs">
									<span class={statusStyles[entry.status] ?? 'text-ink-muted'}>{entry.status}</span>
									<p class="text-ink-faint mt-0.5">{relative(entry.finishedAt)}</p>
								</div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- Right: Quick Subscriptions -->
		<section class="space-y-4">
			<div class="flex items-center justify-between border-b border-line pb-2">
				<h2 class="text-lg font-bold">Followed & Synced</h2>
				<a href="/subscriptions" class="text-xs text-accent hover:underline">Manage syncs</a>
			</div>

			{#if data.artistSubs.length === 0 && data.playlistSubs.length === 0}
				<p class="py-8 text-center text-sm text-ink-muted">
					Not syncing any artists or playlists yet.
				</p>
			{:else}
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
					{#each data.artistSubs as sub (sub.browseId)}
						<a
							href="/artist/{sub.browseId}"
							class="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 hover:bg-surface-2 transition"
						>
							{#if sub.thumbnail}
								<img
									src={sub.thumbnail}
									alt=""
									class="h-10 w-10 rounded-full object-cover bg-surface-3"
								/>
							{/if}
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium text-ink">{sub.name}</p>
								<p class="text-[10px] text-ink-faint uppercase tracking-wider font-semibold mt-0.5">
									Artist
								</p>
							</div>
						</a>
					{/each}

					{#each data.playlistSubs as sub (sub.browseId)}
						<a
							href="/playlist/{sub.browseId}"
							class="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 hover:bg-surface-2 transition"
						>
							{#if sub.thumbnail}
								<img
									src={sub.thumbnail}
									alt=""
									class="h-10 w-10 rounded object-cover bg-surface-3"
								/>
							{/if}
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium text-ink">{sub.title}</p>
								<p class="text-[10px] text-ink-faint uppercase tracking-wider font-semibold mt-0.5">
									Playlist
								</p>
							</div>
						</a>
					{/each}
				</div>
			{/if}
		</section>
	</div>
</div>
