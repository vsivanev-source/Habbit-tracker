// =====================================================
// ТРЕКЕР ПРИВЫЧЕК — PWA
// =====================================================

// === UTILITIES ===

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function today() { return fmtDate(new Date()); }

function dayOfWeek(d) {
  const dow = d.getDay();
  return dow === 0 ? 7 : dow; // 1=Mon, 7=Sun
}

function getMonday(d) {
  const date = new Date(d);
  const dow = date.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

const DAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];


// === DATA STORE ===

const Store = {
  _data: null,
  _uid: null,
  _docRef: null,

  setUser(uid) {
    this._uid = uid;
    this._docRef = db.collection('users').doc(uid).collection('data').doc('main');
  },

  async load() {
    if (!this._docRef) { this._data = this._default(); return; }
    try {
      const snap = await this._docRef.get();
      this._data = snap.exists ? snap.data() : null;
    } catch (e) {
      console.error('Firestore load error:', e);
      this._data = null;
    }
    if (!this._data) {
      // Try migrate from localStorage
      try {
        const raw = localStorage.getItem('habitTracker');
        if (raw) {
          const local = JSON.parse(raw);
          if (local.habits && local.categories) {
            this._data = local;
            if (!this._data.deductions) this._data.deductions = [];
            await this._docRef.set(this._data);
            localStorage.removeItem('habitTracker');
            return;
          }
        }
      } catch {}
      this._data = this._default();
      await this._docRef.set(this._data);
    }
    // Ensure structure
    if (!this._data.categories) this._data.categories = this._default().categories;
    if (!this._data.habits) this._data.habits = [];
    if (!this._data.deductions) this._data.deductions = [];
  },

  save() {
    if (!this._docRef) return;
    this._docRef.set(this._data).catch(e => console.error('Firestore save error:', e));
  },

  _default() {
    return {
      categories: [
        { id: 'health', name: 'Здоровье', color: '#00B894' },
        { id: 'growth', name: 'Саморазвитие', color: '#6C5CE7' }
      ],
      habits: [],
      deductions: []
    };
  },

  // --- Categories ---
  categories() { return this._data.categories; },

  category(id) { return this._data.categories.find(c => c.id === id); },

  addCategory(name, color) {
    const cat = { id: uid(), name, color };
    this._data.categories.push(cat);
    this.save();
    return cat;
  },

  updateCategory(id, name, color) {
    const cat = this.category(id);
    if (cat) { cat.name = name; cat.color = color; this.save(); }
  },

  deleteCategory(id) {
    this._data.categories = this._data.categories.filter(c => c.id !== id);
    // Move habits to first category or unset
    const fallback = this._data.categories[0]?.id || '';
    this._data.habits.forEach(h => { if (h.categoryId === id) h.categoryId = fallback; });
    this.save();
  },

  // --- Habits ---
  habits() { return this._data.habits; },

  habit(id) { return this._data.habits.find(h => h.id === id); },

  addHabit(h) {
    const habit = {
      id: uid(),
      name: h.name,
      categoryId: h.categoryId,
      type: h.type || 'positive',
      points: h.points || 10,
      scheduleMode: h.scheduleMode || 'days',
      schedule: h.schedule || [],
      weeklyTarget: h.weeklyTarget || 3,
      notifications: h.notifications || { enabled: false, time: '09:00' },
      completions: {},
      createdAt: today()
    };
    this._data.habits.push(habit);
    this.save();
    return habit;
  },

  updateHabit(id, updates) {
    const h = this.habit(id);
    if (h) { Object.assign(h, updates); this.save(); }
  },

  deleteHabit(id) {
    this._data.habits = this._data.habits.filter(h => h.id !== id);
    this.save();
  },

  toggleCompletion(habitId, dateStr) {
    const h = this.habit(habitId);
    if (!h) return;
    if (!h.completions) h.completions = {};
    if (h.completions[dateStr]) {
      delete h.completions[dateStr];
    } else {
      h.completions[dateStr] = true;
    }
    this.save();
  },

  completionRate(habitId) {
    const h = this.habit(habitId);
    if (!h) return 0;
    const now = new Date();

    if (h.scheduleMode === 'weekly') {
      let weeksMet = 0, totalWeeks = 0;
      const currentMonday = getMonday(now);
      for (let w = 0; w < 5; w++) {
        const weekStart = new Date(currentMonday);
        weekStart.setDate(currentMonday.getDate() - w * 7);
        let count = 0;
        for (let d = 0; d < 7; d++) {
          const day = new Date(weekStart);
          day.setDate(weekStart.getDate() + d);
          if (day > now) break;
          if (h.completions && h.completions[fmtDate(day)]) count++;
        }
        totalWeeks++;
        if (count >= (h.weeklyTarget || 3)) weeksMet++;
      }
      return totalWeeks > 0 ? weeksMet / totalWeeks : 0;
    }

    let scheduled = 0, done = 0;
    for (let i = 0; i < 30; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dow = dayOfWeek(d);
      const ds = fmtDate(d);
      if (h.schedule.length === 0 || h.schedule.includes(dow)) {
        scheduled++;
        if (h.completions && h.completions[ds]) done++;
      }
    }
    return scheduled > 0 ? done / scheduled : 0;
  },

  currentStreak(habitId) {
    const h = this.habit(habitId);
    if (!h) return 0;
    const now = new Date();

    if (h.scheduleMode === 'weekly') {
      let streak = 0;
      const currentMonday = getMonday(now);
      for (let w = 0; w < 52; w++) {
        const weekStart = new Date(currentMonday);
        weekStart.setDate(currentMonday.getDate() - w * 7);
        let count = 0;
        for (let d = 0; d < 7; d++) {
          const day = new Date(weekStart);
          day.setDate(weekStart.getDate() + d);
          if (day > now) break;
          if (h.completions && h.completions[fmtDate(day)]) count++;
        }
        if (count >= (h.weeklyTarget || 3)) {
          streak++;
        } else {
          if (w > 0) break;
        }
      }
      return streak;
    }

    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dow = dayOfWeek(d);
      if (h.schedule.length > 0 && !h.schedule.includes(dow)) continue;
      if (h.completions && h.completions[fmtDate(d)]) {
        streak++;
      } else {
        if (i > 0) break;
      }
    }
    return streak;
  },

  // --- Points ---
  totalPoints() {
    let total = 0;
    for (const h of this._data.habits) {
      const count = Object.keys(h.completions || {}).length;
      if (h.type === 'positive') total += count * h.points;
      else total -= count * h.points;
    }
    for (const d of this._data.deductions) {
      total -= d.points;
    }
    return total;
  },

  // --- Deductions ---
  addDeduction(description, points) {
    this._data.deductions.push({ id: uid(), description, points, date: today() });
    this.save();
  },

  deductions() { return this._data.deductions; },

  // --- Backup ---
  exportData() { return JSON.stringify(this._data, null, 2); },

  importData(json) {
    try {
      const data = JSON.parse(json);
      if (data.habits && data.categories) {
        this._data = data;
        if (!this._data.deductions) this._data.deductions = [];
        this.save();
        return true;
      }
    } catch {}
    return false;
  }
};


