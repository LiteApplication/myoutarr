<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	interface SeedSong {
		videoId: string;
		title: string;
		artist: string;
	}

	// Create form state.
	let name = $state('');
	let dailyCount = $state(1);
	let seeds = $state<SeedSong[]>([]);
	let creating = $state(false);
	let createError = $state('');

	// Seed picker (live search).
	let searchQuery = $state('');
	let searchResults = $state<SeedSong[]>([]);
	let searching = $state(false);
	let searchToken = 0;

	// Page-level actions.
	let expanding = $state(false);
	let expandResult = $state('');
	let busyId = $state('');

	function lastChecked(ms: number | null): string {
		if (!ms) return 'not yet run';
		return `expanded ${new Date(ms).toLocaleString()}`;
	}

	async function runSearch() {
		const q = searchQuery.trim();
		const token = ++searchToken;
		if (!q) {
			searchResults = [];
			searching = false;
			return;
		}
		searching = true;
		try {
			const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&filter=songs`);
			const body = await response.json().catch(() => ({}));
			if (token !== searchToken) return; // a newer search superseded this one
			searchResults = ((body.results ?? []) as Array<Record<string, unknown>>)
				.filter((r) => r.kind === 'song' && typeof r.videoId === 'string')
				.map((r) => ({
					videoId: r.videoId as string,
					title: (r.title as string) ?? '(untitled)',
					artist:
						((r.artists as { name: string }[]) ?? []).map((a) => a.name).join(', ') ||
						'Unknown Artist'
				}));
		} finally {
			if (token === searchToken) searching = false;
		}
	}

	// Debounce the live search a touch so we don't fire on every keystroke.
	let searchTimer: ReturnType<typeof setTimeout>;
	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(runSearch, 250);
	}

	function addSeed(song: SeedSong) {
		if (seeds.some((s) => s.videoId === song.videoId)) return;
		seeds = [...seeds, song];
	}

	function removeSeed(videoId: string) {
		seeds = seeds.filter((s) => s.videoId !== videoId);
	}

	async function create() {
		createError = '';
		if (!name.trim()) {
			createError = 'Give the playlist a name.';
			return;
		}
		if (seeds.length === 0) {
			createError = 'Add at least one seed song.';
			return;
		}
		creating = true;
		try {
			const response = await fetch('/api/recommendations', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: name.trim(), dailyCount, seeds })
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(body.error ?? `request failed (${response.status})`);
			name = '';
			dailyCount = 1;
			seeds = [];
			searchQuery = '';
			searchResults = [];
			await invalidateAll();
		} catch (cause) {
			createError = (cause as Error).message;
		} finally {
			creating = false;
		}
	}

	async function expandNow() {
		expanding = true;
		expandResult = '';
		try {
			const response = await fetch('/api/recommendations/check', { method: 'POST' });
			const body = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(body.error ?? `request failed (${response.status})`);
			expandResult =
				body.enqueued > 0
					? `Queued ${body.enqueued} new song${body.enqueued === 1 ? '' : 's'}.`
					: 'No new recommendations found.';
			await invalidateAll();
		} catch (cause) {
			expandResult = (cause as Error).message;
		} finally {
			expanding = false;
		}
	}

	async function remove(id: string) {
		busyId = id;
		try {
			await fetch('/api/recommendations', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id })
			});
			await invalidateAll();
		} finally {
			busyId = '';
		}
	}
</script>

<svelte:head>
	<title>Recommendations - myoutarr</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-end justify-between gap-4">
	<div>
		<h1 class="text-3xl font-bold tracking-tight">Recommendations</h1>
		<p class="mt-1 text-sm text-ink-muted">
			{#if data.enabled}
				Each playlist grows daily: new songs matching its evolving vibe are downloaded and prepended
				to the top, checked about every {data.checkHours} hour{data.checkHours === 1 ? '' : 's'}.
			{:else}
				Daily expansion is <span class="text-accent-hover">disabled</span> in settings — playlists won't
				grow automatically. You can still expand them manually.
			{/if}
		</p>
	</div>
	<button
		onclick={expandNow}
		disabled={expanding || data.playlists.length === 0}
		class="rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-ink transition hover:bg-accent-hover disabled:opacity-50"
	>
		{expanding ? 'Expanding…' : 'Expand now'}
	</button>
</header>

{#if expandResult}
	<p class="mb-4 text-sm text-ink-muted" role="status">{expandResult}</p>
{/if}

<!-- Create form -->
<section class="mb-8 rounded-2xl bg-surface p-6">
	<h2 class="mb-4 text-lg font-semibold">New recommendation playlist</h2>
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
		<label class="block sm:col-span-2">
			<span class="mb-1 block text-sm text-ink-muted">Playlist name</span>
			<input
				type="text"
				bind:value={name}
				placeholder="Late-night focus"
				class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink placeholder:text-ink-faint focus:border-accent"
			/>
		</label>
		<label class="block">
			<span class="mb-1 block text-sm text-ink-muted">Songs per day</span>
			<input
				type="number"
				min="1"
				max="50"
				bind:value={dailyCount}
				class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink focus:border-accent"
			/>
		</label>
	</div>

	<div class="mt-4">
		<span class="mb-1 block text-sm text-ink-muted">Seed songs</span>
		{#if seeds.length > 0}
			<ul class="mb-3 flex flex-wrap gap-2">
				{#each seeds as seed (seed.videoId)}
					<li
						class="flex items-center gap-2 rounded-full bg-surface-2 py-1 pl-3 pr-1 text-sm text-ink"
					>
						<span class="max-w-[16rem] truncate">
							{seed.title}
							<span class="text-ink-faint">· {seed.artist}</span>
						</span>
						<button
							type="button"
							onclick={() => removeSeed(seed.videoId)}
							aria-label="Remove {seed.title}"
							class="grid h-5 w-5 place-items-center rounded-full text-ink-muted transition hover:bg-surface-3 hover:text-ink"
						>
							<svg
								viewBox="0 0 24 24"
								class="h-3.5 w-3.5"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
							>
								<path d="M6 6l12 12M18 6L6 18" />
							</svg>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<input
			type="search"
			bind:value={searchQuery}
			oninput={onSearchInput}
			placeholder="Search songs to seed the vibe…"
			class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink placeholder:text-ink-faint focus:border-accent"
		/>

		{#if searching}
			<p class="mt-2 text-xs text-ink-faint">Searching…</p>
		{:else if searchResults.length > 0}
			<ul class="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
				{#each searchResults as result (result.videoId)}
					<li>
						<button
							type="button"
							onclick={() => addSeed(result)}
							disabled={seeds.some((s) => s.videoId === result.videoId)}
							class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-surface-2 disabled:opacity-40"
						>
							<span class="min-w-0 flex-1 truncate">
								{result.title}
								<span class="text-ink-faint">· {result.artist}</span>
							</span>
							<span class="shrink-0 text-xs text-accent-hover">
								{seeds.some((s) => s.videoId === result.videoId) ? 'added' : '+ add'}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if createError}
		<p class="mt-4 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger" role="alert">
			{createError}
		</p>
	{/if}

	<button
		onclick={create}
		disabled={creating}
		class="mt-5 rounded-full bg-accent px-6 py-2 text-sm font-medium text-accent-ink transition hover:bg-accent-hover disabled:opacity-50"
	>
		{creating ? 'Creating…' : 'Create playlist'}
	</button>
</section>

{#if data.playlists.length === 0}
	<p class="mt-16 text-center text-ink-muted">
		No recommendation playlists yet. Create one above to start growing a daily radio.
	</p>
{:else}
	<ul class="divide-y divide-line overflow-hidden rounded-xl bg-surface">
		{#each data.playlists as pl (pl.id)}
			<li class="flex items-center gap-4 px-4 py-3">
				<div
					class="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-surface-3 text-accent-hover"
				>
					<svg
						viewBox="0 0 24 24"
						class="h-6 w-6"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path
							d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4L12 3zM18 14l1 2.4L21.5 17l-2.5 1L18 20.5 17 18l-2.5-1 2.5-.6L18 14z"
						/>
					</svg>
				</div>
				<div class="min-w-0 flex-1">
					<p class="truncate font-medium">{pl.name}</p>
					<p class="truncate text-xs text-ink-faint">
						{pl.dailyCount} song{pl.dailyCount === 1 ? '' : 's'}/day · {pl.trackCount} track{pl.trackCount ===
						1
							? ''
							: 's'} · {lastChecked(pl.lastCheckedAt)}
					</p>
				</div>
				<button
					onclick={() => remove(pl.id)}
					disabled={busyId === pl.id}
					class="rounded-full border border-line px-4 py-1.5 text-sm text-ink-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-50"
				>
					{busyId === pl.id ? '…' : 'Delete'}
				</button>
			</li>
		{/each}
	</ul>
{/if}
