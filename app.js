/* ================= FIREBASE SETUP ================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

/* =====================================================
   CONSTANTS & STATE
   ===================================================== */
const STORAGE_KEY = 'studyTrackerV2';
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

let state = {
  activeSlot:   null,      // { task, startTs, endTs, breakMs, breakStartTs, onBreak }
  history:      {},        // { "YYYY-MM-DD": [ { task, startTs, endTs, result, durationMs } ] }
  reminders:    [],        // [ { id, text, ts, triggered } ]
  todos:        [],        // [ { id, text, type, done, createdAt } ]
  streak:       0,
  bestStreak:   0,
  lastDate:     null
};

// Runtime (not persisted)
let tickInterval       = null;
let breakTickInterval  = null;
let reminderInterval   = null;
let alarmAudio         = null;
let deferredInstall    = null;
let calendarYear       = new Date().getFullYear();
let calendarMonth      = new Date().getMonth();

/* =====================================================
   UTILITY
   ===================================================== */
function today() { return fmtDate(new Date()); }
function fmtDate(d) { return d.toISOString().split('T')[0]; }
function pad(n) { return String(n).padStart(2, '0'); }
function fmtHMS(sec) {
  if (sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
function fmtMS(sec) {
  if (sec < 0) sec = 0;
  return `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
}
function fmtTimestamp(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDatetime(ts) {
  const d = new Date(ts);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function nowMs() { return Date.now(); }

/* =====================================================
   FIREBASE PERSISTENCE
   ===================================================== */
async function loadState() {
  console.log("⏳ Loading state...");
  // Try to load from LocalStorage first for instant UI
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      state = Object.assign(state, stored);
      console.log("📦 Loaded from LocalStorage (cache)");
    }
  } catch (e) {}

  // Sets up Real-time synchronization
  const docRef = doc(db, "users", USER_ID);
  onSnapshot(docRef, (docSnap) => {
    if (docSnap.exists()) {
      const remoteState = docSnap.data();
      
      // Update our local state exactly to what's in the cloud
      state = Object.assign(state, remoteState);
      
      // Ensure arrays exist for backward compatibility
      if (!state.todos) state.todos = [];
      if (!state.reminders) state.reminders = [];
      if (!state.history) state.history = {};
      
      console.log("🔥 Live data automatically synced from Firebase!");
      
      // If the UI is already initialized, dynamically pull the new changes visually
      if (document.getElementById("history-list")) {
        renderAll();
      }
    }
  }, (error) => {
    console.warn("Firebase listener error, continuing with local offline data", error);
  });
}

async function saveState() {
  // Always save to LocalStorage first
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {}

  // Then sync to Firebase
  try {
    await setDoc(doc(db, "users", USER_ID), state);
  } catch (e) {
    console.warn("Firebase save failed, data kept locally", e);
  }
}

/* =====================================================
   SOUND SYSTEM
   ===================================================== */
let globalAudioCtx = null;

function initAudio() {
  if (!globalAudioCtx) {
    try {
      globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) {}
  }
  if (globalAudioCtx && globalAudioCtx.state === 'suspended') {
    globalAudioCtx.resume();
  }
}

function createBeep() {
  if (!globalAudioCtx) return { start() {}, stop() {} };
  
  try {
    if (globalAudioCtx.state === 'suspended') globalAudioCtx.resume();
    
    function beepOnce() {
      try {
        const osc = globalAudioCtx.createOscillator();
        const gain = globalAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(globalAudioCtx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, globalAudioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, globalAudioCtx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.3, globalAudioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, globalAudioCtx.currentTime + 0.4);
        osc.start(globalAudioCtx.currentTime);
        osc.stop(globalAudioCtx.currentTime + 0.4);
      } catch(e) {}
    }
    
    let loop = null;
    return {
      start() {
        beepOnce();
        loop = setInterval(beepOnce, 1200);
        if (navigator.vibrate) navigator.vibrate([500, 300, 500, 300, 500]);
      },
      stop() { if (loop) { clearInterval(loop); loop = null; } }
    };
  } catch (e) {
    return { start() {}, stop() {} };
  }
}

function startAlarmSound() {
  stopAlarmSound();
  alarmAudio = createBeep();
  alarmAudio.start();
}
function stopAlarmSound() {
  if (alarmAudio) { alarmAudio.stop(); alarmAudio = null; }
}

/* =====================================================
   NOTIFICATIONS
   ===================================================== */
function requestNotifPermission() {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then(p => {
    if (p === 'granted') hideBanner();
  });
}

function showNotif(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body,
      icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"%3E%3Crect width="64" height="64" rx="12" fill="%23ff6b00"/%3E%3Ctext x="50%25" y="55%25" font-size="40" text-anchor="middle" dominant-baseline="middle"%3E📚%3C/text%3E%3C/svg%3E',
      badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"%3E%3Ctext y=".9em" font-size="60"%3E📚%3C/text%3E%3C/svg%3E',
      requireInteraction: true,
      vibrate: [300, 100, 300],
      tag: 'studytracker'
    });
    setTimeout(() => n.close(), 10000);
  } catch (e) {}
}

function hideBanner() { el('notif-banner').classList.add('hidden'); }
function showBanner() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') el('notif-banner').classList.remove('hidden');
}

/* =====================================================
   DOM HELPERS
   ===================================================== */
function el(id) { return document.getElementById(id); }
function toggleClass(elem, cls, force) { elem.classList.toggle(cls, force); }

/* =====================================================
   TIMER ENGINE
   ===================================================== */
function getSlotTotalMs() {
  if (!state.activeSlot) return 0;
  return state.activeSlot.endTs - state.activeSlot.startTs;
}

function getRemainingMs() {
  if (!state.activeSlot) return 0;
  const elapsed = nowMs() - state.activeSlot.startTs - (state.activeSlot.breakMs || 0);
  return Math.max(0, getSlotTotalMs() - elapsed);
}

function startTickLoop() {
  clearInterval(tickInterval);
  tickInterval = setInterval(tickTimer, 1000);
  tickTimer();
}

function stopTickLoop() { clearInterval(tickInterval); }

function tickTimer() {
  if (!state.activeSlot) { stopTickLoop(); renderTimerIdle(); return; }
  if (state.activeSlot.onBreak) return; // break tick handled separately

  const remMs = getRemainingMs();
  const remSec = Math.ceil(remMs / 1000);
  const totalSec = Math.ceil(getSlotTotalMs() / 1000);
  const elapsed = totalSec - remSec;
  const progress = totalSec > 0 ? Math.min(1, elapsed / totalSec) : 0;

  updateCountdownDisplay(remSec);
  updateProgressBar(progress);

  if (remMs <= 0) {
    stopTickLoop();
    triggerAlarm();
  }
}

function updateCountdownDisplay(remSec) {
  const h = Math.floor(remSec / 3600);
  const m = Math.floor((remSec % 3600) / 60);
  const s = remSec % 60;
  el('time-hh').textContent = pad(h);
  el('time-mm').textContent = pad(m);
  el('time-ss').textContent = pad(s);

  const display = el('countdown-display');
  display.classList.toggle('urgent', remSec <= 60 && remSec > 0);
  display.classList.toggle('warning', remSec <= 300 && remSec > 60);
}

function updateProgressBar(progress) {
  el('timer-progress-bar').style.width = ((1 - progress) * 100) + '%';
}

function renderTimerIdle() {
  el('time-hh').textContent = '--';
  el('time-mm').textContent = '--';
  el('time-ss').textContent = '--';
  el('timer-label').textContent = 'No Active Session';
  el('timer-task-display').textContent = '';
  el('timer-status-dot').className = 'timer-status-dot';
  el('timer-card').className = 'timer-card';
  el('timer-progress-bar').style.width = '100%';

  const cd = el('countdown-display');
  cd.classList.remove('urgent', 'warning');

  el('btn-take-break').classList.add('hidden');
  el('btn-end-session').classList.add('hidden');
  el('break-status').classList.add('hidden');
  unlockForm();
}

function renderTimerActive() {
  const slot = state.activeSlot;
  el('timer-label').textContent = slot.onBreak ? '☕ On Break' : '🟢 Session Active';
  el('timer-task-display').textContent = slot.task;
  el('timer-status-dot').className = 'timer-status-dot ' + (slot.onBreak ? 'break' : 'active');
  el('timer-card').className = 'timer-card ' + (slot.onBreak ? 'break-mode' : 'active-session');

  el('btn-take-break').classList.toggle('hidden', slot.onBreak);
  el('btn-end-session').classList.remove('hidden');
  lockForm();
}

/* =====================================================
   START SESSION
   ===================================================== */
function startSession() {
  const task  = el('task-name').value.trim();
  const start = el('start-time').value;
  const end   = el('end-time').value;
  const hint  = el('form-hint');

  if (!task) { hint.textContent = '⚠ Please enter a task name.'; return; }
  if (!start) { hint.textContent = '⚠ Please set a start time.'; return; }
  if (!end)   { hint.textContent = '⚠ Please set an end time.'; return; }

  const now = new Date();
  const todayPrefix = `${fmtDate(now)}T`;

  let startTs = new Date(todayPrefix + start).getTime();
  let endTs   = new Date(todayPrefix + end).getTime();

  if (endTs <= startTs) endTs += 86400000; // crosses midnight

  if (endTs <= nowMs()) {
    hint.textContent = '⚠ End time is in the past. Adjust your times.';
    return;
  }

  hint.textContent = '';

  // If start time is in the past, begin immediately
  if (startTs < nowMs()) startTs = nowMs();

  state.activeSlot = {
    id:           genId(),
    task,
    startTs,
    endTs,
    breakMs:      0,
    breakStartTs: null,
    onBreak:      false
  };
  saveState();
  renderTimerActive();
  startTickLoop();
  clearInputs();
}

function setDefaultTimes() {
  const now = new Date();
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  el('start-time').value = `${hh}:${mm}`;
  const end = new Date(now.getTime() + 3600000);
  el('end-time').value = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
}

function clearInputs() {
  el('task-name').value = '';
  setDefaultTimes();
}

function lockForm() {
  ['task-name','start-time','end-time','btn-start-session'].forEach(id => {
    const e = el(id);
    if (e) e.disabled = true;
  });
  el('slot-form-card').style.opacity = '0.5';
  el('slot-form-card').style.pointerEvents = 'none';
}

function unlockForm() {
  ['task-name','start-time','end-time','btn-start-session'].forEach(id => {
    const e = el(id);
    if (e) e.disabled = false;
  });
  el('slot-form-card').style.opacity = '';
  el('slot-form-card').style.pointerEvents = '';
}

/* =====================================================
   BREAK SYSTEM
   ===================================================== */
function openBreakModal() { el('break-modal').classList.remove('hidden'); }
function closeBreakModal() { el('break-modal').classList.add('hidden'); }

function startBreak() {
  const mins = parseInt(el('break-minutes').value) || 5;
  if (!state.activeSlot) return;
  closeBreakModal();

  state.activeSlot.onBreak = true;
  state.activeSlot.breakStartTs = nowMs();
  state.activeSlot._breakDurationMs = mins * 60000;
  saveState();

  renderTimerActive();

  // Show break countdown
  el('break-status').classList.remove('hidden');
  startBreakTick(mins * 60);
}

function startBreakTick(totalSec) {
  clearInterval(breakTickInterval);
  let remSec = totalSec;

  function tick() {
    el('break-countdown').textContent = fmtMS(remSec);
    if (remSec <= 0) {
      clearInterval(breakTickInterval);
      endBreak();
    }
    remSec--;
  }
  tick();
  breakTickInterval = setInterval(tick, 1000);
}

function endBreak() {
  if (!state.activeSlot || !state.activeSlot.onBreak) return;
  const breakDuration = nowMs() - state.activeSlot.breakStartTs;
  state.activeSlot.breakMs += breakDuration;
  state.activeSlot.breakStartTs = null;
  state.activeSlot.onBreak = false;
  saveState();

  el('break-status').classList.add('hidden');
  clearInterval(breakTickInterval);
  renderTimerActive();
  startTickLoop();
}

/* =====================================================
   END SESSION MANUALLY
   ===================================================== */
function endSessionManual() {
  if (!state.activeSlot) return;
  // Force trigger alarm (user can mark as complete or failed)
  stopTickLoop();
  clearInterval(breakTickInterval);
  triggerAlarm();
}

/* =====================================================
   ALARM & ACCOUNTABILITY
   ===================================================== */
function triggerAlarm() {
  if (!state.activeSlot) return;
  const task = state.activeSlot.task;

  startAlarmSound();
  showNotif("⏰ Time's Up!", `Did you complete: ${task}?`);

  el('alarm-task-name').textContent = task;
  el('alarm-overlay').classList.remove('hidden');
}

function resolveAlarm(completed) {
  stopAlarmSound();
  el('alarm-overlay').classList.add('hidden');

  if (!state.activeSlot) return;
  const slot = state.activeSlot;
  const todayDate = fmtDate(new Date());

  if (!state.history[todayDate]) state.history[todayDate] = [];
  state.history[todayDate].push({
    id:         slot.id,
    task:       slot.task,
    startTs:    slot.startTs,
    endTs:      slot.endTs,
    result:     completed ? 'completed' : 'failed',
    durationMs: slot.endTs - slot.startTs
  });

  state.activeSlot = null;
  updateStreak(todayDate);
  saveState();

  stopTickLoop();
  clearInterval(breakTickInterval);
  renderTimerIdle();
  renderHistory();
  renderCalendar();
  renderStats();
}

/* =====================================================
   STREAK SYSTEM
   ===================================================== */
function updateStreak(dateStr) {
  const dayHistory = state.history[dateStr] || [];
  const dayCompleted = dayHistory.some(s => s.result === 'completed');

  if (dayCompleted) {
    // Check if yesterday had a streak going
    const yesterday = fmtDate(new Date(new Date(dateStr).getTime() - 86400000));
    const prevHistory = state.history[yesterday] || [];
    const prevCompleted = prevHistory.some(s => s.result === 'completed');

    if (prevCompleted || state.lastDate === yesterday) {
      state.streak++;
    } else {
      state.streak = 1;
    }
  } else {
    state.streak = 0;
  }

  if (state.streak > state.bestStreak) state.bestStreak = state.streak;
  state.lastDate = dateStr;
  renderStreakBadge();
}

function renderStreakBadge() {
  el('streak-count').textContent = state.streak;
  el('stat-streak').textContent = state.bestStreak;
  const badge = el('streak-badge');
  badge.classList.toggle('on-fire', state.streak >= 3);
}

/* =====================================================
   HISTORY RENDER
   ===================================================== */
function renderHistory() {
  const list = el('history-list');
  const dayHistory = state.history[today()] || [];

  if (dayHistory.length === 0) {
    list.innerHTML = '<p class="empty-state">No sessions yet today. Start one above!</p>';
    return;
  }

  list.innerHTML = '';
  [...dayHistory].reverse().forEach(s => {
    const div = document.createElement('div');
    div.className = 'history-item';
    const icon = s.result === 'completed' ? '✅' : '❌';
    const badge = s.result === 'completed' ? 'completed' : 'failed';
    div.innerHTML = `
      <span class="history-status-icon">${icon}</span>
      <div class="history-info">
        <div class="history-task">${escHtml(s.task)}</div>
        <div class="history-time">${fmtTimestamp(s.startTs)} – ${fmtTimestamp(s.endTs)}</div>
      </div>
      <span class="history-badge ${badge}">${s.result}</span>
    `;
    list.appendChild(div);
  });

  // Show active slot if any
  if (state.activeSlot) {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <span class="history-status-icon">⏱</span>
      <div class="history-info">
        <div class="history-task">${escHtml(state.activeSlot.task)}</div>
        <div class="history-time">${fmtTimestamp(state.activeSlot.startTs)} – ${fmtTimestamp(state.activeSlot.endTs)}</div>
      </div>
      <span class="history-badge active">active</span>
    `;
    list.insertBefore(div, list.firstChild);
  }
}

/* =====================================================
   REMINDERS SYSTEM
   ===================================================== */
function addReminder() {
  const text = el('reminder-text').value.trim();
  const timeVal = el('reminder-time').value;

  if (!text) { alert('Please enter reminder text.'); return; }
  if (!timeVal) { alert('Please set a reminder time.'); return; }

  const ts = new Date(timeVal).getTime();
  if (ts <= nowMs()) { alert('Reminder time must be in the future.'); return; }

  state.reminders.push({ id: genId(), text, ts, triggered: false });
  saveState();
  el('reminder-text').value = '';
  el('reminder-time').value = '';
  renderReminders();
}

function deleteReminder(id) {
  state.reminders = state.reminders.filter(r => r.id !== id);
  saveState();
  renderReminders();
}

function renderReminders() {
  const list = el('reminders-list');
  const active = state.reminders.filter(r => !r.triggered).sort((a,b) => a.ts - b.ts);
  const done   = state.reminders.filter(r => r.triggered).sort((a,b) => b.ts - a.ts);
  const all = [...active, ...done];

  if (all.length === 0) {
    list.innerHTML = '<p class="empty-state">No reminders set. Add one above!</p>';
    return;
  }

  list.innerHTML = '';
  all.forEach(r => {
    const div = document.createElement('div');
    div.className = 'reminder-item' + (r.triggered ? ' triggered' : '');
    div.innerHTML = `
      <div class="reminder-info">
        <div class="reminder-text">${escHtml(r.text)}</div>
        <div class="reminder-time">🕐 ${fmtDatetime(r.ts)}${r.triggered ? ' · ✅ Triggered' : ''}</div>
      </div>
      <button class="reminder-delete" data-id="${r.id}" aria-label="Delete reminder">🗑</button>
    `;
    list.appendChild(div);
  });

  list.querySelectorAll('.reminder-delete').forEach(btn => {
    btn.addEventListener('click', e => deleteReminder(e.currentTarget.dataset.id));
  });
}

function startReminderLoop() {
  clearInterval(reminderInterval);
  reminderInterval = setInterval(checkReminders, 15000);
  checkReminders();
}

function checkReminders() {
  const now = nowMs();
  let changed = false;
  state.reminders.forEach(r => {
    if (!r.triggered && r.ts <= now) {
      r.triggered = true;
      changed = true;
      startAlarmSound();
      showNotif('📌 Reminder!', r.text);
      // auto-stop alarm after 10s for reminders
      setTimeout(stopAlarmSound, 10000);
    }
  });
  if (changed) { saveState(); renderReminders(); }
}

/* =====================================================
   TODOS / NOTES SYSTEM
   ===================================================== */
function addTodo() {
  const text = el('todo-text').value.trim();
  const type = el('todo-type').value;
  if (!text) { alert('Please enter text.'); return; }
  state.todos.push({ id: genId(), text, type, done: false, createdAt: nowMs() });
  saveState();
  el('todo-text').value = '';
  renderTodos();
}

function toggleTodo(id) {
  const todo = state.todos.find(t => t.id === id);
  if (todo) { todo.done = !todo.done; saveState(); renderTodos(); }
}

function deleteTodo(id) {
  state.todos = state.todos.filter(t => t.id !== id);
  saveState();
  renderTodos();
}

function renderTodos() {
  renderTodoGroup('daily', 'daily-todos-list', 'daily-progress', 'daily-progress-bar', 'No daily goals yet.');
  renderTodoGroup('weekly', 'weekly-todos-list', 'weekly-progress', 'weekly-progress-bar', 'No weekly goals yet.');
  renderTodoGroup('note', 'note-todos-list', 'note-progress', null, 'No notes or doubts yet.');
}

function renderTodoGroup(type, listId, chipId, barId, emptyMsg) {
  const todos = state.todos.filter(t => t.type === type);
  const list = el(listId);
  if (!list || !el(chipId)) return;
  const done = todos.filter(t => t.done).length;
  const total = todos.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  if (type === 'note') {
    el(chipId).textContent = `${total}`;
  } else {
    el(chipId).textContent = `${done}/${total}`;
    if (barId) el(barId).style.width = `${pct}%`;
  }

  if (todos.length === 0) { list.innerHTML = `<p class="empty-state">${emptyMsg}</p>`; return; }

  list.innerHTML = '';
  todos.forEach(t => {
    const div = document.createElement('div');
    div.className = 'todo-item' + (t.done ? ' done' : '');
    div.dataset.id = t.id;
    
    // Notes don't need a checkbox, just a dot or nothing
    const checkboxHtml = type === 'note' ? '<span class="todo-bullet">•</span>' : `<div class="todo-checkbox">${t.done ? '✓' : ''}</div>`;
    
    div.innerHTML = `
      ${checkboxHtml}
      <span class="todo-text">${escHtml(t.text)}</span>
      <button class="todo-delete" data-id="${t.id}" aria-label="Delete">🗑</button>
    `;
    div.addEventListener('click', e => {
      if (e.target.classList.contains('todo-delete')) return;
      toggleTodo(t.id);
    });
    div.querySelector('.todo-delete').addEventListener('click', e => {
      e.stopPropagation();
      deleteTodo(t.id);
    });
    list.appendChild(div);
  });
}

/* =====================================================
   CALENDAR
   ===================================================== */
function renderCalendar() {
  const title = el('cal-month-title');
  title.textContent = `${MONTHS[calendarMonth]} ${calendarYear}`;

  const grid = el('calendar-grid');
  grid.innerHTML = '';

  const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const daysInPrev = new Date(calendarYear, calendarMonth, 0).getDate();
  const todayStr = today();

  // Previous month trailing days
  for (let i = firstDay - 1; i >= 0; i--) {
    const day = createCalDay(daysInPrev - i, 'other-month');
    grid.appendChild(day);
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calendarYear}-${pad(calendarMonth + 1)}-${pad(d)}`;
    const sessions = state.history[dateStr] || [];
    const hasCompleted = sessions.some(s => s.result === 'completed');
    const hasFailed = sessions.some(s => s.result === 'failed');
    const isToday = dateStr === todayStr;

    const classes = [
      isToday ? 'today' : '',
      !isToday && hasCompleted ? 'completed' : '',
      !isToday && !hasCompleted && hasFailed ? 'missed' : ''
    ].filter(Boolean);

    const day = createCalDay(d, ...classes);
    grid.appendChild(day);
  }

  // Next month leading days
  const total = grid.children.length;
  const remaining = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 1; i <= remaining; i++) {
    grid.appendChild(createCalDay(i, 'other-month'));
  }
}

function createCalDay(num, ...classes) {
  const div = document.createElement('div');
  div.className = 'cal-day ' + classes.join(' ');
  div.textContent = num;
  const dot = document.createElement('div');
  dot.className = 'cal-dot';
  div.appendChild(dot);
  return div;
}

function renderStats() {
  let total = 0, completed = 0, totalMs = 0;
  Object.values(state.history).forEach(sessions => {
    sessions.forEach(s => {
      total++;
      if (s.result === 'completed') { completed++; totalMs += s.durationMs || 0; }
    });
  });
  el('stat-total').textContent = total;
  el('stat-completed').textContent = completed;
  el('stat-hours').textContent = (totalMs / 3600000).toFixed(1) + 'h';
  el('stat-streak').textContent = state.bestStreak;
}

/* =====================================================
   TABS
   ===================================================== */
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      // Update tab buttons
      document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      // Update tab content panels - remove both hidden and active, then set active on target
      document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.remove('active');
        c.classList.add('hidden');
      });
      const section = document.getElementById('tab-' + target);
      if (section) {
        section.classList.remove('hidden');
        section.classList.add('active');
      }
      if (target === 'calendar') { renderCalendar(); renderStats(); }
    });
  });
}

/* =====================================================
   EXPIRED SLOT DETECTION
   ===================================================== */
function checkExpiredSlot() {
  if (!state.activeSlot) return;
  if (state.activeSlot.onBreak) {
    // Fix up break if app was closed during break
    const breakElapsed = nowMs() - state.activeSlot.breakStartTs;
    const expected = state.activeSlot._breakDurationMs || 300000;
    if (breakElapsed >= expected) {
      endBreak();
      return;
    }
    // Resume break countdown with remaining time
    const remSec = Math.ceil((expected - breakElapsed) / 1000);
    renderTimerActive();
    el('break-status').classList.remove('hidden');
    startBreakTick(remSec);
    return;
  }

  const remMs = getRemainingMs();
  if (remMs <= 0) {
    // Slot already expired while away
    triggerAlarm();
  } else {
    renderTimerActive();
    startTickLoop();
  }
}

/* =====================================================
   PWA INSTALL
   ===================================================== */
function initPWA() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstall = e;
    el('install-btn').classList.remove('hidden');
  });

  el('install-btn').addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    if (outcome === 'accepted') el('install-btn').classList.add('hidden');
    deferredInstall = null;
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(e => console.warn('SW error', e));
  }
}

/* =====================================================
   SECURITY / XSS
   ===================================================== */
function escHtml(str) {
  if(!str) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

/* =====================================================
   EVENT LISTENERS
   ===================================================== */
function initEvents() {
  // Session
  el('btn-start-session').addEventListener('click', startSession);
  el('task-name').addEventListener('keydown', e => { if (e.key === 'Enter') startSession(); });

  // Break
  el('btn-take-break').addEventListener('click', openBreakModal);
  el('btn-cancel-break').addEventListener('click', closeBreakModal);
  el('btn-start-break').addEventListener('click', startBreak);

  // End session
  el('btn-end-session').addEventListener('click', () => {
    if (confirm('End this session now?')) endSessionManual();
  });

  // Alarm accountability
  el('btn-yes').addEventListener('click', () => resolveAlarm(true));
  el('btn-no').addEventListener('click', () => resolveAlarm(false));

  // Notifications banner
  el('btn-enable-notif').addEventListener('click', requestNotifPermission);
  el('btn-dismiss-notif').addEventListener('click', hideBanner);

  // Reminders
  el('btn-add-reminder').addEventListener('click', addReminder);
  el('reminder-text').addEventListener('keydown', e => { if (e.key === 'Enter') addReminder(); });

  // Todos
  el('btn-add-todo').addEventListener('click', addTodo);
  el('todo-text').addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });

  // Calendar nav
  el('cal-prev').addEventListener('click', () => {
    calendarMonth--;
    if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    renderCalendar();
  });
  el('cal-next').addEventListener('click', () => {
    calendarMonth++;
    if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
    renderCalendar();
  });

  // Break modal keyboard
  el('break-modal').addEventListener('keydown', e => { if (e.key === 'Escape') closeBreakModal(); });
}

function renderAll() {
  renderStreakBadge();
  renderHistory();
  renderReminders();
  renderTodos();
  renderCalendar();
  renderStats();
}

/* =====================================================
   INIT
   ===================================================== */
async function init() {
  console.log("🚀 Initializing App...");
  initTabs();
  initEvents();
  initPWA();
  setDefaultTimes();
  
  await loadState(); 
  
  renderAll();
  showBanner();
  checkExpiredSlot();
  startReminderLoop();
  
  // Unlock audio context on any user interaction
  document.addEventListener('click', initAudio, { once: true });
  document.addEventListener('touchstart', initAudio, { once: true });
  document.addEventListener('keydown', initAudio, { once: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}