// === NOTIFICATIONS ===

const Notify = {
  _interval: null,
  _lastCheck: '',

  async init() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    this.start();
  },

  start() {
    if (this._interval) clearInterval(this._interval);
    this._interval = setInterval(() => this.check(), 30000);
    this.check();
  },

  check() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const now = new Date();
    const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const checkKey = today() + '_' + timeStr;
    if (this._lastCheck === checkKey) return;
    this._lastCheck = checkKey;

    const dow = dayOfWeek(now);
    const todayStr = today();

    for (const h of Store.habits()) {
      if (!h.notifications || !h.notifications.enabled) continue;
      if (h.notifications.time !== timeStr) continue;
      if (h.schedule.length > 0 && !h.schedule.includes(dow)) continue;
      if (h.completions && h.completions[todayStr]) continue;

      new Notification('Трекер привычек', {
        body: h.name,
        icon: 'icon.svg',
        tag: h.id
      });
    }
  }
};


// === AUTH ===

function firebaseErrorMessage(code) {
  const map = {
    'auth/email-already-in-use': 'Этот email уже зарегистрирован',
    'auth/invalid-email': 'Некорректный email',
    'auth/weak-password': 'Пароль должен быть не менее 6 символов',
    'auth/user-not-found': 'Пользователь не найден',
    'auth/wrong-password': 'Неверный пароль',
    'auth/too-many-requests': 'Слишком много попыток. Попробуйте позже',
    'auth/invalid-credential': 'Неверный email или пароль',
  };
  return map[code] || 'Произошла ошибка. Попробуйте ещё раз';
}

