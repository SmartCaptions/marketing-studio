// Source of truth for smartcaptions launch AUDIO copy: props/smartcaptions-audio.json is GENERATED.
// Edit VO lines and the music prompt here, never in the JSON.
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'studio', 'public', 'smartcaptions', 'audio');

// --force              regenerate every line + music
// --force <id,id,...>  regenerate only the listed acts (and/or "music"), e.g.
//                       --force hook,demo — use this to fix one overrunning line
//                       without re-paying for lines that already fit.
const forceFlagIdx = process.argv.indexOf('--force');
const forceArg = forceFlagIdx >= 0 ? process.argv[forceFlagIdx + 1] : undefined;
const forceIds = forceFlagIdx >= 0 && forceArg && !forceArg.startsWith('--')
  ? new Set(forceArg.split(','))
  : null;
const forceAll = forceFlagIdx >= 0 && !forceIds;
const shouldForce = (id) => forceAll || (forceIds?.has(id) ?? false);

// Spoken copy: written for the ear (say "SmartCaptions", not "smartcaptions.co.il").
// Acts: logo, hook, demo, feature-1 (features[1]), feature-2 (features[2]), end.
// feature-0 (the one-click panel) is covered by the demo narration; no VO line here.
const LINES = [
  {id: 'logo', text: 'SmartCaptions.'},
  {id: 'hook', text: 'Captions and subtitles for Premiere Pro, in one click.'},
  {
    id: 'demo',
    text: 'Open the panel, pick your settings, and transcribe your sequence. Real speech to text, timed to the word.',
  },
  {id: 'feature-1', text: 'Auto detect the language, or translate on the way.'},
  {id: 'feature-2', text: 'Fix a word, drag a timing, and fill every gap on the timeline.'},
  {id: 'end', text: 'Stop typing captions. Try SmartCaptions free.'},
];

const MUSIC_PROMPT =
  'clean bright professional electronic, smooth synth layers with crisp precise attack, ' +
  'confident steady tempo around 100 bpm, polished and modern, subtle cinematic lift, ' +
  'no vocals, no heavy drums, forward momentum without distraction, fades naturally at the end';

// total duration in ms; constants mirror studio/src/lib/launchTiming.ts
const telemetry = JSON.parse(readFileSync(join(root, 'props', 'smartcaptions-demo.json'), 'utf8')).telemetry;
const demoLen = Math.ceil((telemetry.durationMs / 1000) * 30) + 24;
// the `3 *` must track this brand's feature count (3 panels) in build-launch-props
const totalFrames = 150 + 186 + demoLen + 3 * 180 + 150;
const totalMs = Math.round((totalFrames / 30) * 1000);

mkdirSync(outDir, {recursive: true});
const durations = {};

const run = (cmd) => execSync(cmd, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});

// VO: generate missing lines (or forced ones)
const pending = LINES.filter((l) => shouldForce(l.id) || !existsSync(join(outDir, `${l.id}.mp3`)));
if (pending.length > 0) {
  const scriptPath = join(root, 'out', 'smartcaptions', 'vo-script.json');
  mkdirSync(dirname(scriptPath), {recursive: true});
  writeFileSync(scriptPath, JSON.stringify({lines: pending}));
  const out = run(`node feeders/audio/client.mjs vo --script "${scriptPath}" --out "${outDir}"`);
  process.stdout.write(out);
  for (const m of out.matchAll(/vo OK: (.+)\.mp3 (\d+)ms/g)) durations[m[1]] = Number(m[2]);
}

// any line we skipped generating this run still needs a measured duration for the
// manifest; probe the file on disk instead of re-hitting the API.
for (const l of LINES) {
  if (durations[l.id] !== undefined) continue;
  const file = join(outDir, `${l.id}.mp3`);
  if (!existsSync(file)) continue; // caught by the manifest completeness check below
  const out = run(`node feeders/audio/client.mjs probe --file "${file}"`);
  process.stdout.write(out);
  const m = out.match(/probe OK: .+ (\d+)ms/);
  if (m) durations[l.id] = Number(m[1]);
}

const musicFile = join(outDir, 'music.mp3');
if (shouldForce('music') || !existsSync(musicFile)) {
  const out = run(
    `node feeders/audio/client.mjs music --prompt "${MUSIC_PROMPT}" --length-ms ${totalMs} --out "${musicFile}"`,
  );
  process.stdout.write(out);
  const m = out.match(/music OK: .+ (\d+)ms/);
  durations.music = Number(m?.[1]);
} else {
  const out = run(`node feeders/audio/client.mjs probe --file "${musicFile}"`);
  process.stdout.write(out);
  const m = out.match(/probe OK: .+ (\d+)ms/);
  if (m) durations.music = Number(m[1]);
}

const missing = LINES.filter((l) => !durations[l.id]);
if (missing.length > 0) {
  throw new Error(`no measured duration for: ${missing.map((l) => l.id).join(', ')}`);
}
if (!durations.music) {
  throw new Error('no measured duration for music');
}

const manifest = {
  music: {src: 'smartcaptions/audio/music.mp3', durationMs: durations.music},
  lines: LINES.map((l) => ({
    act: l.id,
    src: `smartcaptions/audio/${l.id}.mp3`,
    durationMs: durations[l.id],
    text: l.text,
  })),
};

// Sound-design cue gate: enable the sfx layer only when the shared library is staged
// (run scripts/build-sfx.mjs first). Cue FRAMES are NOT written here — they are derived
// at render time from launchTiming by studio/src/lib/sfxCues.ts, so the builder only
// flips the presence flag. Absent library => key omitted => renders stay byte-identical.
const sfxLib = ['whoosh', 'tick', 'riser'].map((k) => join(root, 'studio', 'public', 'sfx', `${k}.mp3`));
if (sfxLib.every((f) => existsSync(f))) {
  manifest.sfx = {enabled: true};
  console.log('sfx: library present -> manifest.sfx.enabled = true');
}

writeFileSync(join(root, 'props', 'smartcaptions-audio.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote props/smartcaptions-audio.json (${totalMs}ms track, ${LINES.length} lines)`);
