import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/** Fresh state per run: the wizard must start unconfigured. */
export default function globalSetup(): void {
	const tmp = path.resolve('e2e/.tmp');
	rmSync(tmp, { recursive: true, force: true });
	mkdirSync(path.join(tmp, 'config'), { recursive: true });
	mkdirSync(path.join(tmp, 'music'), { recursive: true });
}
