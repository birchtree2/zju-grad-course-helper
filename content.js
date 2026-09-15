(() => {
  "use strict";

  const STORAGE_KEY = "zjuCourseHelperCacheV1";
  const TEACHER_CACHE_KEY = "zjuCourseHelperTeachersV1";
  const TEACHER_DATA_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
  const CAMPUS_OPTIONS = ["紫金港", "玉泉", "西溪", "华家池", "之江", "海宁", "舟山", "工程师学院"];
  const CHALAOShi_URL = "https://chalaoshi.netlify.app/";
  const state = { classes: [], selected: [], currentCourse: null, updatedAt: 0, homeCampuses: [] };
  let decorateTimer = 0, refreshButtonTimer = 0, teacherDecorateTimer = 0, teacherLinkFrame = 0, switchButtonFrame = 0, teacherLoadStarted = false, dataSeen = false, teacherRatings = [];

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
      <div class="zju-helper-header"><div class="zju-helper-title">选课助手</div><button id="zju-helper-collapse" type="button" aria-expanded="true">收起</button></div>
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
      </div>
      <details class="zju-helper-campus-settings">
        <summary>常住校区提醒（可多选）</summary>
        <div id="zju-helper-campus-options"></div>
        <div id="zju-helper-campus-warning"></div>
      </details>`;
    document.documentElement.appendChild(panel);
    panel.querySelector("#zju-helper-refresh").addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("zju-course-helper:refresh"));
    });
    panel.querySelector("#zju-helper-collapse").addEventListener("click", () => {
      const collapsed = panel.dataset.collapsed === "true";
      panel.dataset.collapsed = collapsed ? "false" : "true";
      const button = panel.querySelector("#zju-helper-collapse");
      button.textContent = collapsed ? "收起" : "展开";
      button.setAttribute("aria-expanded", String(collapsed));
    });
    renderCampusOptions();
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

  function campusFromSchedule(raw) {
    const schedule = String(raw || "");
    return CAMPUS_OPTIONS.find(name => schedule.includes(name)) || "";
  }

  function renderCampusOptions() {
    const container = document.getElementById("zju-helper-campus-options");
    if (!container) return;
    const campuses = [...new Set([...CAMPUS_OPTIONS, ...state.classes.map(item => item.campus || campusFromSchedule(item.schedule)).filter(Boolean)])];
    container.innerHTML = campuses.map(campus => `<label><input type="checkbox" value="${campus}" ${state.homeCampuses.includes(campus) ? "checked" : ""}>${campus}</label>`).join("");
    container.querySelectorAll("input").forEach(input => input.addEventListener("change", () => {
      state.homeCampuses = [...container.querySelectorAll("input:checked")].map(item => item.value);
      chrome.storage.local.set({ [STORAGE_KEY]: state });
      renderCampusWarning();
    }));
  }

  function renderCampusWarning() {
    const warning = document.getElementById("zju-helper-campus-warning");
    if (!warning) return;
    if (!state.homeCampuses.length) {
      warning.textContent = "请选择常住校区";
      warning.dataset.kind = "";
      return;
    }
    const byId = new Map();
    const byCourseId = new Map();
    for (const item of state.classes) {
      if (item.classCode) byId.set(String(item.classCode), item);
      if (item.kcbjId) byId.set(String(item.kcbjId), item);
      if (item.kckId) {
        const key = String(item.kckId);
        if (!byCourseId.has(key)) byCourseId.set(key, []);
        byCourseId.get(key).push(item);
      }
    }
    const resolveSelected = item => {
      const direct = byId.get(String(item.classCode || "")) || byId.get(String(item.kcbjId || ""));
      if (direct) return [direct];
      const courseMatches = byCourseId.get(String(item.kckId || ""));
      return courseMatches?.length ? courseMatches : [item];
    };
    const mismatches = state.selected.flatMap(resolveSelected)
      .map(item => ({ item, campus: item.campus || campusFromSchedule(item.schedule) }))
      .filter(({ campus }) => !campus || !state.homeCampuses.includes(campus));
    const uniqueMismatches = [...new Map(mismatches.map(({ item, campus }) => [
      `${item.kckId || item.courseCode || item.courseName}:${campus}`, { item, campus }
    ])).values()];
    if (!uniqueMismatches.length) {
      warning.textContent = "已选课程均在常住校区";
      warning.dataset.kind = "ok";
      return;
    }
    warning.dataset.kind = "warning";
    warning.textContent = `校区不匹配 ${uniqueMismatches.length} 门：${uniqueMismatches.map(({ item, campus }) => `${item.courseCode || item.courseName || "课程"}（${campus || "未识别"}）`).join("、")}`;
  }

  function teacherScoreClass(score) {
    const value = Number(score);
    if (!Number.isFinite(value)) return "unknown";
    if (value < 2) return "low";
    if (value >= 8.5) return "high";
    return "normal";
  }

  function decorateTeachers() {
    decorateModalTeachers();
    document.querySelectorAll("[data-zju-teacher-info]").forEach(element => {
      element.removeAttribute("data-zju-teacher-info");
      element.removeAttribute("data-zju-teacher-tier");
      element.removeAttribute("data-zju-teacher-url");
      element.removeAttribute("title");
    });
    if (!teacherRatings.length) return 0;
    let decorated = 0;
    const teachersByName = new Map();
    for (const teacher of teacherRatings) {
      if (!teacher.name) continue;
      if (!teachersByName.has(teacher.name)) teachersByName.set(teacher.name, []);
      teachersByName.get(teacher.name).push(teacher);
    }
    const detailUrl = item => {
      const url = new URL(CHALAOShi_URL);
      if (item.id) url.searchParams.set("teacherId", item.id);
      if (item.name) url.searchParams.set("teacherName", item.name);
      if (item.college) url.searchParams.set("college", item.college);
      return url.toString();
    };
    const annotate = (element, teachers) => {
      element.dataset.zjuTeacherInfo = teachers.map(item => item.score || "暂无评分").join(" / ");
      element.dataset.zjuTeacherTier = teachers.reduce((tier, item) => teacherScoreClass(item.score) === "high" ? "high" : tier, teacherScoreClass(teachers[0].score));
      element.dataset.zjuTeacherUrl = detailUrl(teachers[0]);
      element.title = teachers.map(item => `评分：${item.score || "暂无评分"}（${item.scoreCount || 0}人评价）`).join("；");
      return 1;
    };
    for (const anchor of document.querySelectorAll("a")) {
      if (anchor.closest("#zju-helper-panel, #zju-helper-switch-modal")) continue;
      const teachers = teachersByName.get(text(anchor));
      if (teachers?.length) decorated += annotate(anchor, teachers);
    }
    for (const cell of document.querySelectorAll("td")) {
      if (cell.closest("#zju-helper-panel, #zju-helper-switch-modal") || cell.querySelector("[data-zju-teacher-info]")) continue;
      const teachers = [...new Map(text(cell).split(/[\s/、,，;；]+/).flatMap(name => teachersByName.get(name) || []).map(item => [item.id, item])).values()];
      if (teachers.length && text(cell).length < 100) decorated += annotate(cell, teachers);
    }
    return decorated;
  }

  function decorateModalTeachers() {
    for (const cell of document.querySelectorAll('#zju-helper-switch-modal [data-teacher-name]')) {
      cell.querySelectorAll('.zju-helper-modal-rating').forEach(link => link.remove());
      const names = cell.dataset.teacherName.split(/[\s/、,，;；]+/);
      for (const teacher of teacherRatings.filter(item => names.includes(item.name))) {
        const link = document.createElement('a');
        const url = new URL(CHALAOShi_URL);
        if (teacher.id) url.searchParams.set('teacherId', teacher.id);
        url.searchParams.set('teacherName', teacher.name);
        if (teacher.college) url.searchParams.set('college', teacher.college);
        link.href = url.toString();
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'zju-helper-modal-rating';
        link.dataset.tier = teacherScoreClass(teacher.score);
        link.textContent = teacher.score || '暂无评分';
        link.title = `${teacher.name}（${teacher.scoreCount || 0}人评价）`;
        cell.append(link);
      }
    }
  }

  function teacherScoreRect(element) {
      const range = document.createRange();
      range.selectNodeContents(element);
      const textRects = [...range.getClientRects()];
      const rect = textRects[textRects.length - 1] || element.getBoundingClientRect();
      const style = getComputedStyle(element, "::after");
      const fontSize = Number.parseFloat(style.fontSize) || 11;
      const scoreWidth = Math.max(28, (element.dataset.zjuTeacherInfo || "").length * fontSize * 0.62 + 12);
      const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.4;
    return { left: rect.right + 2, top: rect.top, width: scoreWidth + 8, height: Math.max(rect.height, lineHeight) };
  }

  function renderTeacherLinkHitboxes() {
    let layer = document.getElementById("zju-helper-teacher-links");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "zju-helper-teacher-links";
      document.documentElement.appendChild(layer);
    }
    const fragment = document.createDocumentFragment();
    for (const element of document.querySelectorAll("[data-zju-teacher-url]")) {
      if (!element.isConnected || element.closest("#zju-helper-panel")) continue;
      const url = element.dataset.zjuTeacherUrl;
      const marker = teacherScoreRect(element);
      if (!url || marker.width <= 0 || marker.height <= 0 || marker.left > innerWidth || marker.top > innerHeight || marker.left + marker.width < 0 || marker.top + marker.height < 0) continue;
      const link = document.createElement("a");
      link.className = "zju-helper-teacher-link";
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", `查看${text(element)}的查老师评分详情`);
      link.style.left = `${marker.left}px`;
      link.style.top = `${marker.top}px`;
      link.style.width = `${marker.width}px`;
      link.style.height = `${marker.height}px`;
      fragment.appendChild(link);
    }
    layer.replaceChildren(fragment);
  }

  function scheduleTeacherLinkHitboxes() {
    cancelAnimationFrame(teacherLinkFrame);
    teacherLinkFrame = requestAnimationFrame(renderTeacherLinkHitboxes);
  }

  function scheduleTeacherDecorate() {
    clearTimeout(teacherDecorateTimer);
    teacherDecorateTimer = setTimeout(() => {
      decorateTeachers();
      scheduleTeacherLinkHitboxes();
    }, 0);
  }

  function selectedClassIds() {
    return new Set(state.selected.flatMap(item => [item.classCode, item.kcbjId]).filter(Boolean).map(String));
  }

  function classConflictState(item, selectedIds) {
    const isSelected = selectedIds.has(String(item.classCode)) || selectedIds.has(String(item.kcbjId));
    if (isSelected) return "blue";
    const otherCourseConflict = state.selected.some(selected =>
      text(selected.courseName) !== text(item.courseName) && conflicts(item.schedule, selected.schedule)
    );
    if (otherCourseConflict) return "red";
    const sameCourseConflict = state.selected.some(selected =>
      text(selected.courseName) === text(item.courseName) && conflicts(item.schedule, selected.schedule)
    );
    return sameCourseConflict ? "yellow" : "green";
  }

  function classConflictLabel(item, status) {
    if (status === "blue") return "已选班级";
    if (status === "red") return "与其他已选课冲突";
    if (status === "yellow") return "与同课已选班冲突";
    return parseSchedules(item.schedule).length ? "不冲突" : "时间未识别";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[character]));
  }

  function closeClassSwitchModal() {
    document.getElementById("zju-helper-switch-modal")?.remove();
  }

  function openClassSwitchModal(courseCode, refresh = false) {
    const oldScroll = document.querySelector('#zju-helper-switch-modal .zju-helper-switch-table-wrap')?.scrollTop || 0;
    closeClassSwitchModal();
    const items = state.classes.filter(item => String(item.courseCode) === String(courseCode));
    const modal = document.createElement("div");
    modal.id = "zju-helper-switch-modal";
    modal.dataset.courseCode = courseCode;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const courseName = items[0]?.courseName || courseCode || "课程";
    modal.innerHTML = `
      <div class="zju-helper-switch-dialog">
        <div class="zju-helper-switch-header">
          <div><div class="zju-helper-switch-title">${escapeHtml(courseName)} · 教学班情况</div><div class="zju-helper-switch-note">仅查看，不会提交选退课；换班请按学校系统流程操作。</div></div>
          <button class="zju-helper-switch-close" type="button" aria-label="关闭">×</button>
        </div>
        <div class="zju-helper-switch-legend"><span class="blue">已选班级</span><span class="green">不冲突</span><span class="yellow">同课冲突</span><span class="red">其他课程冲突</span></div>
        <div class="zju-helper-switch-table-wrap"><table class="zju-helper-switch-table"><thead><tr><th>班级编号</th><th>主讲教师</th><th>已选/待筛选/容量</th><th>上课时间地点</th><th>状态</th></tr></thead><tbody></tbody></table></div>
      </div>`;
    const dialog = modal.querySelector(".zju-helper-switch-dialog");
    modal.addEventListener("click", event => { if (event.target === modal) closeClassSwitchModal(); });
    modal.querySelector(".zju-helper-switch-close").addEventListener("click", closeClassSwitchModal);
    const body = modal.querySelector("tbody");
    const selectedIds = selectedClassIds();
    if (!items.length) {
      body.innerHTML = `<tr><td colspan="5" class="zju-helper-switch-empty">暂无该课程的教学班数据，请先刷新实时人数。</td></tr>`;
    } else {
      for (const item of items) {
        const status = classConflictState(item, selectedIds);
        const row = document.createElement("tr");
        row.dataset.zjuState = status;
        const values = [item.classCode || "教学班未知", typeof item.teacher === 'string' && item.teacher ? item.teacher : "教师信息未返回", enrollmentLabel(item), item.schedule || "-", classConflictLabel(item, status)];
        values.forEach((value, index) => {
          const cell = document.createElement("td");
          cell.textContent = value;
          if (index === 1) cell.dataset.teacherName = typeof item.teacher === 'string' ? item.teacher : '';
          if (index === 2) {
            cell.dataset.zjuRatioTier = ratioTier(item);
            cell.dataset.zjuRatioLabel = ratio(item).label;
          }
          row.appendChild(cell);
        });
        body.appendChild(row);
      }
    }
    document.documentElement.appendChild(modal);
    scheduleTeacherDecorate();
    modal.querySelector('.zju-helper-switch-table-wrap').scrollTop = oldScroll;
    if (!refresh) dialog.querySelector(".zju-helper-switch-close")?.focus();
  }

  function renderCourseSwitchButtons() {
    let layer = document.getElementById("zju-helper-switch-links");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "zju-helper-switch-links";
      document.documentElement.appendChild(layer);
    }
    const fragment = document.createDocumentFragment();
    if (document.getElementById('zju-helper-switch-modal') || document.querySelector('.ant-modal')) {
      layer.replaceChildren(fragment);
      return;
    }
    for (const cell of document.querySelectorAll("td[data-zju-switch-course]")) {
      if (!cell.isConnected) continue;
      const rect = cell.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > innerHeight) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "zju-helper-switch-button";
      button.textContent = "查看其他班";
      button.setAttribute("aria-label", `查看${cell.dataset.zjuSwitchCourse}的其他教学班`);
      button.style.left = `${Math.max(4, rect.left + 6)}px`;
      button.style.top = `${Math.max(4, rect.bottom - 28)}px`;
      button.addEventListener("click", () => openClassSwitchModal(cell.dataset.zjuSwitchCourse));
      fragment.appendChild(button);
    }
    layer.replaceChildren(fragment);
  }

  function scheduleCourseSwitchButtons() {
    cancelAnimationFrame(switchButtonFrame);
    switchButtonFrame = requestAnimationFrame(renderCourseSwitchButtons);
  }

  function loadTeacherRatings() {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.local.get(TEACHER_CACHE_KEY, saved => {
      const cached = saved?.[TEACHER_CACHE_KEY];
      if (cached?.fetchedAt && Date.now() - cached.fetchedAt < TEACHER_DATA_MAX_AGE && Array.isArray(cached.teachers)) {
        teacherRatings = cached.teachers;
        scheduleDecorate();
        return;
      }
      if (!chrome.runtime?.sendMessage) return;
      chrome.runtime.sendMessage({ type: "zju-course-helper:load-teachers" }, response => {
        if (chrome.runtime.lastError || !response?.ok) return;
        teacherRatings = response.teachers || [];
        chrome.storage.local.set({ [TEACHER_CACHE_KEY]: { fetchedAt: Date.now(), teachers: teacherRatings } });
        scheduleDecorate();
      });
    });
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
      if (cell.closest('#zju-helper-switch-modal')) return;
      cell.removeAttribute("data-zju-count");
      cell.removeAttribute("data-zju-count-title");
      cell.removeAttribute("data-zju-options");
      cell.removeAttribute("data-zju-row-info");
      cell.removeAttribute("data-zju-row-kind");
      cell.removeAttribute("data-zju-switch-course");
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
    const selectedIds = selectedClassIds();
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
      if (row.closest(".ant-modal, #zju-helper-switch-modal")) continue;
      const cells = [...row.querySelectorAll(":scope > td")];
      const codeCell = cells.find(cell => groups.has(text(cell)));
      if (!codeCell) continue;
      const items = groups.get(text(codeCell));
      const chosen = items.filter(item => selectedIds.has(String(item.classCode)) || selectedIds.has(String(item.kcbjId)));
      if (chosen.length) {
        codeCell.dataset.zjuRowInfo = chosen.map(item => selectedRowLabel(item, chosen.length > 1)).join("\n");
        codeCell.dataset.zjuRowKind = "selected";
        codeCell.dataset.zjuRatioTier = ratioTier(chosen.reduce((worst, item) => ratio(item).value > ratio(worst).value ? item : worst));
        if (items.length > chosen.length) codeCell.dataset.zjuSwitchCourse = text(codeCell);
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
    scheduleCourseSwitchButtons();
    renderCampusOptions();
    renderCampusWarning();
    const diagnostics = document.getElementById("zju-helper-diagnostics");
    if (diagnostics) diagnostics.textContent = `已选行 ${rows.selectedRows} · 推荐行 ${rows.recommendedRows} · 弹窗 ${colors} 行 · 教师评分 ${teacherRatings.length ? "已加载" : "加载中"}`;
    scheduleTeacherDecorate();
    if (!teacherLoadStarted) {
      teacherLoadStarted = true;
      setTimeout(loadTeacherRatings, 0);
    }
  }

  function scheduleDecorate() {
    if (decorateTimer) return;
    decorateTimer = setTimeout(() => { decorateTimer = 0; decorate(); }, 220);
  }

  window.addEventListener("zju-course-helper:data", event => {
    const data = event.detail || {};
    if (data.type === "context") {
      dataSeen = true;
      state.selected = data.selected || [];
      state.currentCourse = data.currentCourse || null;
      scheduleDecorate();
    } else if (data.type === "capacities") {
      dataSeen = true;
      state.classes = data.classes || [];
      state.selected = data.selected || state.selected;
      state.updatedAt = data.updatedAt || Date.now();
      chrome.storage.local.set({ [STORAGE_KEY]: state });
      scheduleDecorate();
    } else if (data.type === "status") {
      setStatus(data.message || "", data.state || "", Number(data.cooldownUntil) || 0);
    }
    if (data.type === 'context' || data.type === 'capacities') {
      const modal = document.getElementById('zju-helper-switch-modal');
      if (modal) openClassSwitchModal(modal.dataset.courseCode, true);
    }
  });

  chrome.storage.local.get(STORAGE_KEY, saved => {
    if (saved[STORAGE_KEY]) Object.assign(state, saved[STORAGE_KEY]);
    makePanel();
    scheduleDecorate();
    window.dispatchEvent(new CustomEvent("zju-course-helper:ready"));
    setTimeout(() => {
      if (!dataSeen && document.getElementById("zju-helper-status")?.textContent === "正在读取课程…") {
        setStatus("未捕获选课数据，请刷新当前页面", "waiting");
      }
    }, 4000);
  });

  document.addEventListener("scroll", scheduleTeacherLinkHitboxes, { capture: true, passive: true });
  document.addEventListener("scroll", scheduleCourseSwitchButtons, { capture: true, passive: true });
  window.addEventListener("resize", scheduleTeacherLinkHitboxes, { passive: true });
  window.addEventListener("resize", scheduleCourseSwitchButtons, { passive: true });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeClassSwitchModal();
  });

  new MutationObserver(mutations => {
    const relevantNode = node => {
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      if (node.id?.startsWith('zju-helper-')) return false;
      return node.matches("tr, td, tbody, table, .ant-modal, .ant-table-wrapper")
        || Boolean(node.querySelector?.("tr, td, tbody, table, .ant-modal, .ant-table-wrapper"));
    };
    const pageChanged = mutations.some(mutation => {
      const element = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
      if (!element || element.closest?.("#zju-helper-panel, #zju-helper-teacher-links, #zju-helper-switch-links, #zju-helper-switch-modal")) return false;
      if (element.closest?.("table, .ant-modal, .ant-table-wrapper")) return true;
      return [...mutation.addedNodes, ...mutation.removedNodes].some(relevantNode);
    });
    if (pageChanged) scheduleDecorate();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