const Auth = {
  currentUser: null,
  isAdmin: false,

  init() {
    return new Promise((resolve) => {
      auth.onAuthStateChanged(async (user) => {
        if (user) {
          Auth.currentUser = user;
          Store.setUser(user.uid);

          // Check admin status
          const userDoc = await db.collection('users').doc(user.uid).get();
          Auth.isAdmin = userDoc.exists && userDoc.data().isAdmin === true;

          await Store.load();
          navigateTo('main');

          // Show/hide admin button
          const adminSection = document.getElementById('admin-section');
          if (adminSection) adminSection.style.display = Auth.isAdmin ? '' : 'none';
        } else {
          Auth.currentUser = null;
          Auth.isAdmin = false;
          navigateTo('auth');
        }
        resolve();
      });
    });
  },

  async register(email, password) {
    const cred = await auth.createUserWithEmailAndPassword(email, password);

    // Check if this is the first user (admin)
    const usersSnap = await db.collection('users').get();
    const isFirst = usersSnap.size === 1; // just created user doc doesn't exist yet, so check after

    const isAdmin = usersSnap.empty;
    await db.collection('users').doc(cred.user.uid).set({
      email: email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      isAdmin: isAdmin
    });

    // Set admin status directly (onAuthStateChanged may fire before doc is written)
    Auth.isAdmin = isAdmin;
    const adminSection = document.getElementById('admin-section');
    if (adminSection) adminSection.style.display = isAdmin ? '' : 'none';

    return cred.user;
  },

  async login(email, password) {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    return cred.user;
  },

  async logout() {
    await auth.signOut();
  }
};


// === ADMIN PANEL ===

async function renderAdminPanel() {
  if (!Auth.isAdmin) return;
  const el = document.getElementById('admin-user-list');
  el.innerHTML = '<p style="color:var(--text2);font-size:14px;">Загрузка...</p>';

  try {
    const snap = await db.collection('users').get();
    let html = '';
    snap.forEach(doc => {
      const u = doc.data();
      const isSelf = doc.id === Auth.currentUser.uid;
      const dateStr = u.createdAt?.toDate?.()?.toLocaleDateString?.('ru-RU') || '—';
      html += `<div class="admin-user-row">
        <div class="admin-user-info">
          <div class="admin-user-email">${escHtml(u.email || '—')}${u.isAdmin ? ' (админ)' : ''}</div>
          <div class="admin-user-meta">Регистрация: ${dateStr}</div>
        </div>
        ${!isSelf ? `<div class="admin-user-actions">
          <button class="btn-small-danger" data-uid="${doc.id}" data-action="reset">Сбросить</button>
          <button class="btn-small-danger" data-uid="${doc.id}" data-action="delete">Удалить</button>
        </div>` : ''}
      </div>`;
    });
    el.innerHTML = html || '<p style="color:var(--text2);font-size:14px;">Нет пользователей</p>';

    el.querySelectorAll('[data-action="reset"]').forEach(btn => {
      btn.addEventListener('click', () => adminResetUser(btn.dataset.uid));
    });
    el.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => adminDeleteUser(btn.dataset.uid));
    });
  } catch (e) {
    el.innerHTML = '<p style="color:var(--negative);font-size:14px;">Ошибка загрузки</p>';
    console.error('Admin panel error:', e);
  }
}

function adminResetUser(uid) {
  showConfirm('Сбросить все данные пользователя?', async () => {
    await db.collection('users').doc(uid).collection('data').doc('main').delete();
    renderAdminPanel();
  });
}

function adminDeleteUser(uid) {
  showConfirm('Удалить пользователя? Это действие необратимо.', async () => {
    await db.collection('users').doc(uid).collection('data').doc('main').delete();
    await db.collection('users').doc(uid).delete();
    renderAdminPanel();
  });
}


// === NAVIGATION ===

let currentScreen = 'auth';
const screenParams = {};

function navigateTo(screenId, params) {
  screenParams[screenId] = params || {};
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + screenId);
  if (el) {
    el.classList.add('active');
    el.scrollTop = 0;
  }
  currentScreen = screenId;

  // Show FAB only on main screen
  const fab = document.getElementById('btn-add-habit');
  if (fab) fab.style.display = screenId === 'main' ? '' : 'none';

  // Render the target screen
  if (screenId === 'main') renderMain();
  else if (screenId === 'habit-form') renderHabitForm(params);
  else if (screenId === 'habit-detail') renderHabitDetail(params);
  else if (screenId === 'settings') renderSettings();
  else if (screenId === 'admin') renderAdminPanel();
}


// === MAIN SCREEN ===

function renderMain() {
  renderPoints();
  renderWeekHeader();
  renderHabitList();
}

