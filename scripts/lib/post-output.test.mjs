// node --test scripts/lib/post-output.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSrt} from './post-output.mjs';

test('captions sit on the shots\' frame timeline, each shot starting where the last one ended', () => {
  const srt = buildSrt({
    shots: [
      {audioDurationMs: 1010, captions: [{text: 'שורה ראשונה', fromMs: 0, toMs: 900}]},
      {audioDurationMs: 2000, captions: [{text: 'Second line', fromMs: 100, toMs: 1500}]},
    ],
  });
  // 1010 ms is 31 frames at 30 fps, so the second shot starts at 1033 ms
  assert.equal(
    srt,
    '1\n00:00:00,000 --> 00:00:00,900\nשורה ראשונה\n\n2\n00:00:01,133 --> 00:00:02,533\nSecond line\n',
  );
});
