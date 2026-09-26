/**
 * scripts/lib/post-output.mjs — the finishing steps every rendered post shares: loudness
 * normalisation to EBU R128 −14 LUFS, the SRT sidecar from the props' caption cues, and the
 * rendered duration. Used by render-post.mjs (HybridPost) and finish-render.mjs (Finish).
 */
import {spawnSync} from 'node:child_process';
import {renameSync} from 'node:fs';
import {resolve} from 'node:path';

const LUFS_TARGET = -14;
const LUFS_TP_TARGET = -1.5;
const LUFS_TOLERANCE = 1.5;

export const measureLufs = (file) => {
  const proc = spawnSync('ffmpeg', [
    '-i', resolve(file),
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json',
    '-f', 'null', '-',
  ], {encoding: 'utf8', timeout: 120_000});
  const combined = `${proc.stdout ?? ''}\n${proc.stderr ?? ''}`;
  const match = combined.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    const v = parseFloat(JSON.parse(match[0]).input_i);
    return isFinite(v) ? v : null;
  } catch {
    return null;
  }
};

/**
 * Two-pass loudnorm in place. Failure is logged and left non-fatal: the video still has its
 * voice-over, only at the level it was rendered at.
 */
export const normaliseLoudness = (mp4, tag) => {
  try {
    console.log(`[${tag}] loudnorm pass 1: measuring…`);
    const p1 = spawnSync('ffmpeg', [
      '-i', mp4,
      '-af', `loudnorm=I=${LUFS_TARGET}:TP=${LUFS_TP_TARGET}:LRA=11:print_format=json`,
      '-f', 'null', '-',
    ], {encoding: 'utf8', timeout: 120_000});
    const match1 = `${p1.stdout ?? ''}\n${p1.stderr ?? ''}`.match(/\{[\s\S]*?\}/);
    if (!match1) throw new Error('loudnorm pass 1: no JSON in output');
    const ln = JSON.parse(match1[0]);
    console.log(`[${tag}] measured I=${ln.input_i} LUFS, TP=${ln.input_tp} dBTP`);

    const normMp4 = mp4.replace(/\.mp4$/, '-norm.mp4');
    const filter = [
      `loudnorm=I=${LUFS_TARGET}:TP=${LUFS_TP_TARGET}:LRA=11`,
      `measured_I=${ln.input_i}:measured_TP=${ln.input_tp}`,
      `measured_LRA=${ln.input_lra}:measured_thresh=${ln.input_thresh}`,
      `offset=${ln.target_offset}:linear=true:print_format=summary`,
    ].join(':')
      // Effects hits outrun loudnorm's peak control and the AAC encode adds intersample peaks;
      // a limiter 2 dB down keeps the true peak under -1 dBTP.
      + ',alimiter=limit=0.794:level=false';
    const p2 = spawnSync('ffmpeg', ['-i', mp4, '-af', filter, '-c:v', 'copy', '-y', normMp4], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    if (p2.status !== 0) throw new Error(`ffmpeg pass 2 exited ${p2.status}`);
    renameSync(normMp4, mp4);

    const postLufs = measureLufs(mp4);
    if (postLufs !== null) {
      const delta = Math.abs(postLufs - LUFS_TARGET);
      console.log(`[${tag}] loudness ${delta <= LUFS_TOLERANCE ? 'OK' : 'WARNING'}: ${postLufs.toFixed(1)} LUFS (Δ${delta.toFixed(1)} LU)`);
    }
  } catch (err) {
    console.warn(`[${tag}] loudness normalisation failed (non-fatal): ${err.message}`);
  }
};

const msToSrtTime = (ms) => {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const ms3 = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms3).padStart(3, '0')}`;
};

/** SRT of every caption cue, placed on the shots' frame timeline (30 fps) */
export const buildSrt = (props) => {
  const fps = 30;
  let cursor = 0;
  const lines = [];
  let idx = 1;
  for (const shot of props.shots) {
    const shotStartMs = Math.round((cursor / fps) * 1000);
    for (const cap of shot.captions) {
      lines.push(`${idx}\n${msToSrtTime(shotStartMs + cap.fromMs)} --> ${msToSrtTime(shotStartMs + cap.toMs)}\n${cap.text}\n`);
      idx++;
    }
    cursor += Math.ceil((shot.audioDurationMs / 1000) * fps);
  }
  return lines.join('\n');
};

const parseFfprobeDuration = (text) => {
  const m = text.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d{2})/);
  if (!m) return null;
  const [, h, min, s, cs] = m.map(Number);
  return (h * 3600 + min * 60 + s) * 1000 + cs * 10;
};

/** Duration in ms as ffprobe reports it, or null */
export const measureMs = (file, studioDir) => {
  const proc = spawnSync('npx', ['remotion', 'ffprobe', `"${resolve(file)}"`], {
    cwd: studioDir,
    shell: true,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return parseFfprobeDuration(`${proc.stdout}\n${proc.stderr}`);
};
