/** Pure telemetry recorder; timestamps are ms relative to start(). */
export class Recorder {
  #t0 = null;
  #events = [];

  start() {
    this.#t0 = performance.now();
  }

  #now() {
    if (this.#t0 === null) throw new Error('Recorder: call start() first');
    return Math.round(performance.now() - this.#t0);
  }

  step(label) {
    this.#events.push({type: 'step', t: this.#now(), label});
  }

  /** Logs the click at the locator's center, then performs the real click. */
  async click(locator, label) {
    const box = await locator.boundingBox();
    if (!box) throw new Error('Recorder: locator has no bounding box (not visible?)');
    if (label) this.step(label);
    this.#events.push({
      type: 'click',
      t: this.#now(),
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    });
    await locator.click();
  }

  finish(viewport) {
    return {viewport, durationMs: this.#now(), events: this.#events};
  }
}
