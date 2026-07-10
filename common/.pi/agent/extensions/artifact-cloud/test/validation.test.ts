import test from "node:test";
import assert from "node:assert/strict";
import { MAX_SOURCE_BYTES, formatValidationReport, validateArtifactHtml } from "../validation.ts";

const completeDocument = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Report</title>
<style>@media print { nav { display:none } }</style></head><body><main><h1>Report</h1><img src="data:image/png;base64,AA==" alt=""><button>Copy</button></main></body></html>`;

test("accepts a self-contained semantic static document", () => {
  const report = validateArtifactHtml(completeDocument);
  assert.equal(report.valid, true);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

test("interactive mode permits declarative behaviors but not authored scripts", () => {
  const interactive = completeDocument.replace("<button>Copy</button>", `<output id="count">0</output><button data-artifact-increment="count">Increase</button>`);
  assert.equal(validateArtifactHtml(interactive, "interactive").valid, true);
  const scripted = validateArtifactHtml(interactive.replace("</body>", `<script>alert(1)</script></body>`), "interactive");
  assert.equal(scripted.valid, false);
  assert.ok(scripted.errors.some((issue) => issue.code === "scripts-disabled"));
});

test("interactive mode still rejects handlers, forms, frames, and dependencies", () => {
  const report = validateArtifactHtml(`<main><h1>x</h1><button onclick="go()" data-artifact-toggle="x">x</button><form></form><iframe></iframe><img src="asset.png" alt=""></main>`, "interactive");
  assert.equal(report.valid, false);
  assert.deepEqual(new Set(report.errors.map((issue) => issue.code)), new Set(["inline-handler", "embedded-content", "forms-disabled", "external-resource"]));
});

test("interactive mode rejects external navigation links", () => {
  const report = validateArtifactHtml(`<main><h1>x</h1><button data-artifact-toggle="x">Toggle</button><a href="https://example.com">Leave</a></main>`, "interactive");
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((issue) => issue.code === "interactive-navigation"));
});

test("rejects executable and externally loaded content", () => {
  const report = validateArtifactHtml(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unsafe</title><link rel="stylesheet" href="https://cdn.example/app.css"><style>.hero{background:url('/image.png')}</style></head><body onload="go()"><main><h1>Unsafe</h1><script src="app.js"></script><form></form><iframe src="data:text/html,x"></iframe></main></body></html>`);
  assert.equal(report.valid, false);
  assert.deepEqual(new Set(report.errors.map((issue) => issue.code)), new Set(["scripts-disabled", "inline-handler", "embedded-content", "forms-disabled", "external-resource", "external-css-resource"]));
});

test("allows fragments and data URLs but rejects local relative resources", () => {
  const html = completeDocument.replace("</main>", `<a href="#details">Details</a><video poster="data:image/png;base64,AA=="></video><img src="asset.png" alt="Local"></main>`);
  const report = validateArtifactHtml(html);
  assert.equal(report.valid, false);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0]?.code, "external-resource");
});

test("ignores disabled display-only controls", () => {
  const report = validateArtifactHtml(completeDocument.replace("</main>", `<input type="checkbox" disabled></main>`));
  assert.equal(report.warnings.some((issue) => issue.code === "control-name"), false);
});

test("warns about metadata, landmarks, accessibility, print, and motion", () => {
  const report = validateArtifactHtml(`<style>.card{transition:opacity .2s}</style><img src="data:image/png;base64,AA=="><button aria-label=""></button>`);
  assert.equal(report.valid, true);
  assert.deepEqual(new Set(report.warnings.map((issue) => issue.code)), new Set(["missing-doctype", "missing-lang", "missing-charset", "missing-viewport", "missing-title", "missing-main", "missing-h1", "image-alt", "control-name", "reduced-motion", "print-style"]));
});

test("rejects source above the publish quality limit", () => {
  const report = validateArtifactHtml("x".repeat(MAX_SOURCE_BYTES + 1));
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((issue) => issue.code === "source-too-large"));
  assert.match(formatValidationReport(report), /Validation failed/);
});
