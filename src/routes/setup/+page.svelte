<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);
	// URL carried from the successful test into the credentials step.
	let testedUrl = $derived(form && 'url' in form && form.url ? String(form.url) : '');
	// Once the connection test succeeds, stay on the credentials step — a
	// failed sign-in attempt must not collapse the wizard back to step 1.
	let credentialsStep = $derived(
		Boolean(form && (('ok' in form && form.ok) || ('step' in form && form.step === 'connect')))
	);
	// Bound so a failed attempt's re-render can't wipe what the user typed.
	let username = $state('');
	let password = $state('');
</script>

<svelte:head>
	<title>Setup — myoutarr</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-canvas px-4">
	<div class="w-full max-w-md rounded-2xl bg-surface p-8 shadow-xl">
		<div class="mb-8 text-center">
			<h1 class="text-2xl font-bold text-ink">Welcome to myoutarr</h1>
			<p class="mt-1 text-sm text-ink-muted">
				{data.phase === 'library'
					? 'Almost done — choose where music should be saved.'
					: 'Connect your Jellyfin server to get started.'}
			</p>
		</div>

		{#if data.phase === 'connect'}
			<form
				method="POST"
				action={credentialsStep ? '?/connect' : '?/test'}
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						submitting = false;
						await update({ reset: false });
					};
				}}
				class="space-y-4"
			>
				<label class="block">
					<span class="mb-1 block text-sm text-ink-muted">Jellyfin server URL</span>
					<input
						name="url"
						type="url"
						required
						placeholder="http://jellyfin:8096"
						value={testedUrl}
						class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink placeholder:text-ink-faint focus:border-accent"
					/>
				</label>

				{#if credentialsStep}
					{#if form && 'ok' in form && form.ok}
						<p class="rounded-lg bg-ok/15 px-3 py-2 text-sm text-ok">
							Connected to {form.serverName} (v{form.version}). Now sign in:
						</p>
					{/if}
					<label class="block">
						<span class="mb-1 block text-sm text-ink-muted">Username</span>
						<input
							name="username"
							type="text"
							required
							autocomplete="username"
							bind:value={username}
							class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink focus:border-accent"
						/>
					</label>
					<label class="block">
						<span class="mb-1 block text-sm text-ink-muted">Password</span>
						<input
							name="password"
							type="password"
							autocomplete="current-password"
							bind:value={password}
							class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink focus:border-accent"
						/>
					</label>
				{/if}

				{#if form?.error}
					<p class="rounded-lg bg-danger/15 px-3 py-2 text-sm text-accent-hover" role="alert">
						{form.error}
					</p>
				{/if}

				<button
					type="submit"
					disabled={submitting}
					class="w-full rounded-full bg-accent py-2.5 font-medium text-accent-ink transition hover:bg-accent-hover disabled:opacity-50"
				>
					{#if submitting}
						Working…
					{:else if credentialsStep}
						Sign in and continue
					{:else}
						Test connection
					{/if}
				</button>
			</form>
		{:else}
			<form
				method="POST"
				action="?/library"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						submitting = false;
						await update();
					};
				}}
				class="space-y-4"
			>
				{#if data.libraries.length > 0}
					<fieldset class="space-y-2">
						<legend class="mb-1 text-sm text-ink-muted">Music libraries found on Jellyfin</legend>
						{#each data.libraries as library (library.name)}
							{#each library.locations as location (location)}
								<label
									class="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2 transition hover:border-accent"
								>
									<input type="radio" name="libraryPath" value={location} class="accent-accent" />
									<span class="min-w-0">
										<span class="block truncate text-sm text-ink">{library.name}</span>
										<span class="block truncate text-xs text-ink-faint">{location}</span>
									</span>
								</label>
							{/each}
						{/each}
					</fieldset>
					<p class="text-xs text-ink-faint">
						This must be the path as myoutarr's container sees it (its <code>/music</code> mount usually
						maps to one of these).
					</p>
				{:else}
					<label class="block">
						<span class="mb-1 block text-sm text-ink-muted">Music library path</span>
						<input
							name="libraryPath"
							type="text"
							required
							placeholder="/music"
							class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink placeholder:text-ink-faint focus:border-accent"
						/>
					</label>
				{/if}

				{#if form?.error}
					<p class="rounded-lg bg-danger/15 px-3 py-2 text-sm text-accent-hover" role="alert">
						{form.error}
					</p>
				{/if}

				<button
					type="submit"
					disabled={submitting}
					class="w-full rounded-full bg-accent py-2.5 font-medium text-accent-ink transition hover:bg-accent-hover disabled:opacity-50"
				>
					{submitting ? 'Saving…' : 'Finish setup'}
				</button>
			</form>
		{/if}
	</div>
</div>