function renderPoints() {
  const pts = Store.totalPoints();
  document.getElementById('total-points').textContent = pts.toLocaleString('ru-RU');
}

function renderWeekHeader() {
  const el = document.getElementById('week-header');
  const now = new Date();
  const monday = getMonday(now);
  const todayStr = today();

  let html = '<div class="week-spacer"></div>';
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const isToday = fmtDate(d) === todayStr;
    html += `<div class="week-day ${isToday ? 'today' : ''}">
      <span class="week-day-name">${DAY_SHORT[i]}</span>
      <span class="week-day-num">${d.getDate()}</span>
    </div>`;
  }
  el.innerHTML = html;
}

function renderHabitList() {
  const el = document.getElementById('habit-list');
  const habits = Store.habits();

  if (habits.length === 0) {
    el.innerHTML = '<div class="empty-state"><p>Пока нет привычек</p><p class="hint">Нажмите + чтобы добавить первую</p></div>';
    return;
  }

  const now = new Date();
  const todayStr = today();
  const monday = getMonday(now);

  // Sort: positive first, then negative
  const sorted = [...habits].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'positive' ? -1 : 1;
    return 0;
  });

  let html = '';
  for (const habit of sorted) {
    html += buildHabitRow(habit, monday, todayStr, now);
  }
  el.innerHTML = html;

  // Attach click handlers for day cells
  el.querySelectorAll('.day-cell[data-toggleable]').forEach(cell => {
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      Store.toggleCompletion(cell.dataset.habit, cell.dataset.date);
      renderMain();
    });
  });

  // Attach click handlers for habit info
  el.querySelectorAll('.habit-info').forEach(info => {
    info.addEventListener('click', () => {
      navigateTo('habit-detail', { habitId: info.dataset.habitId });
    });
  });
}

function buildHabitRow(habit, monday, todayStr, now) {
  const cat = Store.category(habit.categoryId);
  const rate = Store.completionRate(habit.id);
  const size = Math.round(10 + rate * 16); // 10px to 26px

  let daysHtml = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const ds = fmtDate(d);
    const dow = dayOfWeek(d);
    const scheduled = habit.scheduleMode === 'weekly' || habit.schedule.length === 0 || habit.schedule.includes(dow);
    const completed = habit.completions && habit.completions[ds];
    const isFuture = ds > todayStr;

    let cls = 'day-cell';
    let content = '';
    let toggleable = false;

    if (!scheduled) {
      cls += ' not-scheduled';
      content = '—';
    } else if (completed) {
      cls += habit.type === 'positive' ? ' completed-positive' : ' completed-negative';
      content = habit.type === 'positive' ? '✓' : '✕';
      toggleable = true;
    } else if (isFuture) {
      cls += ' future';
      content = '·';
    } else {
      cls += ' pending';
      content = '○';
      toggleable = true;
    }

    daysHtml += `<div class="${cls}" data-habit="${habit.id}" data-date="${ds}" ${toggleable ? 'data-toggleable="1"' : ''}>${content}</div>`;
  }

  return `<div class="habit-row">
    <div class="habit-info" data-habit-id="${habit.id}">
      <div class="category-dot" style="width:${size}px;height:${size}px;background:${cat?.color || '#999'}"></div>
      <span class="habit-name">${escHtml(habit.name)}</span>
      <span class="habit-pts ${habit.type}">${habit.type === 'positive' ? '+' : '−'}${habit.points}</span>
    </div>
    ${daysHtml}
  </div>`;
}

