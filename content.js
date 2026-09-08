(() => {
  "use strict";

  const STORAGE_KEY = "zjuCourseHelperCacheV1";
  const state = { classes: [], selected: [], currentCourse: null, updatedAt: 0 };
  let decorateTimer = 0;

  function text(value) {
    const raw = value && typeof value === "object" && "textContent" in value
      ? value.textContent
      : value;
    return String(raw ?? "").replace(/\s+/g, " ").trim();
  }

  function makePanel() {
    if (document.getElementById("zju-helper-panel")) return;
    const panel = document.createElement("aside");
    panel.id = "zju-helper-panel";
    panel.innerHTML = `
      <div class="zju-helper-title">选课助手</div>
      <div id="zju-helper-status">正在读取课程…</div>
      <div id="zju-helper-diagnostics"></div>
      <button id="zju-helper-refresh" type="button">刷新实时人数</button>
      <details class="zju-helper-selected"><summary>已选班级人数</summary><div id="zju-helper-selected-list"></div></details>
      <div class="zju-helper-suggestion-title">推荐教学班</div>
      <div class="zju-helper-hint">时间不冲突，且同课程中录取机会更高</div>
      <div id="zju-helper-suggestions">正在计算…</div>
      <div class="zju-helper-legend">
        <span class="red">冲突</span><span class="green">不冲突</span>
        <span class="yellow">同课其他班</span><span class="blue">已选班级</span>
      </div>`;
    document.documentElement.appendChild(panel);
    panel.querySelector("#zju-helper-refresh").addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("zju-course-helper:refresh"));
    });
  }

  function setStatus(message, kind = "") {
    makePanel();
    const el = document.getElementById("zju-helper-status");
    el.textContent = message;
    el.dataset.kind = kind;
  }

  function parseSchedules(raw) {
    const source = Array.isArray(raw) ? raw.join(";") : String(raw || "");
    const results = [];
    const pattern = /(秋冬|春夏|秋|冬|春|夏)\s*\((每周|单周|双周|[^)]*)\)\s*\/\/星期([一二三四五六日天])\/\/(\d+)(?:-(\d+))?节/g;
    let match;
    while ((match = pattern.exec(source))) {
      const start = Number(match[4]);
      const end = Number(match[5] || match[4]);
      results.push({ term: match[1], weeks: match[2] || "每周", day: match[3] === "天" ? "日" : match[3], start, end });
    }
    return results;
  }

  function termOverlap(a, b) {
    return [...a].some(part => b.includes(part));
  }

  function weekOverlap(a, b) {
    if ((a === "单周" && b === "双周") || (a === "双周" && b === "单周")) return false;
    return true;
  }

  function conflicts(a, b) {
    return parseSchedules(a).some(x => parseSchedules(b).some(y =>
      x.day === y.day && termOverlap(x.term, y.term) && weekOverlap(x.weeks, y.weeks) &&
      Math.max(x.start, y.start) <= Math.min(x.end, y.end)
    ));
  }

  function enrollmentLabel(item) {
    const selected = item.selected ?? "-";
    const waiting = item.waiting ?? "-";
    const capacity = item.capacity ?? "-";
    return `${selected}/${waiting}/${capacity}`;
  }

  function clearOldMainDecorations() {
    document.querySelectorAll("td[data-zju-count], td[data-zju-options]").forEach(cell => {
      cell.removeAttribute("data-zju-count");
      cell.removeAttribute("data-zju-count-title");
      cell.removeAttribute("data-zju-options");
    });
    document.querySelectorAll('tr[data-zju-main="true"]').forEach(row => {
      row.removeAttribute("data-zju-main");
      row.removeAttribute("data-zju-state");
    });
  }

  function chance(item) {
    const chosen = Number(item.selected) || 0;
    const waiting = Number(item.waiting) || 0;
    const capacity = Number(item.capacity) || 0;
    const remaining = Math.max(capacity - chosen, 0);
    if (remaining > 0) return { score: 2 + remaining / Math.max(capacity, 1), note: `余 ${remaining} 位` };
    const pool = chosen + waiting;
    const estimate = capacity > 0 && pool > 0 ? Math.min(100, Math.round(capacity / pool * 100)) : 0;
    return { score: estimate / 100, note: waiting ? `候选 ${waiting}，估算 ${estimate}%` : "已满" };
  }

  function replaceLines(container, lines, emptyText) {
    if (!container) return;
    container.replaceChildren();
    if (!lines.length) {
      const empty = document.createElement("div");
      empty.className = "zju-helper-empty";
      empty.textContent = emptyText;
      container.appendChild(empty);
      return;
    }
    for (const line of lines) {
      const item = document.createElement("div");
      item.className = "zju-helper-line";
      item.textContent = line;
      container.appendChild(item);
    }
  }

  function renderPanelLists() {
    const byClass = new Map(state.classes.flatMap(item => [[String(item.classCode || ""), item], [String(item.kcbjId || ""), item]]));
    const selectedLines = state.selected.map(item => {
      const info = byClass.get(String(item.classCode || "")) || byClass.get(String(item.kcbjId || ""));
      return `${item.courseCode || item.courseName} · ${item.classCode || "教学班"} · ${info ? enrollmentLabel(info) : "暂无人数"}`;
    });
    replaceLines(document.getElementById("zju-helper-selected-list"), selectedLines, "暂无已选班级");

    const selectedCourseIds = new Set(state.selected.map(item => String(item.kckId)));
    const groups = new Map();
    for (const item of state.classes) {
      if (selectedCourseIds.has(String(item.kckId)) || !parseSchedules(item.schedule).length) continue;
      if (state.selected.some(chosen => conflicts(item.schedule, chosen.schedule))) continue;
      const key = String(item.kckId);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ ...item, chance: chance(item) });
    }
    const suggestions = [];
    for (const items of groups.values()) {
      items.sort((a, b) => b.chance.score - a.chance.score || (Number(b.capacity) - Number(b.selected)) - (Number(a.capacity) - Number(a.selected)));
      suggestions.push(items[0]);
    }
    suggestions.sort((a, b) => b.chance.score - a.chance.score);
    const suggestionLines = suggestions.slice(0, 8).map(item =>
      `${item.courseCode || "课程号未知"} → ${item.classCode || "教学班未知"} · ${enrollmentLabel(item)} · ${item.chance.note}`
    );
    replaceLines(document.getElementById("zju-helper-suggestions"), suggestionLines, "暂无符合条件的课程");
    return { selected: selectedLines.length, suggestions: suggestionLines.length };
  }

  function locateCapacityTables() {
    return [...document.querySelectorAll(".ant-modal .ant-table-wrapper")].filter(wrapper => {
      const head = text(wrapper.querySelector(".ant-table-thead"));
      return head.includes("已选") && head.includes("候选") && head.includes("容量");
    });
  }

  function decorateClassTables() {
    const selectedIds = new Set(state.selected.flatMap(item => [item.classCode, item.kcbjId]).filter(Boolean).map(String));
    const selectedNames = new Set(state.selected.map(item => text(item.courseName)).filter(Boolean));
    let decorated = 0;
    for (const wrapper of locateCapacityTables()) {
      const headers = [...wrapper.querySelectorAll(".ant-table-thead th")].map(th => text(th));
      const nameIndex = headers.findIndex(value => value.includes("课程名称"));
      const classIndex = headers.findIndex(value => value.includes("班级编号"));
      const timeIndex = headers.findIndex(value => value.includes("上课时间地点"));
      if (nameIndex < 0 || classIndex < 0 || timeIndex < 0) continue;
      for (const row of wrapper.querySelectorAll(".ant-table-tbody > tr")) {
        const cells = [...row.querySelectorAll(":scope > td")];
        if (!cells.length) continue;
        const courseName = text(cells[nameIndex]);
        const classId = text(cells[classIndex]);
        const schedule = text(cells[timeIndex]);
        const isSelected = selectedIds.has(classId);
        const sameCourse = selectedNames.has(courseName) && !isSelected;
        const hasConflict = state.selected.some(item => !selectedIds.has(classId) && conflicts(schedule, item.schedule));
        row.dataset.zjuState = isSelected ? "blue" : sameCourse ? "yellow" : hasConflict ? "red" : "green";
        decorated += 1;
      }
    }
    return decorated;
  }

  function decorate() {
    clearOldMainDecorations();
    const panel = renderPanelLists();
    const colors = decorateClassTables();
    const diagnostics = document.getElementById("zju-helper-diagnostics");
    if (diagnostics) diagnostics.textContent = `已选 ${panel.selected} 班 · 推荐 ${panel.suggestions} 门 · 弹窗 ${colors} 行`;
  }

  function scheduleDecorate() {
    clearTimeout(decorateTimer);
    decorateTimer = setTimeout(decorate, 120);
  }

  window.addEventListener("zju-course-helper:data", event => {
    const data = event.detail || {};
    if (data.type === "context") {
      state.selected = data.selected || [];
      state.currentCourse = data.currentCourse || null;
      scheduleDecorate();
    } else if (data.type === "capacities") {
      state.classes = data.classes || [];
      state.selected = data.selected || state.selected;
      state.updatedAt = data.updatedAt || Date.now();
      chrome.storage.local.set({ [STORAGE_KEY]: state });
      scheduleDecorate();
    } else if (data.type === "status") {
      setStatus(data.message || "", data.state || "");
    }
  });

  chrome.storage.local.get(STORAGE_KEY, saved => {
    if (saved[STORAGE_KEY]) Object.assign(state, saved[STORAGE_KEY]);
    makePanel();
    scheduleDecorate();
  });

  new MutationObserver(mutations => {
    const pageChanged = mutations.some(mutation => {
      const element = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
      return !element?.closest?.("#zju-helper-panel");
    });
    if (pageChanged) scheduleDecorate();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
