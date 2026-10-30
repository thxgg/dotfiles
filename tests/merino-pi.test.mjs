import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  loadThemeFromPath,
  setThemeJsonValidator,
} from "../common/.pi/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { validateThemeJson } from "../common/.pi/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-schema.js";

setThemeJsonValidator(validateThemeJson);
const palette = JSON.parse(readFileSync(new URL("../common/.local/share/merino/palette.json", import.meta.url)));
for (const mode of ["dark", "light"]) {
  test(`Merino ${mode} passes Pi schema and resolves its colors`, () => {
    const path = fileURLToPath(new URL(`../common/.pi/agent/themes/merino-${mode}.json`, import.meta.url));
    const theme = loadThemeFromPath(path, "truecolor");
    assert.equal(theme.name, `merino-${mode}`);
    const rgb = palette[mode].accent.slice(1).match(/../g).map((hex) => parseInt(hex, 16));
    assert.ok(theme.fg("accent", "Merino").includes(`38;2;${rgb.join(";")}`));
  });
}
