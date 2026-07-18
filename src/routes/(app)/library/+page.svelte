<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let crumbs = $derived(
		data.path
			? data.path.split('/').map((segment, index, parts) => ({
					name: segment,
					path: parts.slice(0, index + 1).join('/')
				}))
			: []
	);

	function fmtSize(bytes?: number): string {
		if (!bytes) return '';
		if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
		return `${Math.round(bytes / 1024)} KB`;
	}
</script>

<svelte:head>
	<title>Library - myoutarr</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
	<div>
		<h1 class="text-3xl font-bold">Library</h1>
		<nav class="mt-1 text-sm text-ink-muted">
			<a href="/library" class="hover:text-ink">music</a>
			{#each crumbs as crumb (crumb.path)}
				<span class="text-ink-faint">/</span>
				<a href="/library?path={encodeURIComponent(crumb.path)}" class="hover:text-ink">
					{crumb.name}
				</a>
			{/each}
		</nav>
	</div>
	<a
		href="/upload"
		class="rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-ink transition hover:bg-accent-hover"
	>
		Upload music
	</a>
</div>

{#if data.error}
	<p class="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger" role="alert">{data.error}</p>
{:else if data.entries.length === 0}
	<p class="mt-16 text-center text-ink-muted">This folder is empty.</p>
{:else}
	<ul class="divide-y divide-line overflow-hidden rounded-xl bg-surface">
		{#each data.entries as entry (entry.path)}
			<li class="flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface-2">
				{#if entry.kind === 'directory'}
					<span class="text-lg">📁</span>
					<a
						href="/library?path={encodeURIComponent(entry.path)}"
						class="min-w-0 flex-1 truncate text-sm text-ink hover:underline"
					>
						{entry.name}
					</a>
				{:else}
					<span class="text-lg">🎵</span>
					<span class="min-w-0 flex-1 truncate text-sm text-ink">{entry.name}</span>
					<span class="text-xs text-ink-faint">{fmtSize(entry.sizeBytes)}</span>
					<a
						href="/library/edit?path={encodeURIComponent(entry.path)}"
						class="rounded-full px-3 py-1 text-xs text-ink-muted transition hover:bg-surface-3 hover:text-ink"
					>
						Edit tags
					</a>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
