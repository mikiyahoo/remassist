#!/usr/bin/env node
/**
 * A second dev server that does not fight the first one.
 *
 * Two `next dev` processes in one checkout share .next and corrupt each other:
 * both rewrite _buildManifest.js.tmp on every compile, and the loser of the
 * race answers 500 for every route, including static pages neither of them
 * touched. The symptom is baffling because it looks like your code broke.
 *
 * This gives the second server its own build directory and, just as important,
 * its own AUTH_URL. Auth.js builds every absolute redirect from AUTH_URL, so a
 * second server on a different port would otherwise bounce sign-in to whatever
 * is listening on the first one.
 *
 * Usage:  node tools/dev-isolated.mjs [port]      (default 3210)
 *
 * Development only. Nothing here runs in a build or on the VPS: next.config.ts
 * falls back to '.next' whenever NEXT_DIST_DIR is unset, which is always
 * except through this script.
 */
import { spawn } from 'node:child_process';

const port = String(Number(process.argv[2]) || 3210);
const origin = `http://localhost:${port}`;

const env = {
  ...process.env,
  /* Fixed, not per-port. Next appends a types path under the dist dir to the
     tsconfig include whenever it is missing, so a name that varied by port
     dirtied a tracked file on every run and added a fresh entry each time.
     tsconfig already lists this one, so Next finds it and leaves the file
     alone. The cost is that two isolated servers would share a tree, which is
     fine: the point is not colliding with the main .next. */
  NEXT_DIST_DIR: '.next-dev',
  /* Overrides whatever .env.local says. Next loads .env.local into the child,
     but a variable already present in the environment wins, so this sticks. */
  AUTH_URL: origin,
  PORT: port,
};

console.log(`\n  dev server on ${origin}`);
console.log(`  build dir  ${env.NEXT_DIST_DIR}`);
console.log(`  AUTH_URL   ${origin}  (overriding .env.local)\n`);

const child = spawn('npx', ['next', 'dev', '--turbopack', '--port', port], {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
