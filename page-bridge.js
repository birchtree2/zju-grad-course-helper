(() => {
  "use strict";
  const OUT = "zju-course-helper:data";
  const REFRESH = "zju-course-helper:refresh";
  const XHR = window.XMLHttpRequest;
  const nativeOpen = XHR.prototype.open;
  const nativeSend = XHR.prototype.send;
  const nativeHeader = XHR.prototype.setRequestHeader;
  const REFRESH_INTERVAL_MS = 60 * 1000;
  const CAMPUS_OPTIONS = ["紫金港", "玉泉", "西溪", "华家池", "之江", "海宁", "舟山", "工程师学院"];
  const headers = new Map();
  let apiPrefix = "", selected = [], courses = [], classes = [], refreshing = false, lastRefreshAt = 0;
  let lastStatus = { type: "status", state: "waiting", message: "等待选课数据加载" };

  const emit = detail => {
    if (detail?.type === "status") lastStatus = detail;
    window.dispatchEvent(new CustomEvent(OUT, { detail }));
  };
  const pathOf = url => { try { return new URL(url, location.href).pathname; } catch (_) { return String(url || ""); } };
  const jsonOf = xhr => { try { return xhr.response && typeof xhr.response === "object" ? xhr.response : JSON.parse(xhr.responseText); } catch (_) { return null; } };

  function rememberPrefix(url) {
    const pathname = pathOf(url), marker = pathname.indexOf("/py/");
    if (marker >= 0) apiPrefix = pathname.slice(0, marker);
  }

  function isSelected(item) {
    if (!item?.kckId) return false;
    const code = String(item.xkzt ?? item.xkztDm ?? "");
    const name = String(item.xkztMc ?? "");
    if (code === "11" || code === "16" || name.startsWith("未")) return false;
    if (name) return true;
    return Boolean(item.kcbjId);
  }

  function captureCourses(payload) {
    const result = payload?.result;
    const rows = Array.isArray(result) ? result : [...(result?.xxjhnList || []), ...(result?.xxjhwList || [])];
    const available = new Map();
    for (const item of rows.filter(item => item?.kckId)) {
      if (!available.has(String(item.kckId))) available.set(String(item.kckId), {
        kckId: item.kckId, courseCode: item.kcbh || item.kcdm || "",
        courseName: item.kcmc || "", schedule: item.sjddBz || item.sksjdd || item.sksjdds || ""
      });
    }
    courses = [...available.values()];
    const unique = new Map();
    for (const item of rows.filter(isSelected)) {
      const course = {
        kckId: item.kckId, kcbjId: item.kcbjId || null,
        courseCode: item.kcbh || item.kcdm || "", courseName: item.kcmc || "",
        classCode: item.bjbh || "", schedule: item.sjddBz || item.sksjdd || item.sksjdds || "",
        status: item.xkztMc || ""
      };
      unique.set(String(course.kcbjId || `${course.kckId}:${item.xkzy || ""}`), course);
    }
    selected = [...unique.values()];
    emit({ type: "context", selected, courseCount: courses.length });
  }

  XHR.prototype.open = function(method, url, ...rest) {
    this.__zjuMeta = { method, url, headers: new Map() };
    return nativeOpen.call(this, method, url, ...rest);
  };
  XHR.prototype.setRequestHeader = function(name, value) {
    this.__zjuMeta?.headers.set(String(name), String(value));
    return nativeHeader.call(this, name, value);
  };
  XHR.prototype.send = function(body) {
    const meta = this.__zjuMeta;
    if (meta && !this.__zjuOwn) {
      const path = pathOf(meta.url);
      if (path.includes("/py/")) {
        rememberPrefix(meta.url);
        for (const [name, value] of meta.headers) if (!/^content-(type|length)$/i.test(name)) headers.set(name, value);
      }
      if (/\/py\/pyXsxk\/(queryXsxkByXnxqXs|queryJxsXsxkByXnxqXs|queryXsKcxd)$/.test(path)) {
        this.addEventListener("load", () => { const data = jsonOf(this); if (data?.success) captureCourses(data); }, { once: true });
      }
    }
    return nativeSend.call(this, body);
  };

  const nativeFetch = window.fetch?.bind(window);
  function requestHeaders(input, init) {
    const result = new Map();
    const source = init?.headers || input?.headers;
    if (!source) return result;
    if (typeof source.forEach === "function") source.forEach((value, name) => result.set(String(name), String(value)));
    else if (Array.isArray(source)) source.forEach(([name, value]) => result.set(String(name), String(value)));
    else Object.entries(source).forEach(([name, value]) => result.set(String(name), String(value)));
    return result;
  }

  function isCourseQuery(path) {
    return /\/py\/pyXsxk\/(?:query[^/]*Xsxk|queryXsKcxd)/i.test(path);
  }

  if (nativeFetch) {
    window.fetch = function(input, init) {
      const url = typeof input === "string" ? input : input?.url;
      const path = pathOf(url);
      if (path.includes("/py/")) {
        rememberPrefix(url);
        for (const [name, value] of requestHeaders(input, init)) if (!/^content-(type|length)$/i.test(name)) headers.set(name, value);
      }
      const request = nativeFetch(input, init);
      if (!isCourseQuery(path)) return request;
      return request.then(response => {
        response.clone().json().then(data => { if (data?.success) captureCourses(data); }).catch(() => {});
        return response;
      });
    };
  }

  function apiGet(path, params) {
    return new Promise((resolve, reject) => {
      const xhr = new XHR(); xhr.__zjuOwn = true;
      nativeOpen.call(xhr, "GET", `${apiPrefix}${path}?${new URLSearchParams(params)}`, true);
      xhr.withCredentials = true; xhr.timeout = 15000;
      for (const [name, value] of headers) nativeHeader.call(xhr, name, value);
      xhr.addEventListener("load", () => {
        const data = jsonOf(xhr);
        if (xhr.status >= 200 && xhr.status < 300 && data?.success) resolve(data.result || []);
        else reject(new Error(data?.message || `HTTP ${xhr.status}`));
      }, { once: true });
      xhr.addEventListener("error", () => reject(new Error("网络请求失败")), { once: true });
      xhr.addEventListener("timeout", () => reject(new Error("接口响应超时")), { once: true });
      nativeSend.call(xhr, null);
    });
  }

  function normalize(raw, course) {
    const item = raw.pyKcbj || raw;
    const schedule = item.sjddBz || item.sksjdd || item.sksjdds || item.sjdd || course.schedule || "";
    const campusText = [schedule, item.xqmc, item.sxqmc, item.jxqmc, item.campus].filter(Boolean).join(" ");
    const campus = CAMPUS_OPTIONS.find(name => campusText.includes(name)) || "";
    return {
      kckId: course.kckId, courseCode: course.courseCode || item.kcbh || "",
      courseName: item.kcmc || course.courseName || "", kcbjId: item.id || raw.kcbjId,
      classCode: item.bjbh || "", selected: item.xzrs, waiting: item.hxrs, capacity: item.bjrl,
      teacher: item.zjjsXm || item.zjjsxm || item.jsxm || item.jsmc || item.zjjs || raw.zjjsXm || raw.zjjsxm || raw.jsxm || raw.jsmc || "",
      schedule, campus, statusCode: raw.xkztDm, status: raw.xkztMc || ""
    };
  }

  async function refreshAll() {
    if (refreshing) return;
    if (!courses.length) return emit({ type: "status", state: "waiting", message: "请刷新一次选课页面以读取课程" });
    if (!headers.size) return emit({ type: "status", state: "waiting", message: "等待站点登录请求完成" });
    const cooldownUntil = lastRefreshAt + REFRESH_INTERVAL_MS;
    if (lastRefreshAt && Date.now() < cooldownUntil) {
      const seconds = Math.ceil((cooldownUntil - Date.now()) / 1000);
      return emit({ type: "status", state: "cooldown", message: `请等待 ${seconds} 秒后再刷新`, cooldownUntil });
    }
    refreshing = true;
    lastRefreshAt = Date.now();
    emit({ type: "status", state: "loading", message: `正在刷新 ${courses.length} 门课程` });
    const selectedCourseIds = new Set(selected.map(item => String(item.kckId)).filter(Boolean));
    const priorityCourses = courses.filter(course => selectedCourseIds.has(String(course.kckId)));
    const backgroundCourses = courses.filter(course => !selectedCourseIds.has(String(course.kckId)));
    const classKey = item => `${item.kckId}:${item.classCode || item.kcbjId || item.schedule}`;
    const merge = batch => {
      const byKey = new Map(classes.map(item => [classKey(item), item]));
      for (const item of batch) byKey.set(classKey(item), item);
      classes = [...byKey.values()];
      emit({ type: "capacities", classes, selected, updatedAt: Date.now() });
    };
    const fetchCourse = async course => (await apiGet("/py/pyKcbj/selectXsKxbjByKckId", { kckId: course.kckId })).map(x => normalize(x, course));
    let failed = 0;
    await Promise.allSettled(priorityCourses.map(async course => {
      try { merge(await fetchCourse(course)); }
      catch (_) { failed += 1; }
    }));
    if (priorityCourses.length) {
      emit({ type: "status", state: "loading", message: `已更新已选课程，后台查询其余 ${backgroundCourses.length} 门课程`, cooldownUntil: lastRefreshAt + REFRESH_INTERVAL_MS });
    }
    for (const course of backgroundCourses) {
      try { merge(await fetchCourse(course)); }
      catch (_) { failed += 1; }
    }
    refreshing = false;
    emit({ type: "status", state: failed ? "warning" : "ready", message: failed ? `已刷新，${failed} 门课程暂未返回` : `已更新 ${classes.length} 个教学班`, cooldownUntil: lastRefreshAt + REFRESH_INTERVAL_MS });
  }

  window.addEventListener(REFRESH, () => {
    emit({ type: "context", selected, courseCount: courses.length });
    if (classes.length) emit({ type: "capacities", classes, selected, updatedAt: Date.now() });
    refreshAll();
  });
  window.addEventListener("zju-course-helper:ready", () => {
    emit({ type: "context", selected, courseCount: courses.length });
    if (classes.length) emit({ type: "capacities", classes, selected, updatedAt: Date.now() });
    emit(lastStatus);
  });
  setTimeout(() => emit({ type: "status", state: "waiting", message: "等待选课数据加载" }), 800);
  setTimeout(refreshAll, REFRESH_INTERVAL_MS);
})();
