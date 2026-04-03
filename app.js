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

import { enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
try {
  enableIndexedDbPersistence(db).catch(() => {});
} catch (e) { }

const USER_ID = "ankush";

/* =====================================================
   CONSTANTS & STATE
   ===================================================== */
const STORAGE_KEY = 'studyTrackerV2';
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

let state = {
  activeSlot: null,
  sessionQueue: [],
  history: {},
  reminders: [],
  todos: [],
  streak: 0,
  bestStreak: 0,
  lastDate: null,
  customRingtone: null,
  journeys: {}
};

let tickInterval = null;
let breakTickInterval = null;
let reminderInterval = null;
let reminderCountdownInterval = null;
let alarmAudio = null;
let customRingtoneAudio = null;
let deferredInstall = null;
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth();
let currentTabIndex = 0;

/* =====================================================
   UTILITY
   ===================================================== */
function today() { return fmtDate(new Date()); }
function fmtDate(d) { return d.toISOString().split('T')[0]; }
function pad(n) { return String(n).padStart(2, '0'); }
function fmtHMS(sec) {
  if (sec < 0) sec = 0;
  return `${pad(Math.floor(sec/3600))}:${pad(Math.floor((sec%3600)/60))}:${pad(sec%60)}`;
}
function fmtMS(sec) {
  if (sec < 0) sec = 0;
  return `${pad(Math.floor(sec/60))}:${pad(sec%60)}`;
}
function fmtTimestamp(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function fmtDatetime(ts) { return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function nowMs() { return Date.now(); }
function el(id) { return document.getElementById(id); }
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

/* =====================================================
   FIREBASE PERSISTENCE
   ===================================================== */
async function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { state = Object.assign(state, JSON.parse(raw)); }
  } catch (e) { }

  // Migrate: ensure sessionQueue exists
  if (!state.sessionQueue) state.sessionQueue = [];
  
  if (state.journey && state.journey.startDate) {
    if (!state.journeys) state.journeys = {};
    const jid = 'legacy_journey';
    if (!state.journeys[jid]) {
      state.journeys[jid] = { id: jid, name: 'My First Journey', emoji: '📖', startDate: state.journey.startDate, entries: state.journey.entries || {} };
    }
    delete state.journey;
  }

  const docRef = doc(db, "users", USER_ID);
  onSnapshot(docRef, (docSnap) => {
    if (docSnap.exists()) {
      const remoteState = docSnap.data();
      const localSlot = state.activeSlot;
      const localTime = state.lastUpdated || 0;
      const remoteTime = remoteState.lastUpdated || 0;

      if (localTime > remoteTime) {
        setTimeout(saveState, 500);
        return;
      }

      state.history = remoteState.history || {};
      state.todos = remoteState.todos || [];
      state.reminders = remoteState.reminders || [];
      state.sessionQueue = remoteState.sessionQueue || [];
      state.streak = remoteState.streak || 0;
      state.bestStreak = remoteState.bestStreak || 0;
      state.lastDate = remoteState.lastDate || null;
      state.customRingtone = remoteState.customRingtone || null;
      state.journeys = remoteState.journeys || {};
      
      if (remoteState.journey && remoteState.journey.startDate) {
        const jid = 'legacy_journey';
        if (!state.journeys[jid]) {
          state.journeys[jid] = { id: jid, name: 'My First Journey', emoji: '📖', startDate: remoteState.journey.startDate, entries: remoteState.journey.entries || {} };
        }
      }
      if (state.journey) delete state.journey;
      
      state.lastUpdated = remoteTime;

      if (localSlot && !remoteState.activeSlot) {
        state.activeSlot = localSlot;
        setTimeout(saveState, 500);
      } else {
        state.activeSlot = remoteState.activeSlot || null;
      }

      if (state.activeSlot && !tickInterval) {
        startTickLoop();
        renderTimerActive();
      }
      if (document.getElementById("home-history-list")) renderAll();
    } else {
      saveState();
    }
  }, () => {});
}

async function saveState() {
  state.lastUpdated = Date.now();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { }
  try { await setDoc(doc(db, "users", USER_ID), state); } catch (e) { }
}

/* =====================================================
   SOUND SYSTEM
   ===================================================== */
let globalAudioCtx = null;

function initAudio() {
  if (!globalAudioCtx) {
    try { globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { }
  }
  if (globalAudioCtx && globalAudioCtx.state === 'suspended') globalAudioCtx.resume();
}

function createBeep() {
  if (!globalAudioCtx) return { start(){}, stop(){} };
  try {
    if (globalAudioCtx.state === 'suspended') globalAudioCtx.resume();
    function beepOnce() {
      try {
        const osc = globalAudioCtx.createOscillator();
        const gain = globalAudioCtx.createGain();
        osc.connect(gain); gain.connect(globalAudioCtx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, globalAudioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, globalAudioCtx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.3, globalAudioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, globalAudioCtx.currentTime + 0.4);
        osc.start(globalAudioCtx.currentTime);
        osc.stop(globalAudioCtx.currentTime + 0.4);
      } catch (e) { }
    }
    let loop = null;
    return {
      start() { beepOnce(); loop = setInterval(beepOnce, 1200); if (navigator.vibrate) navigator.vibrate([500,300,500,300,500]); },
      stop() { if (loop) { clearInterval(loop); loop = null; } }
    };
  } catch (e) { return { start(){}, stop(){} }; }
}

function startAlarmSound() {
  stopAlarmSound();
  // Try custom ringtone first
  if (state.customRingtone) {
    try {
      customRingtoneAudio = new Audio(state.customRingtone);
      customRingtoneAudio.loop = true;
      customRingtoneAudio.play().catch(() => {});
    } catch(e) {}
  }
  alarmAudio = createBeep();
  if (!customRingtoneAudio) alarmAudio.start();
  if (navigator.vibrate) navigator.vibrate([500,300,500,300,500]);
  // MediaSession API
  setupMediaSession();
}

function stopAlarmSound() {
  if (alarmAudio) { alarmAudio.stop(); alarmAudio = null; }
  if (customRingtoneAudio) { customRingtoneAudio.pause(); customRingtoneAudio.currentTime = 0; customRingtoneAudio = null; }
}

function setupMediaSession() {
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "StudyTracker Alarm",
        artist: "Time's Up!",
        album: "StudyTracker"
      });
      navigator.mediaSession.setActionHandler('pause', () => { stopAlarmSound(); });
      navigator.mediaSession.setActionHandler('stop', () => { stopAlarmSound(); });
    } catch(e) {}
  }
}

