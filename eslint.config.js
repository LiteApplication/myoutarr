import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import ts from 'typescript-eslint';

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	{
		languageOptions: {
			globals: {
				console: 'readonly',
				process: 'readonly',
				fetch: 'readonly',
				URL: 'readonly',
				Response: 'readonly',
				Request: 'readonly',
				setTimeout: 'readonly',
				clearTimeout: 'readonly',
				setInterval: 'readonly',
				clearInterval: 'readonly',
				AbortController: 'readonly',
				AbortSignal: 'readonly',
				URLSearchParams: 'readonly',
				TextEncoder: 'readonly',
				TextDecoder: 'readonly',
				ReadableStream: 'readonly',
				crypto: 'readonly',
				Buffer: 'readonly'
			}
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser
			}
		}
	},
	{
		rules: {
			// The app is always served from the domain root (its container has no
			// configurable base path), so resolve()-wrapping every href is noise.
			'svelte/no-navigation-without-resolve': 'off',
			// The yt-dlp/worker boundary passes loosely-typed JSON around; prefer
			// explicit `unknown` + narrowing, but don't block on library types.
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			]
		}
	},
	{
		ignores: ['build/', '.svelte-kit/', 'node_modules/', 'coverage/', 'test-results/', '.venv/']
	}
);
