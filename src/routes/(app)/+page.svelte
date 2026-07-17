<script lang="ts">
	const suggestions = ['Daft Punk', 'Radiohead', 'Kendrick Lamar', 'Aphex Twin'];
</script>

<svelte:head>
	<title>myoutarr</title>
</svelte:head>

<div class="mx-auto mt-24 max-w-lg text-center">
	<div
		class="mx-auto grid h-16 w-16 place-items-center rounded-full bg-accent text-3xl font-black text-accent-ink"
	>
		m
	</div>
	<h1 class="mt-6 text-2xl font-bold">Find music for your Jellyfin library</h1>
	<p class="mt-2 text-sm text-ink-muted">
		Search for an artist, album, playlist or track above, then queue it for download. Files are
		tagged and organised so Jellyfin picks them up cleanly.
	</p>
	<div class="mt-6 flex flex-wrap justify-center gap-2">
		{#each suggestions as suggestion (suggestion)}
			<a
				href="/search?q={encodeURIComponent(suggestion)}"
				class="rounded-full bg-surface-2 px-4 py-1.5 text-sm text-ink-muted transition hover:bg-surface-3 hover:text-ink"
			>
				{suggestion}
			</a>
		{/each}
	</div>
</div>