/* =====================================================
   NOTIFICATIONS
   ===================================================== */
function requestNotifPermission() {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then(p => { if (p === 'granted') hideBanner(); });
}
function showNotif(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, requireInteraction: true, vibrate: [300,100,300], tag: 'studytracker' });
    setTimeout(() => n.close(), 10000);
  } catch (e) { }
}
function hideBanner() { el('notif-banner').classList.add('hidden'); }
function showBanner() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') el('notif-banner').classList.remove('hidden');
}

/* =====================================================
   TAB NAVIGATION (slide system)
   ===================================================== */
function initTabs() {
  const btns = document.querySelectorAll('.bnav-item');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      switchTab(idx);
    });
  });
}

function switchTab(newIndex) {
  if (newIndex === currentTabIndex) return;
  const panels = document.querySelectorAll('.tab-panel');
  const btns = document.querySelectorAll('.bnav-item');
  const goingRight = newIndex > currentTabIndex;

  // Deactivate current
  panels.forEach(p => {
    p.classList.remove('active','slide-out-left','slide-out-right');
    const i = parseInt(p.dataset.index);
    if (i < newIndex) p.style.transform = 'translateX(-60%)';
    else if (i > newIndex) p.style.transform = 'translateX(100%)';
  });

  // Activate new
  const newPanel = document.querySelector(`[data-index="${newIndex}"]`);
  if (newPanel) {
    newPanel.style.transform = '';
    newPanel.classList.add('active');
  }

  btns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
  btns[newIndex].classList.add('active');
  btns[newIndex].setAttribute('aria-selected','true');

  currentTabIndex = newIndex;

  // Refresh relevant tab data
  if (newIndex === 0) renderHome();
  if (newIndex === 1) { renderCalendar(); renderStats(); }
  if (newIndex === 2) renderSessionQueue();
  if (newIndex === 3) { renderTodos(); renderReminders(); }
  if (newIndex === 4) { renderJourney(); }
}

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
function stopTickLoop() { clearInterval(tickInterval); tickInterval = null; }

function tickTimer() {
  if (!state.activeSlot) { stopTickLoop(); renderTimerIdle(); return; }
  if (state.activeSlot.onBreak) return;
  const remMs = getRemainingMs();
  const remSec = Math.ceil(remMs / 1000);
  const totalSec = Math.ceil(getSlotTotalMs() / 1000);
  const elapsed = totalSec - remSec;
  const progress = totalSec > 0 ? Math.min(1, elapsed / totalSec) : 0;

  updateCountdownDisplay(remSec);
  updateProgressBar(progress);
  updateHomeActiveCard(remSec, progress);

  if (remMs <= 0) { stopTickLoop(); triggerAlarm(); }
}

function updateCountdownDisplay(remSec) {
  const h = Math.floor(remSec/3600), m = Math.floor((remSec%3600)/60), s = remSec%60;
  el('time-hh').textContent = pad(h);
  el('time-mm').textContent = pad(m);
  el('time-ss').textContent = pad(s);
  const d = el('countdown-display');
  d.classList.toggle('urgent', remSec <= 60 && remSec > 0);
  d.classList.toggle('warning', remSec <= 300 && remSec > 60);
}
function updateProgressBar(progress) {
  el('timer-progress-bar').style.width = ((1-progress)*100) + '%';
}
function updateHomeActiveCard(remSec, progress) {
  const card = el('home-active-card');
  if (!card || !state.activeSlot) return;
  card.classList.remove('hidden');
  el('hac-task').textContent = state.activeSlot.task;
  el('hac-countdown').textContent = fmtHMS(remSec);
  el('hac-progress-bar').style.width = ((1-progress)*100) + '%';
  el('hac-status').textContent = state.activeSlot.onBreak ? '☕ On Break' : 'Session Active';

  // Show up-next if queue has items
  const nextEl = el('hac-next');
  if (state.sessionQueue.length > 0) {
    nextEl.classList.remove('hidden');
    el('hac-next-name').textContent = state.sessionQueue[0].task;
    el('hac-next-time').textContent = fmtTimestamp(state.sessionQueue[0].startTs);
  } else {
    nextEl.classList.add('hidden');
  }

  el('home-next-card').classList.add('hidden');
}

function renderTimerIdle() {
  el('time-hh').textContent = '--'; el('time-mm').textContent = '--'; el('time-ss').textContent = '--';
  el('timer-label').textContent = 'No Active Session';
  el('timer-task-display').textContent = '';
  el('timer-status-dot').className = 'timer-status-dot';
  el('timer-card').className = 'timer-card';
  el('timer-progress-bar').style.width = '100%';
  el('countdown-display').classList.remove('urgent','warning');
  el('btn-take-break').classList.add('hidden');
  el('btn-end-session').classList.add('hidden');
  el('break-status').classList.add('hidden');
  el('timer-up-next').classList.add('hidden');

  // Home cards
  el('home-active-card').classList.add('hidden');
  if (state.sessionQueue.length > 0) {
    el('home-next-card').classList.remove('hidden');
    el('hnc-task').textContent = state.sessionQueue[0].task;
    el('hnc-time').textContent = fmtTimestamp(state.sessionQueue[0].startTs) + ' – ' + fmtTimestamp(state.sessionQueue[0].endTs);
  } else {
    el('home-next-card').classList.add('hidden');
  }

  renderTimerUpNext();
}

function renderTimerActive() {
  const slot = state.activeSlot;
  if (!slot) return;
  el('timer-label').textContent = slot.onBreak ? '☕ On Break' : '🟢 Session Active';
  el('timer-task-display').textContent = slot.task;
  el('timer-status-dot').className = 'timer-status-dot ' + (slot.onBreak ? 'break' : 'active');
  el('timer-card').className = 'timer-card ' + (slot.onBreak ? 'break-mode' : 'active-session');
  el('btn-take-break').classList.toggle('hidden', slot.onBreak);
  el('btn-end-session').classList.remove('hidden');
  renderTimerUpNext();
}

function renderTimerUpNext() {
  const upNext = el('timer-up-next');
  if (state.sessionQueue.length > 0 && state.activeSlot) {
    upNext.classList.remove('hidden');
    el('tun-task').textContent = state.sessionQueue[0].task;
    el('tun-time').textContent = 'at ' + fmtTimestamp(state.sessionQueue[0].startTs);
  } else {
    upNext.classList.add('hidden');
  }
}

/* =====================================================
   SESSION QUEUE & START
   ===================================================== */
