#!/usr/bin/env node

import { resolve } from "node:path";
import { ArtifactStore } from "./core.mjs";

const dataDir = process.argv[2] && resolve(process.argv[2]);
if (!dataDir) {
  console.error("Usage: integrity.mjs DATA_DIR");
  process.exit(2);
}

const store = await new ArtifactStore(dataDir).open();
try {
  const report = await store.integrityReport();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  store.close();
}
