/* ================= FIREBASE SETUP ================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBxiORJgtpxJXqNZRtYsjB6pOpYwdLnTCQ",
  authDomain: "study-tracker-2f497.firebaseapp.com",
  projectId: "study-tracker-2f497",
  storageBucket: "study-tracker-2f497.firebasestorage.app",
  messagingSenderId: "868941913957",
  appId: "1:868941913957:web:9463b90c83462639f74b8c"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// simple user id (later you can add login)
const USER_ID = "ankush";

/* ================= STATE ================= */
let state = {
  activeSlot: null,
  history: {},
  reminders: [],
  todos: [],
  streak: 0,
  bestStreak: 0,
  lastDate: null
};

/* ================= FIREBASE SAVE/LOAD ================= */

async function loadState() {
  try {
    const docRef = doc(db, "users", USER_ID);
    const snap = await getDoc(docRef);

    if (snap.exists()) {
      state = snap.data();
      console.log("🔥 Data loaded from Firebase");
    } else {
      console.log("🆕 New user");
    }
  } catch (e) {
    console.error("Load error", e);
  }
}

async function saveState() {
  try {
    await setDoc(doc(db, "users", USER_ID), state);
  } catch (e) {
    console.error("Save error", e);
  }
}

/* ================= UTILS ================= */

function nowMs() { return Date.now(); }

function fmtDate(d) {
  return d.toISOString().split("T")[0];
}

function today() {
  return fmtDate(new Date());
}

/* ================= TIMER ================= */

let tickInterval = null;

function getRemainingMs() {
  if (!state.activeSlot) return 0;
  const elapsed = nowMs() - state.activeSlot.startTs;
  return Math.max(0, (state.activeSlot.endTs - state.activeSlot.startTs) - elapsed);
}

function startTick() {
  clearInterval(tickInterval);
  tickInterval = setInterval(updateTimer, 1000);
}

function updateTimer() {
  if (!state.activeSlot) return;

  const rem = Math.floor(getRemainingMs() / 1000);

  document.getElementById("countdown-display").innerText =
    new Date(rem * 1000).toISOString().substr(11, 8);

  if (rem <= 0) {
    clearInterval(tickInterval);
    triggerAlarm();
  }
}

/* ================= START SESSION ================= */

function startSession() {
  const task = document.getElementById("task-name").value;
  const start = document.getElementById("start-time").value;
  const end = document.getElementById("end-time").value;

  if (!task || !start || !end) return;

  const now = new Date();
  const todayStr = fmtDate(now);

  const startTs = new Date(todayStr + "T" + start).getTime();
  const endTs = new Date(todayStr + "T" + end).getTime();

  state.activeSlot = {
    task,
    startTs,
    endTs
  };

  saveState();

  startTick();
}

/* ================= END SESSION ================= */

function triggerAlarm() {
  alert("Time's up! Did you finish?");
}

function endSession(completed) {
  const date = today();

  if (!state.history[date]) state.history[date] = [];

  state.history[date].push({
    task: state.activeSlot.task,
    result: completed
  });

  state.activeSlot = null;

  updateStreak(date);
  saveState();
}

/* ================= STREAK ================= */

function updateStreak(date) {
  const sessions = state.history[date] || [];
  const success = sessions.some(s => s.result);

  if (success) state.streak++;
  else state.streak = 0;

  if (state.streak > state.bestStreak) {
    state.bestStreak = state.streak;
  }
}

/* ================= INIT ================= */

async function init() {
  await loadState();

  document.getElementById("btn-start-session")
    .addEventListener("click", startSession);

  if (state.activeSlot) {
    startTick();
  }
}

init();