function addToQueue(task, startTs, endTs) {
  state.sessionQueue.push({ id: genId(), task, startTs, endTs });
  state.sessionQueue.sort((a,b) => a.startTs - b.startTs);
  saveState();

  // If no active session, start first in queue if time is right
  if (!state.activeSlot) startNextFromQueue();
  renderSessionQueue();
  renderTimerIdle();
  renderHome();
}

function startNextFromQueue() {
  if (state.activeSlot || state.sessionQueue.length === 0) return;
  const next = state.sessionQueue.shift();
  // Adjust startTs if in the past
  let startTs = next.startTs < nowMs() ? nowMs() : next.startTs;
  state.activeSlot = {
    id: next.id, task: next.task, startTs, endTs: next.endTs,
    breakMs: 0, breakStartTs: null, onBreak: false
  };
  saveState();
  renderTimerActive();
  startTickLoop();
  renderSessionQueue();
  renderHome();
}

function removeFromQueue(id) {
  state.sessionQueue = state.sessionQueue.filter(s => s.id !== id);
  saveState();
  renderSessionQueue();
  renderHome();
}

function startSession() {
  const task = el('task-name').value.trim();
  const start = el('start-time').value;
  const end = el('end-time').value;
  const hint = el('form-hint');

  if (!task) { hint.textContent = '⚠ Please enter a task name.'; return; }
  if (!start) { hint.textContent = '⚠ Please set a start time.'; return; }
  if (!end) { hint.textContent = '⚠ Please set an end time.'; return; }

  const todayPrefix = `${fmtDate(new Date())}T`;
  let startTs = new Date(todayPrefix + start).getTime();
  let endTs = new Date(todayPrefix + end).getTime();
  if (endTs <= startTs) endTs += 86400000;

  if (endTs <= nowMs()) { hint.textContent = '⚠ End time is in the past.'; return; }
  hint.textContent = '';

  addToQueue(task, startTs, endTs);
  el('task-name').value = '';
  setDefaultTimes();
}

function startSessionFromModal() {
  const task = el('modal-task-name').value.trim();
  const start = el('modal-start-time').value;
  const end = el('modal-end-time').value;
  const hint = el('modal-form-hint');

  if (!task) { hint.textContent = '⚠ Please enter a task name.'; return; }
  if (!start) { hint.textContent = '⚠ Please set a start time.'; return; }
  if (!end) { hint.textContent = '⚠ Please set an end time.'; return; }

  const todayPrefix = `${fmtDate(new Date())}T`;
  let startTs = new Date(todayPrefix + start).getTime();
  let endTs = new Date(todayPrefix + end).getTime();
  if (endTs <= startTs) endTs += 86400000;

  if (endTs <= nowMs()) { hint.textContent = '⚠ End time is in the past.'; return; }
  hint.textContent = '';

  addToQueue(task, startTs, endTs);
  el('modal-task-name').value = '';
  closeAddSessionModal();
}

function setDefaultTimes() {
  const now = new Date();
  const hh = pad(now.getHours()), mm = pad(now.getMinutes());
  el('start-time').value = `${hh}:${mm}`;
  const end = new Date(now.getTime() + 3600000);
  el('end-time').value = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
}

function setModalDefaultTimes() {
  const now = new Date();
  el('modal-start-time').value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const end = new Date(now.getTime() + 3600000);
  el('modal-end-time').value = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
}

