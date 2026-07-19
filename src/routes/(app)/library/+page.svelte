<script lang="ts">
	import { enhance } from '$app/forms';
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

	// Depth of the current folder decides what its children are: artists at the
	// root, albums one level in, tracks below that - phrasing the confirmation.
	let childKind = $derived(
		data.path === '' ? 'artist' : data.path.includes('/') ? 'track' : 'album'
	);

	let deleting = $state<string | null>(null);
	let errorMsg = $state<string | null>(null);

	function confirmMessage(entry: { name: string; kind: string }): string {
		if (entry.kind === 'directory') {
			const noun = childKind === 'artist' ? 'artist' : 'album';
			return `Delete the ${noun} "${entry.name}" and everything inside it? This permanently removes the files and cannot be undone.`;
		}
		return `Delete the track "${entry.name}"? This permanently removes the file and cannot be undone.`;
	}

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

{#if errorMsg}
	<p class="mb-4 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger" role="alert">{errorMsg}</p>
{/if}

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
				<form
					method="POST"
					action="?/delete"
					use:enhance={({ cancel }) => {
						if (!globalThis.confirm(confirmMessage(entry))) {
							cancel();
							return;
						}
						deleting = entry.path;
						errorMsg = null;
						return async ({ result, update }) => {
							deleting = null;
							if (result.type === 'failure') {
								errorMsg = (result.data?.error as string) ?? 'Could not delete this item.';
							}
							await update();
						};
					}}
				>
					<input type="hidden" name="path" value={entry.path} />
					<button
						type="submit"
						disabled={deleting === entry.path}
						class="rounded-full px-3 py-1 text-xs text-danger transition hover:bg-danger/15 disabled:opacity-50"
					>
						{deleting === entry.path ? 'Deleting…' : 'Delete'}
					</button>
				</form>
			</li>
		{/each}
	</ul>
{/if}