function createEmptyState() {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.id = 'empty-state';
  div.innerHTML = '<p>Пока нет привычек</p><p class="hint">Нажмите + чтобы добавить первую</p>';
  return div;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


// === HABIT FORM ===

let editingHabitId = null;

function renderHabitForm(params) {
  editingHabitId = params?.habitId || null;
  const isEdit = !!editingHabitId;

  document.getElementById('form-title').textContent = isEdit ? 'Редактировать' : 'Новая привычка';
  document.getElementById('btn-delete-habit').style.display = isEdit ? '' : 'none';

  if (isEdit) {
    const h = Store.habit(editingHabitId);
    if (!h) { navigateTo('main'); return; }
    document.getElementById('habit-name').value = h.name;
    document.getElementById('habit-points').value = h.points;
    document.getElementById('habit-notify').checked = h.notifications?.enabled || false;
    document.getElementById('habit-notify-time').value = h.notifications?.time || '09:00';

    // Type
    document.querySelectorAll('#habit-type-group .toggle').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === h.type);
    });

    // Schedule mode
    const mode = h.scheduleMode || 'days';
    document.querySelectorAll('#schedule-mode-group .toggle').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === mode);
    });
    document.getElementById('schedule-days-group').style.display = mode === 'days' ? '' : 'none';
    document.getElementById('schedule-weekly-group').style.display = mode === 'weekly' ? '' : 'none';
    document.getElementById('habit-weekly-target').value = h.weeklyTarget || 3;

    // Days
    document.querySelectorAll('#day-select .day-btn').forEach(btn => {
      btn.classList.toggle('selected', (h.schedule || []).includes(Number(btn.dataset.day)));
    });

    renderFormCategories(h.categoryId);
  } else {
    document.getElementById('habit-name').value = '';
    document.getElementById('habit-points').value = 10;
    document.getElementById('habit-notify').checked = false;
    document.getElementById('habit-notify-time').value = '09:00';
    document.querySelectorAll('#habit-type-group .toggle').forEach((btn, i) => {
      btn.classList.toggle('active', i === 0);
    });
    // Schedule mode default
    document.querySelectorAll('#schedule-mode-group .toggle').forEach((btn, i) => {
      btn.classList.toggle('active', i === 0);
    });
    document.getElementById('schedule-days-group').style.display = '';
    document.getElementById('schedule-weekly-group').style.display = 'none';
    document.getElementById('habit-weekly-target').value = 3;
    document.querySelectorAll('#day-select .day-btn').forEach(btn => btn.classList.remove('selected'));
    renderFormCategories(Store.categories()[0]?.id);
  }
}

function renderFormCategories(selectedId) {
  const el = document.getElementById('category-select');
  const cats = Store.categories();
  el.innerHTML = cats.map(c =>
    `<div class="cat-chip ${c.id === selectedId ? 'selected' : ''}" data-cat-id="${c.id}">
      <span class="cat-chip-dot" style="background:${c.color}"></span>
      ${escHtml(c.name)}
    </div>`
  ).join('') + '<div class="cat-chip cat-chip-add" id="form-add-category">+</div>';

  el.querySelectorAll('.cat-chip:not(.cat-chip-add)').forEach(chip => {
    chip.addEventListener('click', () => {
      el.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
    });
  });

  document.getElementById('form-add-category').addEventListener('click', () => {
    openCategoryModal(null, (newCatId) => {
      renderFormCategories(newCatId);
    });
  });
}

function saveHabit() {
  const name = document.getElementById('habit-name').value.trim();
  if (!name) { document.getElementById('habit-name').focus(); return; }

  const type = document.querySelector('#habit-type-group .toggle.active')?.dataset.value || 'positive';
  const categoryId = document.querySelector('#category-select .cat-chip.selected')?.dataset.catId || '';
  const points = Math.max(1, parseInt(document.getElementById('habit-points').value) || 10);
  const scheduleMode = document.querySelector('#schedule-mode-group .toggle.active')?.dataset.value || 'days';
  const schedule = [];
  if (scheduleMode === 'days') {
    document.querySelectorAll('#day-select .day-btn.selected').forEach(btn => {
      schedule.push(Number(btn.dataset.day));
    });
  }
  const weeklyTarget = Math.max(1, Math.min(7, parseInt(document.getElementById('habit-weekly-target').value) || 3));
  const notifyEnabled = document.getElementById('habit-notify').checked;
  const notifyTime = document.getElementById('habit-notify-time').value || '09:00';

  const data = {
    name, type, categoryId, points, scheduleMode, schedule, weeklyTarget,
    notifications: { enabled: notifyEnabled, time: notifyTime }
  };

  if (editingHabitId) {
    Store.updateHabit(editingHabitId, data);
  } else {
    Store.addHabit(data);
  }

  if (notifyEnabled) Notify.init();
  navigateTo('main');
}

function deleteHabit() {
  if (!editingHabitId) return;
  showConfirm('Удалить эту привычку?', () => {
    Store.deleteHabit(editingHabitId);
    editingHabitId = null;
    navigateTo('main');
  });
}


// === HABIT DETAIL ===

let detailHabitId = null;
let detailMonthOffset = 0;

function renderHabitDetail(params) {
  detailHabitId = params?.habitId || detailHabitId;
  if (!params?.keepOffset) detailMonthOffset = 0;

  const h = Store.habit(detailHabitId);
  if (!h) { navigateTo('main'); return; }

  document.getElementById('detail-title').textContent = h.name;

  renderDetailStats(h);
  renderDetailMonth(h);
  renderDetailYear(h);
}

