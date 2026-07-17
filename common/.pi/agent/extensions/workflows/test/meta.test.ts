import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareWorkflowScript } from "../meta.ts";

test("extracts static metadata without evaluating it", () => {
  const prepared = prepareWorkflowScript(`export const meta = { name: 'review', phases: [{ title: 'Scan' }] }\nphase('Scan')\nreturn 1`);
  assert.equal(prepared.meta.name, "review");
  assert.deepEqual(prepared.meta.phases, [{ title: "Scan" }]);
  assert.match(prepared.source, /phase\('Scan'\)/);
  assert.doesNotMatch(prepared.source, /export const meta/);
});

test("rejects imports and executable metadata", () => {
  assert.throws(() => prepareWorkflowScript("import fs from 'node:fs'; return 1"), /cannot import/);
  assert.throws(() => prepareWorkflowScript("export const meta = makeMeta(); return 1"), /static literals/);
});
