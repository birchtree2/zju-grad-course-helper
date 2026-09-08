(() => {
  "use strict";
  const OUT = "zju-course-helper:data";
  const REFRESH = "zju-course-helper:refresh";
  const XHR = window.XMLHttpRequest;
  const nativeOpen = XHR.prototype.open;
  const nativeSend = XHR.prototype.send;
  const nativeHeader = XHR.prototype.setRequestHeader;
  const headers = new Map();
  let apiPrefix = "", selected = [], courses = [], classes = [], refreshing = false;

  const emit = detail => window.dispatchEvent(new CustomEvent(OUT, { detail }));
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
    return {
      kckId: course.kckId, courseCode: course.courseCode || item.kcbh || "",
      courseName: item.kcmc || course.courseName || "", kcbjId: item.id || raw.kcbjId,
      classCode: item.bjbh || "", selected: item.xzrs, waiting: item.hxrs, capacity: item.bjrl,
      schedule: item.sjddBz || "", statusCode: raw.xkztDm, status: raw.xkztMc || ""
    };
  }

  async function refreshAll() {
    if (refreshing) return;
    if (!courses.length) return emit({ type: "status", state: "waiting", message: "请刷新一次选课页面以读取课程" });
    if (!headers.size) return emit({ type: "status", state: "waiting", message: "等待站点登录请求完成" });
    refreshing = true;
    emit({ type: "status", state: "loading", message: `正在刷新 ${courses.length} 门课程` });
    const result = []; let failed = 0;
    for (const course of courses) {
      try { result.push(...(await apiGet("/py/pyKcbj/selectXsKxbjByKckId", { kckId: course.kckId })).map(x => normalize(x, course))); }
      catch (_) { failed += 1; }
    }
    classes = result; refreshing = false;
    emit({ type: "capacities", classes, selected, updatedAt: Date.now(), failed });
    emit({ type: "status", state: failed ? "warning" : "ready", message: failed ? `已刷新，${failed} 门课程暂未返回` : `已更新 ${classes.length} 个教学班` });
  }

  window.addEventListener(REFRESH, () => {
    emit({ type: "context", selected, courseCount: courses.length });
    if (classes.length) emit({ type: "capacities", classes, selected, updatedAt: Date.now() });
    refreshAll();
  });
  setTimeout(() => emit({ type: "status", state: "waiting", message: "等待选课数据加载" }), 800);
  setTimeout(refreshAll, 2500);
})();