function renderDetailStats(h) {
  const el = document.getElementById('detail-stats');
  const rate = Store.completionRate(h.id);
  const streak = Store.currentStreak(h.id);
  const totalCompletions = Object.keys(h.completions || {}).length;
  const totalPts = totalCompletions * h.points * (h.type === 'positive' ? 1 : -1);
  const cat = Store.category(h.categoryId);

  el.innerHTML = `
    <div class="stat-card highlight">
      <div class="stat-value">${Math.round(rate * 100)}%</div>
      <div class="stat-label">Выполнение за месяц</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${streak}</div>
      <div class="stat-label">Текущая серия (${h.scheduleMode === 'weekly' ? 'недели' : 'дни'})</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${totalCompletions}</div>
      <div class="stat-label">Всего выполнений</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:${h.type === 'positive' ? 'var(--positive)' : 'var(--negative)'}">${totalPts > 0 ? '+' : ''}${totalPts}</div>
      <div class="stat-label">Баллов всего</div>
    </div>
  `;
}

function renderDetailMonth(h) {
  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth() + detailMonthOffset, 1);

  document.getElementById('month-label').textContent =
    MONTH_NAMES[month.getMonth()] + ' ' + month.getFullYear();

  const days = daysInMonth(month.getFullYear(), month.getMonth());
  const firstDow = dayOfWeek(month); // 1=Mon
  const todayStr = today();

  let html = '<div class="cal-header">';
  DAY_SHORT.forEach(d => html += `<div class="cal-day-name">${d}</div>`);
  html += '</div><div class="cal-grid">';

  for (let i = 1; i < firstDow; i++) {
    html += '<div class="cal-cell empty"></div>';
  }

  for (let day = 1; day <= days; day++) {
    const d = new Date(month.getFullYear(), month.getMonth(), day);
    const ds = fmtDate(d);
    const dow = dayOfWeek(d);
    const scheduled = h.scheduleMode === 'weekly' || h.schedule.length === 0 || h.schedule.includes(dow);
    const completed = h.completions && h.completions[ds];
    const isToday = ds === todayStr;

    let cls = 'cal-cell';
    if (!scheduled) cls += ' not-scheduled';
    else if (completed) cls += h.type === 'positive' ? ' completed-positive' : ' completed-negative';
    if (isToday) cls += ' today';

    html += `<div class="${cls}"><span>${day}</span></div>`;
  }

  html += '</div>';
  document.getElementById('month-calendar').innerHTML = html;
}

function renderDetailYear(h) {
  const now = new Date();
  const year = now.getFullYear();
  const monthLabels = ['Я', 'Ф', 'М', 'А', 'М', 'И', 'И', 'А', 'С', 'О', 'Н', 'Д'];

  let html = '<div class="year-bars">';

  for (let m = 0; m < 12; m++) {
    const days = daysInMonth(year, m);
    let scheduled = 0, completed = 0;

    for (let d = 1; d <= days; d++) {
      const date = new Date(year, m, d);
      if (date > now) break;
      const dow = dayOfWeek(date);
      if (h.scheduleMode === 'weekly' || h.schedule.length === 0 || h.schedule.includes(dow)) {
        scheduled++;
        if (h.completions && h.completions[fmtDate(date)]) completed++;
      }
    }

    const rate = scheduled > 0 ? Math.round(completed / scheduled * 100) : 0;

    html += `<div class="year-bar-col">
      <span class="year-bar-value">${rate > 0 ? rate + '%' : ''}</span>
      <div class="year-bar" style="height:${Math.max(rate, 2)}%"></div>
      <span class="year-bar-label">${monthLabels[m]}</span>
    </div>`;
  }

  html += '</div>';
  document.getElementById('year-chart').innerHTML = html;
}


// === SETTINGS ===

function renderSettings() {
  renderSettingsCategories();
  renderDeductionHistory();
}

function renderSettingsCategories() {
  const el = document.getElementById('settings-categories');
  const cats = Store.categories();

  el.innerHTML = cats.map(c =>
    `<div class="cat-row" data-cat-id="${c.id}">
      <div class="cat-row-dot" style="background:${c.color}"></div>
      <span class="cat-row-name">${escHtml(c.name)}</span>
      <span class="cat-row-edit">Изменить</span>
    </div>`
  ).join('');

  el.querySelectorAll('.cat-row').forEach(row => {
    row.addEventListener('click', () => {
      openCategoryModal(row.dataset.catId);
    });
  });
}

