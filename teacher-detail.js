(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const teacherId = params.get("teacherId");
  const teacherName = params.get("teacherName");
  const college = params.get("college") || "";
  if (!teacherId && !teacherName) return;

  const startedAt = Date.now();
  let searchDispatched = false;
  const retry = () => {
    if (Date.now() - startedAt < 15000) setTimeout(openDetails, 250);
  };
  function openDetails() {
    if (document.getElementById("details")) return;
    const input = document.getElementById("search");
    if (!input) return retry();
    const link = [...document.querySelectorAll(".details-link")].find(item =>
      (teacherId && String(item.dataset.id) === String(teacherId)) ||
      (teacherName && item.closest(".result-item")?.textContent?.includes(teacherName))
    );
    if (link) {
      link.click();
      return;
    }
    if (!searchDispatched) {
      searchDispatched = true;
      input.value = teacherName || "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    retry();
  }
  setTimeout(openDetails, 1200);
})();
