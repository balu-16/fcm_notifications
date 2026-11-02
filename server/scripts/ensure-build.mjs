import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
let compiler;
try {
  compiler = require.resolve('typescript/bin/tsc');
} catch {
  // Prebuilt production installations may omit development dependencies.
}

if (compiler && existsSync(new URL('../src/', import.meta.url))) {
  const build = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.build.json'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (build.error || build.status !== 0) {
    console.error('Server build failed; the server was not started.');
    process.exit(build.status || 1);
  }
} else if (!existsSync(new URL('../dist/main.js', import.meta.url))) {
  console.error('Server build is missing. Install development dependencies and run npm run build.');
  process.exit(1);
}
