<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Sign in - myoutarr</title>
</svelte:head>

<div class="flex min-h-dvh items-center justify-center bg-canvas px-4">
	<div class="w-full max-w-sm rounded-2xl bg-surface p-8 shadow-xl">
		<div class="mb-8 text-center">
			<h1 class="text-2xl font-bold text-ink">myoutarr</h1>
			<p class="mt-1 text-sm text-ink-muted">Sign in with your Jellyfin account</p>
		</div>

		<form
			method="POST"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					submitting = false;
					await update();
				};
			}}
			class="space-y-4"
		>
			<label class="block">
				<span class="mb-1 block text-sm text-ink-muted">Username</span>
				<input
					name="username"
					type="text"
					required
					autocomplete="username"
					class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink placeholder:text-ink-faint focus:border-accent"
				/>
			</label>
			<label class="block">
				<span class="mb-1 block text-sm text-ink-muted">Password</span>
				<input
					name="password"
					type="password"
					autocomplete="current-password"
					class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink focus:border-accent"
				/>
			</label>

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
				{submitting ? 'Signing in…' : 'Sign in'}
			</button>
		</form>
	</div>
</div>