function renderSessionQueue() {
  const list = el('session-queue-list');
  const items = [...(state.activeSlot ? [state.activeSlot] : []), ...state.sessionQueue];
  el('queue-count').textContent = items.length;

  if (items.length === 0) {
    list.innerHTML = '<p class="empty-state">No sessions queued. Add one below!</p>';
    return;
  }
  list.innerHTML = '';
  items.forEach((s, i) => {
    const isActive = state.activeSlot && s.id === state.activeSlot.id;
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <span class="history-status-icon">${isActive ? '⏱' : '📋'}</span>
      <div class="history-info">
        <div class="history-task">${escHtml(s.task)}</div>
        <div class="history-time">${fmtTimestamp(s.startTs)} – ${fmtTimestamp(s.endTs)}</div>
      </div>
      <span class="history-badge ${isActive ? 'active' : 'queued'}">${isActive ? 'active' : 'queued'}</span>
      ${!isActive ? `<div class="queue-item-actions"><button class="queue-item-del" data-id="${s.id}">🗑</button></div>` : ''}
    `;
    list.appendChild(div);
  });
  list.querySelectorAll('.queue-item-del').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); removeFromQueue(e.currentTarget.dataset.id); });
  });
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
  el('break-status').classList.remove('hidden');
  startBreakTick(mins * 60);
}
function startBreakTick(totalSec) {
  clearInterval(breakTickInterval);
  let remSec = totalSec;
  function tick() {
    el('break-countdown').textContent = fmtMS(remSec);
    if (remSec <= 0) { clearInterval(breakTickInterval); endBreak(); }
    remSec--;
  }
  tick();
  breakTickInterval = setInterval(tick, 1000);
}
function endBreak() {
  if (!state.activeSlot || !state.activeSlot.onBreak) return;
  state.activeSlot.breakMs += nowMs() - state.activeSlot.breakStartTs;
  state.activeSlot.breakStartTs = null;
  state.activeSlot.onBreak = false;
  saveState();
  el('break-status').classList.add('hidden');
  clearInterval(breakTickInterval);
  renderTimerActive();
  startTickLoop();
}
function endSessionManual() {
  if (!state.activeSlot) return;
  stopTickLoop();
  clearInterval(breakTickInterval);
  triggerAlarm();
}

/* =====================================================
   ALARM & ACCOUNTABILITY
   ===================================================== */
function triggerAlarm() {
  if (!state.activeSlot) return;
  startAlarmSound();
  showNotif("⏰ Time's Up!", `Did you complete: ${state.activeSlot.task}?`);
  el('alarm-task-name').textContent = state.activeSlot.task;
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
    id: slot.id, task: slot.task, startTs: slot.startTs, endTs: slot.endTs,
    result: completed ? 'completed' : 'failed',
    durationMs: slot.endTs - slot.startTs
  });
  state.activeSlot = null;
  updateStreak(todayDate);
  saveState();
  stopTickLoop();
  clearInterval(breakTickInterval);
  renderTimerIdle();
  renderHome();
  renderCalendar();
  renderStats();
  renderSessionQueue();
  // Auto-start next in queue
  setTimeout(() => startNextFromQueue(), 500);
}

let activeJourneyId = null;

/* =====================================================
   MY JOURNEY
   ===================================================== */
function openCreateJourneyModal() {
  el('new-journey-name').value = '';
  el('new-journey-date').value = today();
  document.querySelectorAll('.emoji-picker-item').forEach(e => e.classList.remove('selected'));
  document.querySelector('.emoji-picker-item[data-emoji="🔥"]').classList.add('selected');
  el('create-journey-modal').classList.remove('hidden');
}

function closeCreateJourneyModal() {
  el('create-journey-modal').classList.add('hidden');
}

function createJourney() {
  const name = el('new-journey-name').value.trim();
  const dateVal = el('new-journey-date').value;
  const emoji = document.querySelector('.emoji-picker-item.selected')?.dataset.emoji || '📖';
  
  if (!name || !dateVal) { alert('Please enter name and start date.'); return; }
  
  if (!state.journeys) state.journeys = {};
  const jid = 'j_' + genId();
  state.journeys[jid] = {
    id: jid,
    name: name,
    emoji: emoji,
    startDate: dateVal,
    entries: {}
  };
  saveState();
  closeCreateJourneyModal();
  renderJourney();
}

function getJourneyData(jid) {
  const journey = state.journeys[jid];
  if (!journey) return { array: [], total: 0, currentStreak: 0, bestStreak: 0 };
  
  const entriesArray = Object.keys(journey.entries || {})
    .map(k => ({ date: k, ...journey.entries[k] }))
    .sort((a, b) => a.dayNumber - b.dayNumber);
  
  const totalEntries = entriesArray.length;
  let currentStreak = 0, bestStreak = 0, tempStreak = 0, lastDateMs = null;
  const calendarSorted = [...entriesArray].sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  for (let i = 0; i < calendarSorted.length; i++) {
    const ts = new Date(calendarSorted[i].date).getTime();
    if (lastDateMs === null) { tempStreak = 1; }
    else {
      const diffDays = Math.round((ts - lastDateMs) / 86400000);
      if (diffDays === 1) tempStreak++;
      else if (diffDays > 1) tempStreak = 1;
    }
    if (tempStreak > bestStreak) bestStreak = tempStreak;
    lastDateMs = ts;
  }
  
  if (lastDateMs !== null) {
    const diffDays = Math.round((new Date(today()).getTime() - lastDateMs) / 86400000);
    if (diffDays <= 1) currentStreak = tempStreak;
    else currentStreak = 0;
  }

  return { array: entriesArray, total: totalEntries, currentStreak, bestStreak };
}

function renderJourney() {
  if (!state.journeys) state.journeys = {};
  
  const lv = el('journeys-list-view');
  const mv = el('journey-main-view');
  
  if (!activeJourneyId || !state.journeys[activeJourneyId]) {
    // Show list of journeys
    lv.classList.remove('hidden');
    mv.classList.add('hidden');
    
    const list = el('journeys-list');
    const jKeys = Object.keys(state.journeys);
    if (jKeys.length === 0) {
      list.innerHTML = '<p class="empty-state">No journeys yet. Create one!</p>';
    } else {
      list.innerHTML = '';
      jKeys.sort((a, b) => new Date(state.journeys[a].startDate).getTime() - new Date(state.journeys[b].startDate).getTime()).forEach(k => {
        const j = state.journeys[k];
        const data = getJourneyData(k);
        const lastEntryDate = data.array.length > 0 ? new Date(data.array[data.array.length-1].date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'No entries';
        
        let div = document.createElement('div');
        div.className = 'card preview-card';
        div.style.cursor = 'pointer';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.gap = '12px';
        div.style.marginBottom = '12px';
        div.innerHTML = `
          <div style="font-size:2.2rem; flex-shrink:0;">${j.emoji}</div>
          <div style="flex:1; min-width:0;">
            <div style="font-weight:700; font-size:1.1rem; color:var(--text); margin-bottom:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escHtml(j.name)}</div>
            <div style="font-size:0.8rem; color:var(--muted); display:flex; gap:10px;">
              <span>📝 ${data.total} entries</span>
              <span>🔥 ${data.currentStreak} streak</span>
            </div>
            <div style="font-size:0.75rem; color:var(--text2); margin-top:4px;">Last: ${lastEntryDate}</div>
          </div>
        `;
        div.addEventListener('click', () => { activeJourneyId = k; renderJourney(); });
        
        div.addEventListener('contextmenu', (e) => { e.preventDefault(); deleteJourneyCheck(k); });
        
        let pressTimer;
        div.addEventListener('touchstart', (e) => { 
          pressTimer = setTimeout(() => { deleteJourneyCheck(k); }, 800); 
        }, {passive:true});
        div.addEventListener('touchend', () => { clearTimeout(pressTimer); }, {passive:true});
        div.addEventListener('touchmove', () => { clearTimeout(pressTimer); }, {passive:true});
        
        list.appendChild(div);
      });
    }
    return;
  }
  
  // Show single journey
  lv.classList.add('hidden');
  mv.classList.remove('hidden');
  
  const j = state.journeys[activeJourneyId];
  const data = getJourneyData(activeJourneyId);
  const todayStr = today();
  const todayEntry = j.entries[todayStr];
  
  el('journey-title-display').textContent = `${j.emoji} ${j.name}`;
  
  el('journey-top-day').textContent = `Day ${todayEntry ? todayEntry.dayNumber : (data.total + 1)} of your journey 🔥`;
  const formattedStart = new Date(j.startDate).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  el('journey-start-text').textContent = `Journey started ${formattedStart}`;
  
  el('journey-stat-entries').textContent = data.total;
  el('journey-stat-streak').textContent = data.currentStreak;
  el('journey-stat-best').textContent = data.bestStreak;
  
  if (todayEntry) {
    el('journey-input-area').classList.add('hidden');
    el('journey-read-area').classList.remove('hidden');
    el('journey-today-text').textContent = todayEntry.text;
    el('btn-edit-journey').classList.remove('hidden');
  } else {
    el('journey-input-area').classList.remove('hidden');
    el('journey-read-area').classList.add('hidden');
    el('journey-textarea').value = '';
    el('btn-edit-journey').classList.add('hidden');
  }
  
  const pastList = el('journey-past-list');
  const past = data.array.filter(e => e.date !== todayStr).sort((a,b) => b.dayNumber - a.dayNumber);
  if (past.length === 0) {
    pastList.innerHTML = '<p class="empty-state">No past entries yet.</p>';
  } else {
    pastList.innerHTML = '';
    past.forEach(entry => {
      const div = document.createElement('div');
      div.className = 'card preview-card';
      div.style.cursor = 'pointer';
      div.style.marginBottom = '12px';
      div.style.textAlign = 'left';
      div.style.padding = '16px';
      
      const formattedDate = new Date(entry.date).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
      
      div.innerHTML = `
        <div style="font-weight:700; color:var(--text); margin-bottom:4px;">Day ${entry.dayNumber} <span style="font-weight:400; color:var(--muted); font-size:0.85em;">• ${formattedDate}</span></div>
        <div style="color:var(--text2); font-size:0.9em; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${escHtml(entry.text)}</div>
      `;
      div.addEventListener('click', () => openJourneyRead(entry.dayNumber, formattedDate, entry.text));
      pastList.appendChild(div);
    });
  }
}

function deleteJourneyCheck(jid) {
  if (confirm('Delete this journey forever?')) {
    delete state.journeys[jid];
    if (activeJourneyId === jid) activeJourneyId = null;
    saveState();
    renderJourney();
  }
}

function saveJourneyEntry() {
  if (!activeJourneyId) return;
  const text = el('journey-textarea').value.trim();
  if (!text) { alert('Please write something before saving.'); return; }
  
  const todayStr = today();
  const j = state.journeys[activeJourneyId];
  const existing = j.entries[todayStr];
  
  if (existing) {
    existing.text = text;
    existing.savedAt = nowMs();
  } else {
    const data = getJourneyData(activeJourneyId);
    j.entries[todayStr] = {
      dayNumber: data.total + 1,
      text: text,
      savedAt: nowMs()
    };
  }
  saveState();
  renderJourney();
  renderHome();
}

function editJourneyEntry() {
  if (!activeJourneyId) return;
  const todayStr = today();
  const existing = state.journeys[activeJourneyId].entries[todayStr];
  if (existing) {
    el('journey-input-area').classList.remove('hidden');
    el('journey-read-area').classList.add('hidden');
    el('journey-textarea').value = existing.text;
    el('btn-edit-journey').classList.add('hidden');
  }
}

function openJourneyRead(dayNum, dateStr, text) {
  el('journey-read-title').textContent = 'Day ' + dayNum;
  el('journey-read-date').textContent = dateStr;
  el('journey-read-text').textContent = text;
  el('journey-read-modal').classList.remove('hidden');
}

function closeJourneyRead() {
  el('journey-read-modal').classList.add('hidden');
}

/* =====================================================
   STREAK
   ===================================================== */
function updateStreak(dateStr) {
  const dayHistory = state.history[dateStr] || [];
  const dayCompleted = dayHistory.some(s => s.result === 'completed');
  if (dayCompleted) {
    const yesterday = fmtDate(new Date(new Date(dateStr).getTime() - 86400000));
    const prevCompleted = (state.history[yesterday] || []).some(s => s.result === 'completed');
    state.streak = (prevCompleted || state.lastDate === yesterday) ? state.streak + 1 : 1;
  } else { state.streak = 0; }
  if (state.streak > state.bestStreak) state.bestStreak = state.streak;
  state.lastDate = dateStr;
  renderStreakBadge();
}
function renderStreakBadge() {
  el('streak-count').textContent = state.streak;
  if (el('stat-streak')) el('stat-streak').textContent = state.bestStreak;
  el('streak-badge').classList.toggle('on-fire', state.streak >= 3);
}

/* =====================================================
   HOME SCREEN
   ===================================================== */
function renderHome() {
  renderHomeGreeting();
  renderHomeRing();
  renderWeeklyBars();
  renderHomeHistory();
  // Active card is updated by tickTimer
  if (!state.activeSlot) {
    el('home-active-card').classList.add('hidden');
    if (state.sessionQueue.length > 0) {
      el('home-next-card').classList.remove('hidden');
      el('hnc-task').textContent = state.sessionQueue[0].task;
      el('hnc-time').textContent = fmtTimestamp(state.sessionQueue[0].startTs) + ' – ' + fmtTimestamp(state.sessionQueue[0].endTs);
    } else {
      el('home-next-card').classList.add('hidden');
    }
  }
}

function renderHomeGreeting() {
  const now = new Date();
  const hour = now.getHours();
  let greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  el('home-greeting').innerHTML = `${greeting}, <span>Ankush</span> 👋`;
  el('home-date').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function renderHomeRing() {
  const todayStr = today();
  const sessions = state.history[todayStr] || [];
  const dayTodos = state.todos.filter(t => t.type === 'daily' && (t.targetDate || fmtDate(new Date(t.createdAt))) === todayStr);
  let total = sessions.length + dayTodos.length;
  let done = sessions.filter(s => s.result === 'completed').length + dayTodos.filter(t => t.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  el('ring-pct').textContent = pct + '%';
  const circle = el('ring-fill');
  const circumference = 2 * Math.PI * 52; // r=52
  circle.style.strokeDasharray = circumference;
  circle.style.strokeDashoffset = circumference - (circumference * pct / 100);
}

function renderWeeklyBars() {
  const container = el('home-weekly-bars');
  if (!container) return;
  container.innerHTML = '';
  const todayStr = today();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const dateStr = fmtDate(d);
    const sessions = state.history[dateStr] || [];
    const dayTodos = state.todos.filter(t => t.type === 'daily' && (t.targetDate || fmtDate(new Date(t.createdAt))) === dateStr);
    let total = sessions.length + dayTodos.length;
    let done = sessions.filter(s => s.result === 'completed').length + dayTodos.filter(t => t.done).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    let colorClass = '';
    if (total > 0) {
      if (done === total) colorClass = 'success';
      else if (done > 0) colorClass = 'partial';
      else colorClass = 'missed';
    }

    const bar = document.createElement('div');
    bar.className = 'wbar';
    bar.innerHTML = `
      <div class="wbar-fill-wrap"><div class="wbar-fill ${colorClass}" style="height:${Math.max(5, pct)}%"></div></div>
      <div class="wbar-day">${DAYS_SHORT[d.getDay()]}</div>
    `;
    container.appendChild(bar);
  }
}

function renderHomeHistory() {
  const list = el('home-history-list');
  const dayHistory = state.history[today()] || [];
  el('home-session-count').textContent = dayHistory.length;
  if (dayHistory.length === 0) {
    list.innerHTML = '<p class="empty-state">No sessions yet today.</p>';
    return;
  }
  list.innerHTML = '';
  [...dayHistory].reverse().forEach(s => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <span class="history-status-icon">${s.result === 'completed' ? '✅' : '❌'}</span>
      <div class="history-info">
        <div class="history-task">${escHtml(s.task)}</div>
        <div class="history-time">${fmtTimestamp(s.startTs)} – ${fmtTimestamp(s.endTs)}</div>
      </div>
      <span class="history-badge ${s.result === 'completed' ? 'completed' : 'failed'}">${s.result}</span>
    `;
    list.appendChild(div);
  });
}

