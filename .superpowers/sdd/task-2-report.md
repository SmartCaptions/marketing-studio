# Task 2 Report: Camera Zoom Math

## What Was Implemented

Created `studio/src/lib/camera.ts` and `studio/src/lib/camera.test.ts` to implement camera zoom math for demo captures.

The implementation:
- Exports `cameraAt(clickList: ClickEvent[], tMs: number, viewport: {width; height}): {scale; originX; originY}`
- Zooms to scale 1.35 around each click during a 2900ms window (400ms lead, 500ms ease-in, 1800ms hold, 600ms ease-out)
- Uses `easeInOutCubic` from telemetry to smooth the zoom envelope
- Clamps the origin point so zoomed views never reveal out-of-bounds content
- Returns rest camera (scale 1, centered) when no click is active

All exports match the brief signature exactly.

## TDD Evidence

### RED (Failing Test)
```bash
$ npm test
FAIL  src/lib/camera.test.ts
Error: Cannot find module './camera' imported from C:/Projects/animations/studio/src/lib/camera.test.ts
```
- Expected: test suite cannot import non-existent module
- Observed: module import fails as expected

### GREEN (Passing Tests)
```bash
$ npm test
Test Files  3 passed (3)
     Tests  16 passed (16)
```
- All 16 tests pass, including 5 new camera tests:
  - `is at rest (scale 1) long before and long after a click` - PASS
  - `is fully zoomed during the hold window, centered on the click` - PASS
  - `ramps between rest and full zoom during the ease-in` - PASS
  - `clamps the origin so a corner click does not reveal out-of-bounds` - PASS
  - `returns rest camera for an empty click list` - PASS

## Files Changed

- **Created:** `studio/src/lib/camera.ts` (47 lines) - zoom math implementation
- **Created:** `studio/src/lib/camera.test.ts` (51 lines) - test suite

## Self-Review Findings

- Implementation uses exact code from brief verbatim
- Imports `ClickEvent` (type) and `easeInOutCubic` (function) from `./telemetry` as required
- Export signature matches brief specification exactly
- No em dashes in code or strings
- No extraneous changes to other files
- Smoke check passes: all compositions render
- Test suite validates all requirements:
  - Rest camera outside active windows
  - Full zoom during hold window
  - Smooth ease-in/out transitions
  - Origin clamping for corner clicks
  - Empty click list handling

## Concerns

None. All requirements met, tests pass, smoke check passes.

## Commit

```
e81d60b feat: auto-zoom camera math for demo captures
```

## Fix: clamp against interpolated scale

Fixed bug where `cameraAt` clamped the origin against the constant `ZOOM` (1.35) instead of the currently-interpolated `scale`, violating the module's contract during ease-in/ease-out.

### Changes

**studio/src/lib/camera.ts** (lines 42-43):
- Changed `clampOrigin(active.x, viewport.width, ZOOM)` → `clampOrigin(active.x, viewport.width, scale)`
- Changed `clampOrigin(active.y, viewport.height, ZOOM)` → `clampOrigin(active.y, viewport.height, scale)`

**studio/src/lib/camera.test.ts** (added test):
- Added `clamps against the current scale during ease-in, not the full zoom` test that verifies the camera origin stays within safe bounds for the interpolated scale during ease-in, not just at full zoom.

### Test Results

```bash
$ npx vitest run src/lib/camera.test.ts
Test Files  1 passed (1)
     Tests  6 passed (6)
```

All 6 tests pass, including the new covering test.
