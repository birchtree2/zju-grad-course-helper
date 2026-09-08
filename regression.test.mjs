import assert from "node:assert/strict";
import fs from "node:fs";

const content = fs.readFileSync(new URL("./content.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));

assert.equal(content.includes("cell.appendChild"), false, "must not add children inside Vue-owned table cells");
assert.match(content, /zju-helper-suggestions/, "panel includes compact teaching-class suggestions");
assert.match(content, /zju-helper-selected-list/, "selected enrollment counts remain available in the panel");
assert.doesNotMatch(css, /td\[data-zju-(count|options)\]::after/, "course overview is not decorated");
assert.match(content, /\.ant-modal \.ant-table-wrapper/, "class coloring is scoped to the Ant modal table");
assert.match(content, /"textContent" in value/, "DOM elements are read through textContent");
assert.match(content, /!element\?\.closest\?\.\("#zju-helper-panel"\)/, "panel rendering does not trigger an observer loop");
assert.equal(manifest.version, "0.2.0");

console.log("regression checks passed");