function renderDeductionHistory() {
  const el = document.getElementById('deduction-history');
  const deds = Store.deductions();

  if (deds.length === 0) {
    el.innerHTML = '<p style="color:var(--text2);font-size:14px;">Нет списаний</p>';
    return;
  }

  el.innerHTML = [...deds].reverse().map(d =>
    `<div class="deduction-item">
      <div class="ded-info">
        <div class="ded-desc">${escHtml(d.description)}</div>
        <div class="ded-date">${d.date}</div>
      </div>
      <div class="ded-pts">−${d.points}</div>
    </div>`
  ).join('');
}


// === MODALS ===

function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// -- Deduction modal --
function openDeductionModal() {
  document.getElementById('deduct-desc').value = '';
  document.getElementById('deduct-points').value = 10;
  openModal('modal-deduction');
  setTimeout(() => document.getElementById('deduct-desc').focus(), 300);
}

function saveDeduction() {
  const desc = document.getElementById('deduct-desc').value.trim();
  const pts = Math.max(1, parseInt(document.getElementById('deduct-points').value) || 10);
  if (!desc) { document.getElementById('deduct-desc').focus(); return; }
  Store.addDeduction(desc, pts);
  closeModal('modal-deduction');
  renderMain();
}

// -- Category modal --
let editingCatId = null;
let categoryModalCallback = null;

function openCategoryModal(catId, onSave) {
  editingCatId = catId || null;
  categoryModalCallback = onSave || null;
  const isEdit = !!editingCatId;

  document.getElementById('cat-modal-title').textContent = isEdit ? 'Редактировать категорию' : 'Новая категория';
  document.getElementById('cat-delete').style.display = isEdit ? '' : 'none';

  if (isEdit) {
    const cat = Store.category(editingCatId);
    document.getElementById('cat-name').value = cat?.name || '';
    selectColor(cat?.color || '#00B894');
  } else {
    document.getElementById('cat-name').value = '';
    selectColor('#00B894');
  }

  openModal('modal-category');
  setTimeout(() => document.getElementById('cat-name').focus(), 300);
}

function selectColor(color) {
  document.querySelectorAll('#cat-colors .color-opt').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.color === color);
    opt.style.background = opt.dataset.color;
  });
}

function saveCategory() {
  const name = document.getElementById('cat-name').value.trim();
  if (!name) { document.getElementById('cat-name').focus(); return; }
  const color = document.querySelector('#cat-colors .color-opt.selected')?.dataset.color || '#00B894';

  let newCatId = null;
  if (editingCatId) {
    Store.updateCategory(editingCatId, name, color);
  } else {
    const cat = Store.addCategory(name, color);
    newCatId = cat.id;
  }

  closeModal('modal-category');
  if (categoryModalCallback && newCatId) {
    categoryModalCallback(newCatId);
    categoryModalCallback = null;
  } else if (currentScreen === 'settings') {
    renderSettings();
  }
}

function deleteCategoryFromModal() {
  if (!editingCatId) return;
  showConfirm('Удалить категорию? Привычки будут перемещены в первую доступную.', () => {
    Store.deleteCategory(editingCatId);
    editingCatId = null;
    closeModal('modal-category');
    if (currentScreen === 'settings') renderSettings();
  });
}

// -- Confirm modal --
let confirmCallback = null;

function showConfirm(message, onConfirm) {
  document.getElementById('confirm-message').textContent = message;
  confirmCallback = onConfirm;
  openModal('modal-confirm');
}


// === BACKUP ===

