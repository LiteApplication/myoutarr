<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);
	let hasCookies = $derived(form?.hasCookies ?? data.hasCookies);
</script>

<svelte:head>
	<title>Cookies — myoutarr</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<h1 class="text-3xl font-bold">YouTube cookies</h1>
	<p class="mt-2 text-sm text-ink-muted">
		These cookies are tied to <span class="font-medium text-ink">your account</span> only. They let
		yt-dlp download age-restricted or members-only tracks, and reduce &ldquo;Sign in to confirm
		you&rsquo;re not a bot&rdquo; failures, by acting as a browser signed in to <em>your</em> YouTube
		account.
	</p>

	<section class="mt-6 rounded-2xl bg-surface p-6">
		<h2 class="mb-3 text-lg font-semibold">How to export your cookies</h2>
		<ol class="list-decimal space-y-2 pl-5 text-sm text-ink-muted">
			<li>
				In your browser, sign in to <a
					href="https://music.youtube.com"
					target="_blank"
					rel="noreferrer"
					class="text-accent hover:underline">music.youtube.com</a
				>.
			</li>
			<li>
				Install a cookies exporter, e.g.
				<a
					href="https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc"
					target="_blank"
					rel="noreferrer"
					class="text-accent hover:underline">Get cookies.txt LOCALLY</a
				>
				(Chrome) or
				<a
					href="https://addons.mozilla.org/firefox/addon/cookies-txt/"
					target="_blank"
					rel="noreferrer"
					class="text-accent hover:underline">cookies.txt</a
				> (Firefox).
			</li>
			<li>
				With youtube.com open, export in <span class="font-medium text-ink">Netscape</span> format
				and save the <code class="rounded bg-surface-2 px-1 py-0.5 text-xs">cookies.txt</code> file.
			</li>
			<li>Paste its contents below (or upload the file) and save.</li>
		</ol>
		<p class="mt-4 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
			Use a private/incognito window or log out of YouTube <em>after</em> exporting: YouTube rotates
			cookies, and closing the session that generated them keeps them valid longer. Full details in
			the
			<a
				href="https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp"
				target="_blank"
				rel="noreferrer"
				class="underline">yt-dlp cookies FAQ</a
			>.
		</p>
	</section>

	<form
		method="POST"
		action="?/save"
		enctype="multipart/form-data"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				submitting = false;
				await update({ reset: false });
			};
		}}
		class="mt-6 space-y-4"
	>
		<section class="rounded-2xl bg-surface p-6">
			<div class="mb-3 flex items-center justify-between">
				<h2 class="text-lg font-semibold">Your cookies</h2>
				{#if hasCookies}
					<span class="rounded-full bg-ok/15 px-3 py-1 text-xs font-medium text-ok">
						Cookies saved
					</span>
				{:else}
					<span class="rounded-full bg-surface-2 px-3 py-1 text-xs text-ink-muted">Not set</span>
				{/if}
			</div>

			<label class="block">
				<span class="mb-1 block text-sm text-ink-muted">Paste cookies.txt contents</span>
				<textarea
					name="cookies"
					rows="8"
					placeholder="# Netscape HTTP Cookie File&#10;.youtube.com	TRUE	/	TRUE	1234567890	SID	..."
					class="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-accent"
				></textarea>
			</label>

			<label class="mt-3 block">
				<span class="mb-1 block text-sm text-ink-muted">…or upload a file</span>
				<input
					name="file"
					type="file"
					accept=".txt,text/plain"
					class="block w-full text-sm text-ink-muted file:mr-3 file:rounded-full file:border-0 file:bg-surface-2 file:px-4 file:py-2 file:text-sm file:text-ink hover:file:bg-line"
				/>
			</label>

			{#if form?.error}
				<p class="mt-3 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger" role="alert">
					{form.error}
				</p>
			{/if}
			{#if form?.saved}
				<p class="mt-3 rounded-lg bg-ok/15 px-3 py-2 text-sm text-ok">Cookies saved.</p>
			{/if}
			{#if form?.deleted}
				<p class="mt-3 rounded-lg bg-ok/15 px-3 py-2 text-sm text-ok">Cookies removed.</p>
			{/if}
		</section>

		<div class="flex items-center gap-3">
			<button
				type="submit"
				disabled={submitting}
				class="rounded-full bg-accent px-6 py-2 text-sm font-medium text-accent-ink transition hover:bg-accent-hover disabled:opacity-50"
			>
				{submitting ? 'Saving…' : 'Save cookies'}
			</button>
			{#if hasCookies}
				<button
					type="submit"
					formaction="?/delete"
					class="rounded-full px-4 py-2 text-sm text-ink-muted transition hover:bg-surface-2 hover:text-danger"
				>
					Remove cookies
				</button>
			{/if}
		</div>
	</form>
</div>
