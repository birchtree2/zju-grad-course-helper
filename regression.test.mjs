import assert from "node:assert/strict";
import fs from "node:fs";

const content = fs.readFileSync(new URL("./content.js", import.meta.url), "utf8");
const bridge = fs.readFileSync(new URL("./page-bridge.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));

assert.equal(content.includes("cell.appendChild"), false, "must not add children inside Vue-owned table cells");
assert.doesNotMatch(content, /zju-helper-(suggestions|selected-list)/, "course details are not duplicated in the side panel");
assert.match(content, /dataset\.zjuRowInfo/, "course overview rows receive inline information");
assert.match(content, /已选\/待筛选\/容量/, "waiting count is explicitly labelled as pending screening");
assert.match(content, /waiting \/ remaining/, "screening ratio uses waiting divided by capacity minus selected");
assert.match(css, /td\[data-zju-row-info\]::after/, "inline information is rendered without changing Vue-owned children");
assert.match(content, /\.ant-modal \.ant-table-wrapper/, "class coloring is scoped to the Ant modal table");
assert.match(content, /otherCourseConflict \? "red" : sameCourseConflict \? "yellow" : "green"/, "red and yellow require real schedule conflicts");
assert.match(bridge, /name\.startsWith\("未"\)\) return false;[\s\S]*return Boolean\(item\.kcbjId\)/, "unselected status overrides a stale class id");
assert.match(content, /"textContent" in value/, "DOM elements are read through textContent");
assert.match(content, /!element\?\.closest\?\.\("#zju-helper-panel"\)/, "panel rendering does not trigger an observer loop");
assert.equal(manifest.version, "0.3.1");

console.log("regression checks passed");
