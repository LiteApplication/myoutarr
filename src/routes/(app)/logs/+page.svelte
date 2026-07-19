<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const statusStyles: Record<string, string> = {
		completed: 'text-ok',
		failed: 'text-danger',
		cancelled: 'text-ink-faint'
	};

	type Filter = 'all' | 'completed' | 'failed' | 'cancelled';
	let filter = $state<Filter>('all');
	let expandedError = $state<string | null>(null);

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

	const counts = $derived({
		all: data.entries.length,
		completed: data.entries.filter((e) => e.status === 'completed').length,
		failed: data.entries.filter((e) => e.status === 'failed').length,
		cancelled: data.entries.filter((e) => e.status === 'cancelled').length
	});

	const shown = $derived(
		filter === 'all' ? data.entries : data.entries.filter((e) => e.status === filter)
	);

	const filters: { key: Filter; label: string }[] = [
		{ key: 'all', label: 'All' },
		{ key: 'completed', label: 'Completed' },
		{ key: 'failed', label: 'Failed' },
		{ key: 'cancelled', label: 'Cancelled' }
	];

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

	function absolute(ts: number | null): string {
		return ts ? new Date(ts).toLocaleString() : '';
	}

	function duration(start: number | null, end: number | null): string {
		if (!start || !end || end < start) return '';
		const s = Math.round((end - start) / 1000);
		if (s < 60) return `${s}s`;
		const m = Math.floor(s / 60);
		return `${m}m ${s % 60}s`;
	}
</script>

<svelte:head>
	<title>Logs - myoutarr</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
	<h1 class="text-3xl font-bold">Logs</h1>
	<div class="flex flex-wrap gap-2">
		{#each filters as f (f.key)}
			<button
				onclick={() => (filter = f.key)}
				class="rounded-full px-4 py-1.5 text-sm transition
					{filter === f.key
					? 'bg-accent text-accent-ink'
					: 'bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink'}"
			>
				{f.label}
				<span class="opacity-60">{counts[f.key]}</span>
			</button>
		{/each}
	</div>
</div>

{#if shown.length === 0}
	<p class="mt-16 text-center text-ink-muted">No job history yet.</p>
{:else}
	<ul class="overflow-hidden rounded-xl bg-surface">
		{#each shown as entry (entry.id)}
			<li class="border-b border-line last:border-b-0 px-4 py-3">
				<div class="flex items-center gap-3">
					{#if entry.thumbnail}
						<a href="/song/{entry.videoId}" class="shrink-0">
							<img src={entry.thumbnail} alt="" class="h-10 w-10 rounded object-cover" />
						</a>
					{/if}
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm text-ink">
							<a href="/song/{entry.videoId}" class="hover:underline">{entry.title}</a>
						</p>
						<p class="truncate text-xs text-ink-muted">
							{#if entry.artist}{entry.artist} ·
							{/if}
							<a
								href={batchLinkHref(entry.batchKind, entry.batchSourceId, entry.videoId)}
								class="hover:underline text-ink-muted hover:text-ink"
							>
								{entry.batchTitle}
							</a>
							· {entry.batchKind}
						</p>
					</div>
					<div class="shrink-0 text-right">
						<p class="text-xs {statusStyles[entry.status] ?? 'text-ink-muted'}">{entry.status}</p>
						<p class="text-xs text-ink-faint" title={absolute(entry.finishedAt)}>
							{relative(entry.finishedAt)}{#if duration(entry.startedAt, entry.finishedAt)}
								· {duration(entry.startedAt, entry.finishedAt)}{/if}
						</p>
					</div>
					{#if entry.error}
						<button
							onclick={() => (expandedError = expandedError === entry.id ? null : entry.id)}
							class="shrink-0 rounded-full px-2 py-1 text-xs text-danger transition hover:bg-surface-3"
						>
							details
						</button>
					{/if}
				</div>
				{#if expandedError === entry.id && entry.error}
					<pre
						class="mt-2 overflow-x-auto rounded-lg bg-canvas p-3 text-xs text-danger">{entry.error}</pre>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
