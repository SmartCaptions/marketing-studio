/**
 * scripts/lib/fake-tools.mjs — stand-ins for the programs the render scripts shell out to, so a
 * test can run the real render-reel / render-post main() with no Remotion render and no music
 * call. Test-only: used by build-reel-props.test.mjs and build-post-props.test.mjs.
 */
import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// `npx remotion render <composition> <out> ...` leaves an empty <out>; `npx remotion ffprobe` prints nothing.
const NPX = `#!/bin/sh
[ "$2" = render ] && : > "$4"
exit 0
`;

// The music feeder is spawned as \`node feeders/audio/client.mjs\`; exit 2 is its documented "no key" exit.
const NODE = `#!/bin/sh
exit 2
`;

/**
 * Run `fn` with fake `npx` and `node` first on PATH, then restore PATH. A main() that fails calls
 * process.exit(1); inside `fn` that throws instead, so the test reports the failure and goes on.
 */
export const withFakeTools = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-tools-'));
  for (const [name, body] of [['npx', NPX], ['node', NODE]]) {
    writeFileSync(join(dir, name), body);
    chmodSync(join(dir, name), 0o755);
  }
  const path = process.env.PATH;
  const exit = process.exit;
  process.env.PATH = `${dir}:${path}`;
  process.exit = (code) => {
    throw new Error(`process.exit(${code})`);
  };
  try {
    return await fn();
  } finally {
    process.exit = exit;
    process.env.PATH = path;
    rmSync(dir, {recursive: true, force: true});
  }
};