/* =====================================================
   REMINDERS
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
  saveState(); renderReminders();
}

function renderReminders() {
  const list = el('reminders-list');
  const active = state.reminders.filter(r => !r.triggered).sort((a,b) => a.ts - b.ts);
  const done = state.reminders.filter(r => r.triggered).sort((a,b) => b.ts - a.ts);
  const all = [...active, ...done];
  el('reminders-count').textContent = active.length;

  if (all.length === 0) { list.innerHTML = '<p class="empty-state">No reminders set.</p>'; return; }
  list.innerHTML = '';
  const now = nowMs();
  all.forEach(r => {
    const div = document.createElement('div');
    div.className = 'reminder-item' + (r.triggered ? ' triggered' : '');

    let countdownHtml = '';
    if (!r.triggered && r.ts > now) {
      const diff = r.ts - now;
      const hrs = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      countdownHtml = `<div class="reminder-countdown">⏳ Rings in ${hrs > 0 ? hrs + 'h ' : ''}${mins}m</div>`;
    }

    div.innerHTML = `
      <div class="reminder-info">
        <div class="reminder-text">${escHtml(r.text)}</div>
        <div class="reminder-time">🕐 ${fmtDatetime(r.ts)}${r.triggered ? ' · ✅ Triggered' : ''}</div>
        ${countdownHtml}
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
  // Countdown update every 60s
  clearInterval(reminderCountdownInterval);
  reminderCountdownInterval = setInterval(renderReminders, 60000);
}
function checkReminders() {
  const now = nowMs();
  let changed = false;
  state.reminders.forEach(r => {
    if (!r.triggered && r.ts <= now) {
      r.triggered = true; changed = true;
      startAlarmSound();
      showNotif('📌 Reminder!', r.text);
      // Show reminder overlay
      el('reminder-alarm-text').textContent = r.text;
      el('reminder-overlay').classList.remove('hidden');
    }
  });
  if (changed) { saveState(); renderReminders(); }
}

/* =====================================================
   TODOS
   ===================================================== */
