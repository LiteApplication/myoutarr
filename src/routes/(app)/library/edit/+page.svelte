<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);

	let fields = $derived([
		{ name: 'title', label: 'Title', value: data.tags.title, required: true },
		{ name: 'artist', label: 'Artist', value: data.tags.artist, required: true },
		{ name: 'album', label: 'Album', value: data.tags.album, required: true },
		{ name: 'albumArtist', label: 'Album artist', value: data.tags.albumartist, required: false },
		{ name: 'year', label: 'Year', value: data.tags.date?.slice(0, 4), required: false },
		{ name: 'genre', label: 'Genre', value: data.tags.genre, required: false },
		{ name: 'trackNumber', label: 'Track #', value: data.tags.tracknumber, required: false }
	]);
</script>

<svelte:head>
	<title>Edit tags — myoutarr</title>
</svelte:head>

<div class="mx-auto max-w-xl">
	<h1 class="text-3xl font-bold">Edit tags</h1>
	<p class="mt-1 truncate text-sm text-ink-muted">{data.path}</p>

	<form
		method="POST"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				submitting = false;
				await update();
			};
		}}
		class="mt-6 space-y-4 rounded-2xl bg-surface p-6"
	>
		<input type="hidden" name="path" value={data.path} />
		{#each fields as field (field.name)}
			<label class="block">
				<span class="mb-1 block text-sm text-ink-muted">{field.label}</span>
				<input
					name={field.name}
					type="text"
					required={field.required}
					value={field.value ?? ''}
					class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink focus:border-accent"
				/>
			</label>
		{/each}

		{#if form?.error}
			<p class="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger" role="alert">{form.error}</p>
		{/if}

		<p class="text-xs text-ink-faint">
			Saving retags the file, moves it to match the naming template if needed, and rewrites the
			album and artist NFOs Jellyfin reads.
		</p>

		<div class="flex gap-3">
			<button
				type="submit"
				disabled={submitting}
				class="rounded-full bg-accent px-6 py-2 text-sm font-medium text-accent-ink transition hover:bg-accent-hover disabled:opacity-50"
			>
				{submitting ? 'Saving…' : 'Save tags'}
			</button>
			<a
				href="/library"
				class="rounded-full bg-surface-2 px-6 py-2 text-sm text-ink-muted transition hover:bg-surface-3 hover:text-ink"
			>
				Cancel
			</a>
		</div>
	</form>
</div>
