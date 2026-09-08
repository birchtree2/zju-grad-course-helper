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
assert.match(content, /value < 0\.3[\s\S]*value < 1[\s\S]*value < 1\.5[\s\S]*value < 5[\s\S]*value < 10/, "screening ratio uses all requested color thresholds");
assert.match(content, /selectedRowLabel\(item, chosen\.length > 1\)/, "only multiple selected wishes show class codes");
assert.match(content, /const classPart = showClassCode \?/, "a single selected wish has no prefix or class code");
assert.doesNotMatch(content, /筛选比 \$\{ratio\(item\)\.label\}/, "displayed ratios omit the redundant label");
assert.match(content, /join\("\\n"\)/, "multiple selected wishes render on separate lines");
assert.match(content, /dataset\.zjuRatioLabel/, "modal enrollment cells receive a screening-ratio badge");
assert.match(css, /td\[data-zju-row-info\]::after/, "inline information is rendered without changing Vue-owned children");
assert.match(css, /td\[data-zju-ratio-label\]::after/, "modal ratio badge is rendered without changing Vue-owned children");
assert.match(content, /\.ant-modal \.ant-table-wrapper/, "class coloring is scoped to the Ant modal table");
assert.match(content, /otherCourseConflict \? "red" : sameCourseConflict \? "yellow" : "green"/, "red and yellow require real schedule conflicts");
assert.match(bridge, /name\.startsWith\("未"\)\) return false;[\s\S]*return Boolean\(item\.kcbjId\)/, "unselected status overrides a stale class id");
assert.match(bridge, /const REFRESH_INTERVAL_MS = 60 \* 1000/, "automatic refresh interval is one minute");
assert.match(bridge, /lastRefreshAt && Date\.now\(\) < cooldownUntil/, "manual refreshes share a cooldown window");
assert.match(content, /冷却中/, "refresh button shows a cooldown state");
assert.match(content, /"textContent" in value/, "DOM elements are read through textContent");
assert.match(content, /!element\?\.closest\?\.\("#zju-helper-panel"\)/, "panel rendering does not trigger an observer loop");
assert.doesNotMatch(css, /box-shadow: inset 4px/, "ratio text has no left-side color bar");
assert.doesNotMatch(css, /--zju-ratio-bg/, "ratio colors do not add a background");
assert.equal(manifest.version, "0.4.3");

console.log("regression checks passed");
