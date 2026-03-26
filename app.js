const STORAGE_KEY = "studyTrackerData";

let data = {
  slots: [],
  progress: {},
  streak: 0,
  lastDate: null
};

const form = document.getElementById("slotForm");
const timetable = document.getElementById("timetable");
const emptyState = document.getElementById("emptyState");

/* INIT */

function init() {
  loadData();
  checkNewDay();
  renderSlots();
}

function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    data = JSON.parse(saved);
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/* DATE */

function getToday() {
  return new Date().toISOString().split("T")[0];
}

function checkNewDay() {
  const today = getToday();

  if (data.lastDate !== today) {
    data.progress = {};
    data.lastDate = today;
    saveData();
  }
}

/* ADD SLOT */

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const start = document.getElementById("startTime").value;
  const end = document.getElementById("endTime").value;
  const task = document.getElementById("taskName").value;
  const type = document.querySelector("input[name='slotType']:checked").value;

  if (!start || !end || !task) return;

  const slot = {
    id: Date.now(),
    start,
    end,
    task,
    type
  };

  data.slots.push(slot);
  saveData();
  renderSlots();

  form.reset();
});

/* RENDER */

function renderSlots() {
  timetable.innerHTML = "";

  if (data.slots.length === 0) {
    emptyState.style.display = "block";
    return;
  }

  emptyState.style.display = "none";

  const sorted = [...data.slots].sort((a, b) => a.start.localeCompare(b.start));

  sorted.forEach(slot => {
    const li = document.createElement("li");

    li.innerHTML = `
      <strong>${slot.start} - ${slot.end}</strong><br>
      ${slot.task}
      <span class="badge ${slot.type}">${slot.type}</span>
    `;

    timetable.appendChild(li);
  });
}

/* START */

init();