function addTodo() {
  const text = el('todo-text').value.trim();
  const type = el('todo-type').value;
  const dateVal = el('todo-date').value;
  if (!text) { alert('Please enter text.'); return; }
  state.todos.push({ id: genId(), text, type, done: false, createdAt: nowMs(), targetDate: dateVal || today() });
  saveState();
  el('todo-text').value = '';
  renderTodos(); renderCalendar(); renderHome();
}
function toggleTodo(id) {
  const todo = state.todos.find(t => t.id === id);
  if (todo) {
    todo.done = !todo.done; saveState();
    renderTodos(); renderCalendar(); renderHome();
    const modal = el('day-view-modal');
    if (modal && !modal.classList.contains('hidden')) {
      openDayView(todo.targetDate || fmtDate(new Date(todo.createdAt)));
    }
  }
}
function deleteTodo(id) {
  state.todos = state.todos.filter(t => t.id !== id);
  saveState(); renderTodos(); renderHome();
}

function renderTodos() {
  renderTodoGroup('daily','daily-todos-list','daily-progress','daily-progress-bar','No daily goals yet.');
  renderTodoGroup('weekly','weekly-todos-list','weekly-progress','weekly-progress-bar','No weekly goals yet.');
  renderTodoGroup('note','note-todos-list','note-progress',null,'No notes or doubts yet.');
}

function getWeekRange(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(d.setDate(diff));
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return { start: fmtDate(start), end: fmtDate(end) };
}

function renderTodoGroup(type, listId, chipId, barId, emptyMsg) {
  let todos = state.todos.filter(t => t.type === type);
  const todayStr = today();
  if (type === 'daily' || type === 'note') {
    todos = todos.filter(t => (t.targetDate || fmtDate(new Date(t.createdAt))) === todayStr);
  } else if (type === 'weekly') {
    const { start, end } = getWeekRange(todayStr);
    todos = todos.filter(t => { const td = t.targetDate || fmtDate(new Date(t.createdAt)); return td >= start && td <= end; });
  }
  const list = el(listId); if (!list || !el(chipId)) return;
  const done = todos.filter(t => t.done).length;
  const total = todos.length;
  const pct = total > 0 ? Math.round((done/total)*100) : 0;
  el(chipId).textContent = type === 'note' ? `${total}` : `${done}/${total}`;
  if (barId) el(barId).style.width = `${pct}%`;
  if (todos.length === 0) { list.innerHTML = `<p class="empty-state">${emptyMsg}</p>`; return; }
  list.innerHTML = '';
  todos.forEach(t => {
    const div = document.createElement('div');
    div.className = 'todo-item' + (t.done ? ' done' : '');
    const cbHtml = type === 'note' ? '<span class="todo-bullet">•</span>' : `<div class="todo-checkbox">${t.done ? '✓' : ''}</div>`;
    div.innerHTML = `${cbHtml}<span class="todo-text">${escHtml(t.text)}</span><button class="todo-delete" data-id="${t.id}">🗑</button>`;
    div.addEventListener('click', e => { if (e.target.classList.contains('todo-delete')) return; toggleTodo(t.id); });
    div.querySelector('.todo-delete').addEventListener('click', e => { e.stopPropagation(); deleteTodo(t.id); });
    list.appendChild(div);
  });
}

/* =====================================================
   CALENDAR
   ===================================================== */
