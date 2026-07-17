<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let submitting = $state(false);

	const fields = [
		{ name: 'title', label: 'Title', required: true },
		{ name: 'artist', label: 'Artist', required: true },
		{ name: 'album', label: 'Album', required: true },
		{ name: 'albumArtist', label: 'Album artist', required: false },
		{ name: 'year', label: 'Year', required: false },
		{ name: 'genre', label: 'Genre', required: false },
		{ name: 'trackNumber', label: 'Track #', required: false }
	];
</script>

<svelte:head>
	<title>Upload — myoutarr</title>
</svelte:head>

<div class="mx-auto max-w-xl">
	<h1 class="text-3xl font-bold">Upload music</h1>
	<p class="mt-1 text-sm text-ink-muted">
		Add your own files to the library. They are tagged, filed by the naming template, and given NFOs
		— exactly like downloaded tracks.
	</p>

	<form
		method="POST"
		enctype="multipart/form-data"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				submitting = false;
				await update();
			};
		}}
		class="mt-6 space-y-4 rounded-2xl bg-surface p-6"
	>
		<label class="block">
			<span class="mb-1 block text-sm text-ink-muted">Audio file (opus, m4a, mp3, flac, ogg)</span>
			<input
				name="file"
				type="file"
				required
				accept=".opus,.m4a,.mp3,.flac,.ogg,audio/*"
				class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-surface-3 file:px-4 file:py-1.5 file:text-ink-muted"
			/>
		</label>

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			{#each fields as field (field.name)}
				<label class="block {field.name === 'title' ? 'sm:col-span-2' : ''}">
					<span class="mb-1 block text-sm text-ink-muted">{field.label}</span>
					<input
						name={field.name}
						type="text"
						required={field.required}
						class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink focus:border-accent"
					/>
				</label>
			{/each}
		</div>

		{#if form?.error}
			<p class="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger" role="alert">{form.error}</p>
		{/if}

		<button
			type="submit"
			disabled={submitting}
			class="rounded-full bg-accent px-6 py-2 text-sm font-medium text-accent-ink transition hover:bg-accent-hover disabled:opacity-50"
		>
			{submitting ? 'Uploading…' : 'Upload to library'}
		</button>
	</form>
</div>
