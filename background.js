"use strict";

const TEACHER_DATA_URL = "https://chalaoshi.netlify.app/cls/teachers.csv";

function parseCsv(csv) {
  const lines = String(csv || "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(value => value.trim());
  return lines.slice(1).map(line => {
    const values = line.split(",");
    const row = Object.fromEntries(headers.map((header, index) => [header, (values[index] || "").trim()]));
    return {
      id: row.id,
      name: row["姓名"],
      college: row["学院"],
      score: row["评分"],
      scoreCount: row["评分人数"]
    };
  }).filter(row => row.id && row.name);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "zju-course-helper:load-teachers") return undefined;
  fetch(TEACHER_DATA_URL, { cache: "no-store" })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    })
    .then(csv => sendResponse({ ok: true, teachers: parseCsv(csv) }))
    .catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
