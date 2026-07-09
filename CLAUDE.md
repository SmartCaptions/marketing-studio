# animations: agent-driven animation studio

Remotion (studio/) renders all final video. brands/<id>.json holds per-product
tokens (zod-validated via studio/src/lib/brand.ts); templates never hardcode
brand values. Feeders (Blender headless, Playwright capture, ComfyUI API) land
in feeders/ in later phases. Spec: docs/superpowers/specs/2026-07-09-animation-studio-design.md.

Rules:
- noban brand: profit = gold #d6c23c NEVER green; green = safe/simulation only.
- Rendered proof: visual work is not done until a rendered frame was inspected.
- Smoke check before claiming done: node scripts/smoke.mjs
- out/, assets/, studio/public/*/ are gitignored build products.
