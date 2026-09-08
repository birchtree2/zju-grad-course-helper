(() => {
  "use strict";

  const STORAGE_KEY = "zjuCourseHelperCacheV1";
  const state = { classes: [], selected: [], currentCourse: null, updatedAt: 0 };
  let decorateTimer = 0, refreshButtonTimer = 0;

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
      <div class="zju-helper-legend">
        <span class="red">冲突</span><span class="green">不冲突</span>
        <span class="yellow">同课冲突</span><span class="blue">已选班级</span>
      </div>
      <div class="zju-helper-ratio-legend">
        <span class="low">&lt;0.3 低报课</span><span class="easy">0.3–1</span><span class="crowded">1–1.5</span>
        <span class="hard">1.5–5</span><span class="very-hard">5–10</span><span class="extreme">≥10</span>
      </div>`;
    document.documentElement.appendChild(panel);
    panel.querySelector("#zju-helper-refresh").addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("zju-course-helper:refresh"));
    });
  }

  function setStatus(message, kind = "", cooldownUntil = 0) {
    makePanel();
    const el = document.getElementById("zju-helper-status");
    const button = document.getElementById("zju-helper-refresh");
    el.textContent = message;
    el.dataset.kind = kind;
    clearTimeout(refreshButtonTimer);
    if (!button) return;
    if (kind === "loading") {
      button.disabled = true;
      button.textContent = "正在刷新…";
      return;
    }
    if (cooldownUntil > Date.now()) {
      button.disabled = true;
      button.textContent = `冷却中（${Math.ceil((cooldownUntil - Date.now()) / 1000)} 秒）`;
      refreshButtonTimer = setTimeout(() => {
        button.disabled = false;
        button.textContent = "刷新实时人数";
      }, cooldownUntil - Date.now() + 50);
      return;
    }
    button.disabled = false;
    button.textContent = "刷新实时人数";
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
    document.querySelectorAll("td[data-zju-count], td[data-zju-options], td[data-zju-row-info], td[data-zju-ratio-label]").forEach(cell => {
      cell.removeAttribute("data-zju-count");
      cell.removeAttribute("data-zju-count-title");
      cell.removeAttribute("data-zju-options");
      cell.removeAttribute("data-zju-row-info");
      cell.removeAttribute("data-zju-row-kind");
      cell.removeAttribute("data-zju-ratio-label");
      cell.removeAttribute("data-zju-ratio-tier");
    });
    document.querySelectorAll('tr[data-zju-main="true"]').forEach(row => {
      row.removeAttribute("data-zju-main");
      row.removeAttribute("data-zju-state");
    });
  }

  function ratio(item) {
    const chosen = Number(item.selected) || 0;
    const waiting = Number(item.waiting) || 0;
    const capacity = Number(item.capacity) || 0;
    const remaining = capacity - chosen;
    if (remaining <= 0) return { value: Number.POSITIVE_INFINITY, label: waiting > 0 ? "∞ 进 1" : "无剩余名额", remaining };
    const value = waiting / remaining;
    const rounded = value >= 10 ? value.toFixed(1) : value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
    return { value, label: `${rounded} 进 1`, remaining };
  }

  function ratioTier(item) {
    const value = ratio(item).value;
    if (value < 0.3) return "low";
    if (value < 1) return "easy";
    if (value < 1.5) return "crowded";
    if (value < 5) return "hard";
    if (value < 10) return "very-hard";
    return "extreme";
  }

  function selectedRowLabel(item, showClassCode) {
    const classPart = showClassCode ? `${item.classCode || "教学班未知"}｜` : "";
    return `${classPart}已选/待筛选/容量 ${enrollmentLabel(item)}｜${ratio(item).label}`;
  }

  function recommendationRowLabel(item) {
    return `推荐班 ${item.classCode || "教学班未知"}｜已选/待筛选/容量 ${enrollmentLabel(item)}｜${ratio(item).label}`;
  }

  function decorateCourseRows() {
    const selectedIds = new Set(state.selected.flatMap(item => [item.classCode, item.kcbjId]).filter(Boolean).map(String));
    const selectedCourseIds = new Set(state.selected.map(item => String(item.kckId)));
    const groups = new Map();
    for (const item of state.classes) {
      const key = String(item.courseCode || "");
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    let selectedRows = 0, recommendedRows = 0;
    for (const row of document.querySelectorAll("tr")) {
      if (row.closest(".ant-modal")) continue;
      const cells = [...row.querySelectorAll(":scope > td")];
      const codeCell = cells.find(cell => groups.has(text(cell)));
      if (!codeCell) continue;
      const items = groups.get(text(codeCell));
      const chosen = items.filter(item => selectedIds.has(String(item.classCode)) || selectedIds.has(String(item.kcbjId)));
      if (chosen.length) {
        codeCell.dataset.zjuRowInfo = chosen.map(item => selectedRowLabel(item, chosen.length > 1)).join("\n");
        codeCell.dataset.zjuRowKind = "selected";
        codeCell.dataset.zjuRatioTier = ratioTier(chosen.reduce((worst, item) => ratio(item).value > ratio(worst).value ? item : worst));
        selectedRows += 1;
        continue;
      }
      if (selectedCourseIds.has(String(items[0]?.kckId))) continue;
      const compatible = items.filter(item =>
        parseSchedules(item.schedule).length &&
        !state.selected.some(selected => conflicts(item.schedule, selected.schedule)) &&
        ratio(item).remaining > 0
      );
      compatible.sort((a, b) => ratio(a).value - ratio(b).value || ratio(b).remaining - ratio(a).remaining);
      if (compatible.length) {
        codeCell.dataset.zjuRowInfo = `${recommendationRowLabel(compatible[0])}｜无时间冲突`;
        codeCell.dataset.zjuRowKind = "recommended";
        codeCell.dataset.zjuRatioTier = ratioTier(compatible[0]);
        recommendedRows += 1;
      }
    }
    return { selectedRows, recommendedRows };
  }

  function locateCapacityTables() {
    return [...document.querySelectorAll(".ant-modal .ant-table-wrapper")].filter(wrapper => {
      const head = text(wrapper.querySelector(".ant-table-thead"));
      return head.includes("已选") && head.includes("候选") && head.includes("容量");
    });
  }

  function decorateClassTables() {
    const selectedIds = new Set(state.selected.flatMap(item => [item.classCode, item.kcbjId]).filter(Boolean).map(String));
    const classesById = new Map();
    for (const item of state.classes) {
      if (item.classCode) classesById.set(String(item.classCode), item);
      if (item.kcbjId) classesById.set(String(item.kcbjId), item);
    }
    let decorated = 0;
    for (const wrapper of locateCapacityTables()) {
      const headers = [...wrapper.querySelectorAll(".ant-table-thead th")].map(th => text(th));
      const nameIndex = headers.findIndex(value => value.includes("课程名称"));
      const classIndex = headers.findIndex(value => value.includes("班级编号"));
      const countIndex = headers.findIndex(value => value.includes("已选") && value.includes("候选") && value.includes("容量"));
      const timeIndex = headers.findIndex(value => value.includes("上课时间地点"));
      if (nameIndex < 0 || classIndex < 0 || countIndex < 0 || timeIndex < 0) continue;
      for (const row of wrapper.querySelectorAll(".ant-table-tbody > tr")) {
        const cells = [...row.querySelectorAll(":scope > td")];
        if (!cells.length) continue;
        const courseName = text(cells[nameIndex]);
        const classId = text(cells[classIndex]);
        const schedule = text(cells[timeIndex]);
        const info = classesById.get(classId);
        if (info && cells[countIndex]) {
          cells[countIndex].dataset.zjuRatioLabel = ratio(info).label;
          cells[countIndex].dataset.zjuRatioTier = ratioTier(info);
        }
        const isSelected = selectedIds.has(classId);
        const otherCourseConflict = state.selected.some(item =>
          !selectedIds.has(classId) && text(item.courseName) !== courseName && conflicts(schedule, item.schedule)
        );
        const sameCourseConflict = state.selected.some(item =>
          !selectedIds.has(classId) && text(item.courseName) === courseName && conflicts(schedule, item.schedule)
        );
        row.dataset.zjuState = isSelected ? "blue" : otherCourseConflict ? "red" : sameCourseConflict ? "yellow" : "green";
        decorated += 1;
      }
    }
    return decorated;
  }

  function decorate() {
    clearOldMainDecorations();
    const rows = decorateCourseRows();
    const colors = decorateClassTables();
    const diagnostics = document.getElementById("zju-helper-diagnostics");
    if (diagnostics) diagnostics.textContent = `已选行 ${rows.selectedRows} · 推荐行 ${rows.recommendedRows} · 弹窗 ${colors} 行`;
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
      setStatus(data.message || "", data.state || "", Number(data.cooldownUntil) || 0);
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
