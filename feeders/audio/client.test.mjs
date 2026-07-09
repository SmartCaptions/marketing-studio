import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTtsUrl, buildMusicBody, parseFfprobeDuration, redact} from './client.mjs';

test('buildTtsUrl embeds the voice id and mp3 output format', () => {
  assert.equal(
    buildTtsUrl('21m00Tcm4TlvDq8ikWAM'),
    'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM?output_format=mp3_44100_128',
  );
});

test('buildMusicBody carries prompt, length, and the music_v2 model', () => {
  assert.deepEqual(buildMusicBody('dark pulse', 45100), {
    prompt: 'dark pulse',
    music_length_ms: 45100,
    model_id: 'music_v2',
  });
});

test('parseFfprobeDuration reads HH:MM:SS.cc into ms', () => {
  const out = 'Input #0, mp3\n  Duration: 00:00:45.12, start: 0.02, bitrate: 128 kb/s';
  assert.equal(parseFfprobeDuration(out), 45120);
  assert.equal(parseFfprobeDuration('Duration: 00:01:02.50,'), 62500);
  assert.equal(parseFfprobeDuration('no duration here'), null);
});

test('redact strips the secret from arbitrary text', () => {
  assert.equal(redact('boom sk_123 happened', 'sk_123'), 'boom <redacted> happened');
});