function renderCalendar() {
  const title = el('cal-month-title');
  if (!title) return;
  title.textContent = `${MONTHS[calendarMonth]} ${calendarYear}`;
  const grid = el('calendar-grid');
  grid.innerHTML = '';
  const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const daysInPrev = new Date(calendarYear, calendarMonth, 0).getDate();
  const todayStr = today();

  for (let i = firstDay - 1; i >= 0; i--) grid.appendChild(createCalDay(daysInPrev - i, 'other-month'));

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calendarYear}-${pad(calendarMonth+1)}-${pad(d)}`;
    const sessions = state.history[dateStr] || [];
    const dayTodos = state.todos.filter(t => (t.targetDate || fmtDate(new Date(t.createdAt))) === dateStr);
    const dayRems = state.reminders.filter(r => fmtDate(new Date(r.ts)) === dateStr);
    let total = sessions.length + dayTodos.filter(t => t.type === 'daily').length;
    let completed = sessions.filter(s => s.result === 'completed').length + dayTodos.filter(t => t.type === 'daily' && t.done).length;
    let colorClass = '';
    if (total > 0) { colorClass = completed === total ? 'completed' : completed > 0 ? 'partial' : 'missed'; }
    const classes = [dateStr === todayStr ? 'today' : '', colorClass, dayRems.length > 0 ? 'has-reminders' : ''].filter(Boolean);
    const day = createCalDay(d, ...classes);
    day.dataset.date = dateStr;
    day.addEventListener('click', () => openDayView(dateStr));
    grid.appendChild(day);
  }

  const total = grid.children.length;
  const rem = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 1; i <= rem; i++) grid.appendChild(createCalDay(i, 'other-month'));
}

function createCalDay(num, ...classes) {
  const div = document.createElement('div');
  div.className = 'cal-day ' + classes.join(' ');
  div.textContent = num;
  const dot = document.createElement('div'); dot.className = 'cal-dot';
  div.appendChild(dot);
  return div;
}

function renderStats() {
  let total = 0, completed = 0, totalMs = 0;
  Object.values(state.history).forEach(sessions => {
    sessions.forEach(s => { total++; if (s.result === 'completed') { completed++; totalMs += s.durationMs || 0; } });
  });
  if (el('stat-total')) el('stat-total').textContent = total;
  if (el('stat-completed')) el('stat-completed').textContent = completed;
  if (el('stat-hours')) el('stat-hours').textContent = (totalMs / 3600000).toFixed(1) + 'h';
  if (el('stat-streak')) el('stat-streak').textContent = state.bestStreak;
}

/* =====================================================
   DAY VIEW
   ===================================================== */
function openDayView(dateStr) {
  el('day-view-title').textContent = new Date(dateStr + 'T12:00:00').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const sessions = state.history[dateStr] || [];
  const secSessions = el('day-view-sessions');
  if (sessions.length === 0) { secSessions.innerHTML = '<p class="empty-state">No sessions.</p>'; }
  else {
    secSessions.innerHTML = '';
    sessions.forEach(s => {
      const div = document.createElement('div'); div.className = 'history-item';
      div.innerHTML = `<span class="history-status-icon">${s.result==='completed'?'✅':'❌'}</span><div class="history-info"><div class="history-task">${escHtml(s.task)}</div><div class="history-time">${fmtDatetime(s.startTs)} – ${fmtDatetime(s.endTs)}</div></div><span class="history-badge ${s.result==='completed'?'completed':'failed'}">${s.result}</span>`;
      secSessions.appendChild(div);
    });
  }

  const dayTodos = state.todos.filter(t => (t.targetDate || fmtDate(new Date(t.createdAt))) === dateStr);
  const tasks = dayTodos.filter(t => t.type !== 'note');
  const secTasks = el('day-view-todos');
  if (tasks.length === 0) { secTasks.innerHTML = '<p class="empty-state">No tasks.</p>'; }
  else {
    secTasks.innerHTML = '';
    tasks.forEach(t => {
      const div = document.createElement('div'); div.className = 'todo-item' + (t.done ? ' done' : ''); div.style.cursor = 'pointer';
      div.innerHTML = `<div class="todo-checkbox">${t.done?'✓':''}</div><span class="todo-text">${escHtml(t.text)}</span>`;
      div.addEventListener('click', () => toggleTodo(t.id));
      secTasks.appendChild(div);
    });
  }

  const notes = dayTodos.filter(t => t.type === 'note');
  const secNotes = el('day-view-notes');
  if (notes.length === 0) { secNotes.innerHTML = '<p class="empty-state">No doubts/notes.</p>'; }
  else {
    secNotes.innerHTML = '';
    notes.forEach(t => {
      const div = document.createElement('div'); div.className = 'todo-item';
      div.innerHTML = `<span class="todo-bullet">•</span><span class="todo-text">${escHtml(t.text)}</span>`;
      secNotes.appendChild(div);
    });
  }

  const rems = state.reminders.filter(r => fmtDate(new Date(r.ts)) === dateStr);
  const secRems = el('day-view-reminders');
  if (rems.length === 0) { secRems.innerHTML = '<p class="empty-state">No reminders.</p>'; }
  else {
    secRems.innerHTML = '';
    rems.forEach(r => {
      const div = document.createElement('div'); div.className = 'reminder-item' + (r.triggered ? ' triggered' : '');
      div.innerHTML = `<div class="reminder-info"><div class="reminder-text">${escHtml(r.text)}</div><div class="reminder-time">🕐 ${fmtDatetime(r.ts)}${r.triggered?' · ✅ Triggered':''}</div></div>`;
      secRems.appendChild(div);
    });
  }
  el('day-view-modal').classList.remove('hidden');
}
function closeDayView() { el('day-view-modal').classList.add('hidden'); }

/* =====================================================
   COLLAPSIBLE SECTIONS
   ===================================================== */
function initCollapsibles() {
  document.querySelectorAll('.collapsible-trigger').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const targetId = trigger.dataset.target;
      const body = el(targetId);
      const arrow = el('arrow-' + targetId);
      if (body) body.classList.toggle('collapsed');
      if (arrow) arrow.classList.toggle('rotated');
    });
  });
}

/* =====================================================
   ADD SESSION MODAL (FAB)
   ===================================================== */
function openAddSessionModal() {
  setModalDefaultTimes();
  el('modal-form-hint').textContent = '';
  el('add-session-modal').classList.remove('hidden');
}
function closeAddSessionModal() { el('add-session-modal').classList.add('hidden'); }

/* =====================================================
   SETTINGS: RINGTONE
   ===================================================== */
function initRingtone() {
  el('ringtone-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      state.customRingtone = ev.target.result;
      saveState();
      updateRingtoneUI();
    };
    reader.readAsDataURL(file);
  });
  el('btn-test-ringtone').addEventListener('click', () => {
    if (state.customRingtone) {
      const a = new Audio(state.customRingtone);
      a.play().catch(() => {});
      setTimeout(() => { a.pause(); a.currentTime = 0; }, 5000);
    }
  });
  el('btn-remove-ringtone').addEventListener('click', () => {
    state.customRingtone = null; saveState(); updateRingtoneUI();
  });
  updateRingtoneUI();
}
function updateRingtoneUI() {
  if (state.customRingtone) {
    el('ringtone-status').textContent = '✅ Custom ringtone set.';
    el('ringtone-actions').classList.remove('hidden');
  } else {
    el('ringtone-status').textContent = 'No custom ringtone set. Using default beep.';
    el('ringtone-actions').classList.add('hidden');
  }
}

/* =====================================================
   EXPIRED SLOT DETECTION
   ===================================================== */
function checkExpiredSlot() {
  if (!state.activeSlot) return;
  if (state.activeSlot.onBreak) {
    const breakElapsed = nowMs() - state.activeSlot.breakStartTs;
    const expected = state.activeSlot._breakDurationMs || 300000;
    if (breakElapsed >= expected) { endBreak(); return; }
    renderTimerActive();
    el('break-status').classList.remove('hidden');
    startBreakTick(Math.ceil((expected - breakElapsed) / 1000));
    return;
  }
  if (getRemainingMs() <= 0) { triggerAlarm(); }
  else { renderTimerActive(); startTickLoop(); }
}

/* =====================================================
   PWA INSTALL
   ===================================================== */
function initPWA() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferredInstall = e;
    el('install-btn').classList.remove('hidden');
  });
  const doInstall = async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    if (outcome === 'accepted') el('install-btn').classList.add('hidden');
    deferredInstall = null;
  };
  el('install-btn').addEventListener('click', doInstall);
  el('install-btn-2').addEventListener('click', doInstall);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
}

/* =====================================================
   SVG GRADIENT (inject into DOM)
   ===================================================== */
function injectSVGGradient() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.style.position = 'absolute'; svg.style.width = '0'; svg.style.height = '0';
  svg.innerHTML = '<defs><linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#ff6b00"/><stop offset="100%" stop-color="#ff9d00"/></linearGradient></defs>';
  document.body.prepend(svg);
}

/* =====================================================
   EVENT LISTENERS
   ===================================================== */
function initEvents() {
  el('btn-start-session').addEventListener('click', startSession);
  el('task-name').addEventListener('keydown', e => { if (e.key==='Enter') startSession(); });
  el('btn-take-break').addEventListener('click', openBreakModal);
  el('btn-cancel-break').addEventListener('click', closeBreakModal);
  el('btn-start-break').addEventListener('click', startBreak);
  el('btn-end-session').addEventListener('click', () => { if (confirm('End this session now?')) endSessionManual(); });
  el('btn-yes').addEventListener('click', () => resolveAlarm(true));
  el('btn-no').addEventListener('click', () => resolveAlarm(false));
  el('btn-dismiss-alarm').addEventListener('click', () => { stopAlarmSound(); });
  // Alarm overlay tap-to-dismiss (stop sound, not resolve)
  el('alarm-overlay').addEventListener('click', (e) => {
    if (e.target === el('alarm-overlay') || e.target === el('alarm-tap-hint')) stopAlarmSound();
  });
  el('btn-enable-notif').addEventListener('click', requestNotifPermission);
  el('btn-dismiss-notif').addEventListener('click', hideBanner);
  el('btn-add-reminder').addEventListener('click', addReminder);
  el('reminder-text').addEventListener('keydown', e => { if (e.key==='Enter') addReminder(); });
  el('btn-add-todo').addEventListener('click', addTodo);
  el('todo-text').addEventListener('keydown', e => { if (e.key==='Enter') addTodo(); });
  el('cal-prev').addEventListener('click', () => { calendarMonth--; if (calendarMonth<0){calendarMonth=11;calendarYear--;} renderCalendar(); });
  el('cal-next').addEventListener('click', () => { calendarMonth++; if (calendarMonth>11){calendarMonth=0;calendarYear++;} renderCalendar(); });
  el('break-modal').addEventListener('keydown', e => { if (e.key==='Escape') closeBreakModal(); });
  el('btn-close-day-view').addEventListener('click', closeDayView);
  el('day-view-modal').addEventListener('click', e => { if (e.target === el('day-view-modal')) closeDayView(); });
  el('day-view-modal').addEventListener('keydown', e => { if (e.key==='Escape') closeDayView(); });
  // FAB
  el('fab-add').addEventListener('click', openAddSessionModal);
  el('btn-modal-start-session').addEventListener('click', startSessionFromModal);
  el('btn-modal-cancel').addEventListener('click', closeAddSessionModal);
  el('add-session-modal').addEventListener('click', e => { if (e.target === el('add-session-modal')) closeAddSessionModal(); });
  // Home active card -> go to timer
  el('hac-go-timer').addEventListener('click', () => switchTab(2));
  // Reminder overlay
  el('btn-dismiss-reminder').addEventListener('click', () => { stopAlarmSound(); el('reminder-overlay').classList.remove('hidden'); el('reminder-overlay').classList.add('hidden'); });
  el('reminder-overlay').addEventListener('click', (e) => { if (e.target.closest('.reminder-alarm-box')) return; stopAlarmSound(); el('reminder-overlay').classList.add('hidden'); });
  // Notification toggle in settings
  el('btn-notif-toggle').addEventListener('click', requestNotifPermission);

  // Journey
  el('btn-open-create-journey').addEventListener('click', openCreateJourneyModal);
  el('btn-create-journey').addEventListener('click', createJourney);
  el('btn-cancel-journey').addEventListener('click', closeCreateJourneyModal);
  el('create-journey-modal').addEventListener('click', e => { if (e.target === el('create-journey-modal')) closeCreateJourneyModal(); });
  
  document.querySelectorAll('.emoji-picker-item').forEach(e => {
    e.addEventListener('click', () => {
      document.querySelectorAll('.emoji-picker-item').forEach(x => x.classList.remove('selected'));
      e.classList.add('selected');
    });
  });
  
  el('btn-journey-back').addEventListener('click', () => { activeJourneyId = null; renderJourney(); });
  el('btn-save-journey').addEventListener('click', saveJourneyEntry);
  el('btn-edit-journey').addEventListener('click', editJourneyEntry);
  el('btn-close-journey-read').addEventListener('click', closeJourneyRead);
  el('journey-read-modal').addEventListener('click', e => { if (e.target === el('journey-read-modal')) closeJourneyRead(); });
}

function renderAll() {
  renderStreakBadge();
  renderHome();
  renderReminders();
  renderTodos();
  renderCalendar();
  renderStats();
  renderSessionQueue();
  renderJourney();
}

/* =====================================================
   INIT
   ===================================================== */
async function init() {
  injectSVGGradient();
  initTabs();
  initEvents();
  initCollapsibles();
  initPWA();
  initRingtone();
  setDefaultTimes();
  el('todo-date').value = today();

  await loadState();

  renderAll();
  showBanner();
  checkExpiredSlot();
  startReminderLoop();

  document.addEventListener('click', initAudio, { once: true });
  document.addEventListener('touchstart', initAudio, { once: true });
  document.addEventListener('keydown', initAudio, { once: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();