function exportData() {
  const json = Store.exportData();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'habit-tracker-backup-' + today() + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importData() {
  document.getElementById('import-file').click();
}

function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    if (Store.importData(reader.result)) {
      renderMain();
      navigateTo('settings');
      alert('Данные успешно импортированы!');
    } else {
      alert('Ошибка: неверный формат файла.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}


// === EVENT SETUP ===

function setupEvents() {
  // Main screen
  document.getElementById('btn-settings').addEventListener('click', () => navigateTo('settings'));
  document.getElementById('btn-add-habit').addEventListener('click', () => navigateTo('habit-form'));
  document.getElementById('btn-deduct').addEventListener('click', openDeductionModal);

  // Back buttons
  document.querySelectorAll('.btn-back').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.screen || 'main';
      navigateTo(target);
    });
  });

  // Habit form
  document.getElementById('btn-save-habit').addEventListener('click', saveHabit);
  document.getElementById('btn-delete-habit').addEventListener('click', deleteHabit);

  // Type toggle
  document.querySelectorAll('#habit-type-group .toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#habit-type-group .toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Schedule mode toggle
  document.querySelectorAll('#schedule-mode-group .toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#schedule-mode-group .toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.value;
      document.getElementById('schedule-days-group').style.display = mode === 'days' ? '' : 'none';
      document.getElementById('schedule-weekly-group').style.display = mode === 'weekly' ? '' : 'none';
    });
  });

  // Day buttons
  document.querySelectorAll('#day-select .day-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('selected'));
  });

  // Notification toggle
  document.getElementById('habit-notify').addEventListener('change', function () {
    if (this.checked) Notify.init();
  });

  // Habit detail
  document.getElementById('btn-edit-habit').addEventListener('click', () => {
    if (detailHabitId) navigateTo('habit-form', { habitId: detailHabitId });
  });

  document.getElementById('month-prev').addEventListener('click', () => {
    detailMonthOffset--;
    const h = Store.habit(detailHabitId);
    if (h) renderDetailMonth(h);
  });

  document.getElementById('month-next').addEventListener('click', () => {
    detailMonthOffset++;
    const h = Store.habit(detailHabitId);
    if (h) renderDetailMonth(h);
  });

  // Settings
  document.getElementById('btn-add-category').addEventListener('click', () => openCategoryModal());
  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('btn-import').addEventListener('click', importData);
  document.getElementById('import-file').addEventListener('change', handleImportFile);

  // Deduction modal
  document.getElementById('deduct-cancel').addEventListener('click', () => closeModal('modal-deduction'));
  document.getElementById('deduct-save').addEventListener('click', saveDeduction);

  // Category modal
  document.getElementById('cat-cancel').addEventListener('click', () => closeModal('modal-category'));
  document.getElementById('cat-save').addEventListener('click', saveCategory);
  document.getElementById('cat-delete').addEventListener('click', deleteCategoryFromModal);

  // Color picker
  document.querySelectorAll('#cat-colors .color-opt').forEach(opt => {
    opt.addEventListener('click', () => selectColor(opt.dataset.color));
  });

  // Confirm modal
  document.getElementById('confirm-cancel').addEventListener('click', () => {
    confirmCallback = null;
    closeModal('modal-confirm');
  });
  document.getElementById('confirm-ok').addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    confirmCallback = null;
    closeModal('modal-confirm');
  });

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('open');
        confirmCallback = null;
      }
    });
  });

  // Auth events
  document.getElementById('btn-login').addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const errEl = document.getElementById('auth-error');
    errEl.style.display = 'none';
    try {
      await Auth.login(email, password);
    } catch (e) {
      errEl.textContent = firebaseErrorMessage(e.code);
      errEl.style.display = '';
    }
  });

  document.getElementById('btn-register').addEventListener('click', async () => {
    const email = document.getElementById('reg-email').value.trim();
    const pw1 = document.getElementById('reg-password').value;
    const pw2 = document.getElementById('reg-password2').value;
    const errEl = document.getElementById('reg-error');
    errEl.style.display = 'none';
    if (pw1 !== pw2) { errEl.textContent = 'Пароли не совпадают'; errEl.style.display = ''; return; }
    try {
      await Auth.register(email, pw1);
    } catch (e) {
      errEl.textContent = firebaseErrorMessage(e.code);
      errEl.style.display = '';
    }
  });

  document.getElementById('link-to-register').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('auth-login-form').style.display = 'none';
    document.getElementById('auth-register-form').style.display = '';
  });

  document.getElementById('link-to-login').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('auth-register-form').style.display = 'none';
    document.getElementById('auth-login-form').style.display = '';
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());

  // Admin panel
  const btnAdmin = document.getElementById('btn-admin-panel');
  if (btnAdmin) btnAdmin.addEventListener('click', () => navigateTo('admin'));
}


// === INIT ===

document.addEventListener('DOMContentLoaded', async () => {
  // Skip animation for initial screen
  const authScreen = document.getElementById('screen-auth');
  authScreen.classList.add('no-transition');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      authScreen.classList.remove('no-transition');
    });
  });

  setupEvents();

  // Auth will trigger navigation to main or stay on auth
  await Auth.init();

  // Register SW
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch (e) {
      console.log('SW registration failed:', e);
    }
  }

  // Init notifications if any habit uses them
  if (Store._data) {
    const hasNotifications = Store.habits().some(h => h.notifications?.enabled);
    if (hasNotifications) Notify.init();
  }
});
