// ====== Shared interactions (multi-page site) ======
(function () {
  'use strict';

  var nav = document.getElementById('nav');
  var navToggle = document.getElementById('navToggle');
  var navLinks = document.getElementById('navLinks');
  var toTop = document.getElementById('toTop');

  // --- Nav shadow on scroll + back-to-top visibility ---
  function onScroll() {
    var y = window.scrollY;
    if (nav) nav.classList.toggle('is-scrolled', y > 10);
    if (toTop) toTop.classList.toggle('is-visible', y > 500);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // --- Mobile menu toggle ---
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var open = navToggle.classList.toggle('is-open');
      navLinks.classList.toggle('is-open', open);
      navToggle.setAttribute('aria-expanded', String(open));
    });

    navLinks.addEventListener('click', function (e) {
      if (e.target.classList.contains('nav__link')) {
        navToggle.classList.remove('is-open');
        navLinks.classList.remove('is-open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // --- Back to top ---
  if (toTop) {
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // --- Reveal-on-scroll animations ---
  var revealTargets = document.querySelectorAll(
    '.hero__text > *, .hero__avatar, .like, .about-block, .project, .tl-item, .edu-item, .card, .channel, .form, .page__head, .section__head, .todo, .weather'
  );
  if ('IntersectionObserver' in window) {
    revealTargets.forEach(function (el, i) {
      el.classList.add('reveal');
      el.style.transitionDelay = (i % 4) * 0.08 + 's';
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealTargets.forEach(function (el) { io.observe(el); });
  }

  // --- Contact form: friendly client-side handling ---
  var form = document.getElementById('contactForm');
  if (form) {
    var success = document.getElementById('formSuccess');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.querySelector('#name');
      var email = form.querySelector('#email');
      var message = form.querySelector('#message');

      // Simple, gentle validation
      if (!name.value.trim() || !email.value.trim() || !message.value.trim()) {
        // Highlight the first empty required field
        if (!name.value.trim()) { name.focus(); return; }
        if (!email.value.trim()) { email.focus(); return; }
        message.focus();
        return;
      }
      // Basic email check
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
        email.focus();
        return;
      }

      if (success) {
        success.classList.add('is-visible');
        success.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      form.reset();
      // Hide the success message after a few seconds
      setTimeout(function () {
        if (success) success.classList.remove('is-visible');
      }, 6000);
    });
  }
})();

// ====== To-Do app (Projects page) ======
(function () {
  'use strict';

  var app = document.getElementById('todoApp');
  if (!app) return;

  var grid = app.querySelector('[data-cal-grid]');
  var titleEl = app.querySelector('[data-cal-title]');
  var prevBtn = app.querySelector('[data-cal-prev]');
  var nextBtn = app.querySelector('[data-cal-next]');
  var form = app.querySelector('[data-todo-form]');
  var input = app.querySelector('[data-todo-input]');
  var listEl = app.querySelector('[data-todo-list]');
  var emptyEl = app.querySelector('[data-todo-empty]');
  var countEl = app.querySelector('[data-todo-count]');
  var dateLabel = app.querySelector('[data-todo-date]');
  var pickerEl = app.querySelector('[data-todo-picker]');

  var MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // ---- Supabase ----
  var SB_URL = 'https://txoxgqmifewlzqmmeaxu.supabase.co';
  var SB_KEY = 'sb_publishable_uF58wWgaxnILVZi1hRApNw_3qSd8xNR';
  var sb = (window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(SB_URL, SB_KEY)
    : null;

  var viewDate = new Date();        // the month currently displayed
  var selectedDate = today();       // the date new tasks will attach to (defaults to today)
  var selectedEmoji = '';           // currently picked emoji tag ('' = none)
  var selectedPriority = 'medium';  // currently picked priority
  var editingId = null;             // id of the task currently being inline-edited

  var tasks = [];                   // loaded from Supabase on init

  // ---- Date helpers ----
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function fromKey(key) { var p = key.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function formatDate(d) { return MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  function formatDateShort(d) { return MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate(); }
  function priLabel(p) { return p === 'high' ? 'High' : p === 'low' ? 'Low' : 'Med'; }

  // ---- Supabase data layer ----
  // Map a DB row to the in-memory task shape the app already uses.
  // DB columns: task, is_complete, date, emoji, priority, created_at
  // Only trust short, non-ASCII emoji values — guards against malformed
  // column defaults (e.g. the literal string '"::text').
  function cleanEmoji(v) {
    v = String(v || '');
    return v.length <= 4 && /[^\u0000-\u007F]/.test(v) ? v : '';
  }
  function cleanPriority(v) {
    return (v === 'low' || v === 'high' || v === 'medium') ? v : 'medium';
  }

  function normalizeRow(r) {
    return {
      id: String(r.id),
      text: r.task || '',
      date: r.date || toKey(today()),
      done: !!r.is_complete,
      emoji: cleanEmoji(r.emoji),
      priority: cleanPriority(r.priority),
      created: r.created_at ? new Date(r.created_at).getTime() : Date.now()
    };
  }

  // Read all todos ordered by creation time (oldest first).
  async function loadTasks() {
    if (!sb) return [];
    var res = await sb.from('todos').select('*').order('created_at', { ascending: true });
    if (res.error) { console.error('[todo] load failed:', res.error); return []; }
    return (res.data || []).map(normalizeRow);
  }

  // Insert a new todo; returns the server-created row (with id + created_at).
  // Sends all app columns: task, date, is_complete, emoji, priority.
  // (Explicit values avoid the table's malformed column defaults.)
  async function insertTask(payload) {
    if (!sb) return null;
    var row = {
      task: payload.task,
      date: payload.date,
      is_complete: payload.is_complete,
      emoji: payload.emoji || '',
      priority: payload.priority || 'medium'
    };
    var res = await sb.from('todos').insert(row).select();
    if (res.error) { console.error('[todo] insert failed:', res.error); return null; }
    return res.data && res.data[0] ? normalizeRow(res.data[0]) : null;
  }

  async function updateTask(id, patch) {
    if (!sb) return;
    var res = await sb.from('todos').update(patch).eq('id', id);
    if (res.error) console.error('[todo] update failed:', res.error);
  }

  async function deleteTask(id) {
    if (!sb) return;
    var res = await sb.from('todos').delete().eq('id', id);
    if (res.error) console.error('[todo] delete failed:', res.error);
  }

  // Reload from the server and re-render (used to recover from sync errors).
  async function reload() {
    tasks = await loadTasks();
    render();
  }

  // ---- Calendar ----
  function renderCalendar() {
    titleEl.textContent = MONTHS_LONG[viewDate.getMonth()] + ' ' + viewDate.getFullYear();

    var year = viewDate.getFullYear();
    var month = viewDate.getMonth();
    var first = new Date(year, month, 1);
    var startDay = first.getDay();                                   // 0 = Sunday
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var prevDays = new Date(year, month, 0).getDate();

    var todayK = toKey(today());
    var selectedK = toKey(selectedDate);
    var taskDates = {};
    tasks.forEach(function (t) { taskDates[t.date] = true; });

    var html = '';
    // Leading cells (previous month)
    for (var i = startDay - 1; i >= 0; i--) {
      var pd = prevDays - i;
      html += '<button type="button" class="cal__day is-other" data-day="' + pd + '" data-jump="prev">' + pd + '</button>';
    }
    // Current month days
    for (var day = 1; day <= daysInMonth; day++) {
      var cellDate = new Date(year, month, day);
      var key = toKey(cellDate);
      var classes = 'cal__day';
      if (key === todayK) classes += ' is-today';
      if (key === selectedK) classes += ' is-selected';
      if (taskDates[key]) classes += ' has-tasks';
      html += '<button type="button" class="' + classes + '" data-day="' + day + '">' + day + '</button>';
    }
    // Trailing cells (next month) to complete the final week
    var totalCells = startDay + daysInMonth;
    var trailing = (7 - (totalCells % 7)) % 7;
    for (var t = 1; t <= trailing; t++) {
      html += '<button type="button" class="cal__day is-other" data-day="' + t + '" data-jump="next">' + t + '</button>';
    }

    grid.innerHTML = html;
  }

  // ---- List ----
  function renderList() {
    var sorted = tasks.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.created - b.created;
    });
    listEl.innerHTML = '';
    sorted.forEach(function (t) {
      var li = document.createElement('li');
      li.className = 'todo__item' + (t.done ? ' is-done' : '');
      li.dataset.id = t.id;
      var d = fromKey(t.date);
      li.innerHTML =
        '<input type="checkbox" class="todo__check" data-todo-toggle' + (t.done ? ' checked' : '') + ' aria-label="Mark task done" />' +
        (t.emoji ? '<span class="todo__emoji" aria-hidden="true">' + t.emoji + '</span>' : '') +
        '<div class="todo__content">' +
          '<span class="todo__text" role="button" tabindex="0" title="Click to edit"></span>' +
          '<span class="todo__when">' + formatDateShort(d) + '</span>' +
        '</div>' +
        '<span class="todo__pri todo__pri--' + t.priority + '">' + priLabel(t.priority) + '</span>' +
        '<button type="button" class="todo__del" data-todo-del aria-label="Delete task">×</button>';
      li.querySelector('.todo__text').textContent = t.text;   // safe text injection
      listEl.appendChild(li);
    });
    emptyEl.style.display = sorted.length ? 'none' : 'block';
    renderCount();
  }

  function renderCount() {
    var total = tasks.length;
    var done = tasks.filter(function (t) { return t.done; }).length;
    if (total) {
      countEl.classList.add('is-visible');
      countEl.classList.toggle('is-complete', done === total);
      countEl.innerHTML = '<strong>' + done + ' of ' + total + '</strong> tasks completed';
    } else {
      countEl.classList.remove('is-visible');
      countEl.classList.remove('is-complete');
    }
  }

  function renderDateLabel() {
    dateLabel.innerHTML = 'Adding for <strong>' + formatDate(selectedDate) + '</strong>';
  }

  function render() { renderCalendar(); renderList(); renderDateLabel(); }

  // ---- Events: month navigation ----
  prevBtn.addEventListener('click', function () {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
    renderCalendar();
  });
  nextBtn.addEventListener('click', function () {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    renderCalendar();
  });

  // ---- Events: date selection (delegated) ----
  grid.addEventListener('click', function (e) {
    var btn = e.target.closest('.cal__day');
    if (!btn) return;
    var day = parseInt(btn.dataset.day, 10);
    var jump = btn.dataset.jump;
    var year = viewDate.getFullYear();
    var month = viewDate.getMonth();
    if (jump === 'prev') { month -= 1; if (month < 0) { month = 11; year -= 1; } }
    else if (jump === 'next') { month += 1; if (month > 11) { month = 0; year += 1; } }
    selectedDate = new Date(year, month, day);
    selectedDate.setHours(0, 0, 0, 0);
    // If the chosen day lives in a neighbouring month, bring it into view
    if (selectedDate.getMonth() !== viewDate.getMonth() || selectedDate.getFullYear() !== viewDate.getFullYear()) {
      viewDate = new Date(year, month, 1);
    }
    renderCalendar();
    renderDateLabel();
    input.focus();
  });

  // ---- Events: emoji + priority picker (delegated) ----
  pickerEl.addEventListener('click', function (e) {
    var emojiBtn = e.target.closest('[data-emoji]');
    var priBtn = e.target.closest('[data-pri]');
    if (emojiBtn) {
      // Toggle: clicking the active emoji clears it, otherwise swap selection
      var wasActive = emojiBtn.classList.contains('is-active');
      pickerEl.querySelectorAll('[data-emoji]').forEach(function (b) { b.classList.remove('is-active'); });
      if (wasActive) { selectedEmoji = ''; }
      else { emojiBtn.classList.add('is-active'); selectedEmoji = emojiBtn.dataset.emoji; }
      return;
    }
    if (priBtn) {
      pickerEl.querySelectorAll('[data-pri]').forEach(function (b) { b.classList.remove('is-active'); });
      priBtn.classList.add('is-active');
      selectedPriority = priBtn.dataset.pri;
    }
  });

  // ---- Events: add task ----
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    var payload = {
      task: text,
      date: toKey(selectedDate),
      is_complete: false,
      emoji: selectedEmoji,
      priority: selectedPriority
    };
    // Optimistic: show the task immediately with a temporary id.
    var tempId = 'tmp' + Date.now();
    tasks.push({
      id: tempId,
      text: payload.text,
      date: payload.date,
      done: false,
      created: Date.now(),
      emoji: payload.emoji,
      priority: payload.priority
    });
    input.value = '';
    selectedEmoji = '';
    pickerEl.querySelectorAll('[data-emoji].is-active').forEach(function (b) { b.classList.remove('is-active'); });
    render();
    input.focus();

    // Sync to Supabase and swap the temp id for the real server row.
    var real = await insertTask(payload);
    if (!real) {
      // Insert failed — roll the optimistic task back out.
      tasks = tasks.filter(function (t) { return t.id !== tempId; });
      render();
      return;
    }
    tasks = tasks.map(function (t) { return t.id === tempId ? real : t; });
    render();
  });

  // ---- Events: inline edit + delete (delegated) ----
  listEl.addEventListener('click', function (e) {
    // Click the task text to edit it inline
    var textSpan = e.target.closest('.todo__text');
    if (textSpan) {
      var li = textSpan.closest('.todo__item');
      var task = tasks.find(function (t) { return t.id === li.dataset.id; });
      if (task) beginEdit(li, task);
      return;
    }
    var delBtn = e.target.closest('[data-todo-del]');
    if (!delBtn) return;
    var delLi = delBtn.closest('.todo__item');
    if (!delLi) return;
    var id = delLi.dataset.id;
    // Optimistic remove, then sync to the database.
    tasks = tasks.filter(function (t) { return t.id !== id; });
    render();
    deleteTask(id);
  });

  // ---- Events: toggle done (delegated, change fires for label-box clicks too) ----
  listEl.addEventListener('change', function (e) {
    if (!e.target.matches('[data-todo-toggle]')) return;
    var li = e.target.closest('.todo__item');
    if (!li) return;
    var task = tasks.find(function (t) { return t.id === li.dataset.id; });
    if (!task) return;
    task.done = e.target.checked;
    li.classList.toggle('is-done', task.done);
    renderCount();
    updateTask(task.id, { is_complete: task.done });
  });

  // ---- Inline editing helpers ----
  function beginEdit(li, task) {
    if (editingId) return;                       // only one edit at a time
    var span = li.querySelector('.todo__text');
    if (!span) return;
    editingId = task.id;
    li.classList.add('is-editing');
    var field = document.createElement('input');
    field.type = 'text';
    field.className = 'todo__edit';
    field.value = task.text;
    field.setAttribute('aria-label', 'Edit task');
    field.setAttribute('autocomplete', 'off');
    span.replaceWith(field);
    field.focus();
    field.select();
  }

  function finishEdit(field, save) {
    if (!editingId) return;
    var id = editingId;
    editingId = null;
    var task = tasks.find(function (t) { return t.id === id; });
    var next = field.value.trim();
    if (save && task && next) {                  // blank input cancels instead of clearing
      task.text = next;
      updateTask(task.id, { task: next });
    }
    render();                                    // rebuilds the list, dropping the input
  }

  // Enter saves, Escape cancels; Enter/Space on a title starts editing
  listEl.addEventListener('keydown', function (e) {
    // role=button activation: focus a title, press Enter/Space to edit
    if (e.target.classList && e.target.classList.contains('todo__text')) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        var li = e.target.closest('.todo__item');
        var task = tasks.find(function (t) { return t.id === li.dataset.id; });
        if (task) beginEdit(li, task);
      }
      return;
    }
    if (!e.target.classList || !e.target.classList.contains('todo__edit')) return;
    if (e.key === 'Enter') { e.preventDefault(); finishEdit(e.target, true); }
    else if (e.key === 'Escape') { e.preventDefault(); finishEdit(e.target, false); }
  });

  // Clicking away also saves (fires before render tears the field down)
  listEl.addEventListener('focusout', function (e) {
    if (!e.target.classList || !e.target.classList.contains('todo__edit')) return;
    finishEdit(e.target, true);
  });

  // Render the shell immediately, then hydrate with tasks from Supabase.
  render();
  (async function init() {
    tasks = await loadTasks();
    render();
  })();
})();

// ====== Weather app (Projects page) ======
// UAPI Weather API — free, keyless endpoint. Data comes back in Chinese;
// icon codes follow the QWeather standard and are mapped to emoji + English.
(function () {
  'use strict';

  var app = document.getElementById('weatherApp');
  if (!app) return;

  var API_URL = 'https://uapis.cn/api/v1/misc/weather';

  // Pinyin names shared by multiple Chinese cities. The API's text search can
  // only return one of them (often the wrong, smaller one), so for these names
  // we ask the user which city they mean, then fetch by exact `adcode`.
  // Every adcode below was verified against the live API.
  var AMBIGUOUS = {
    suzhou: [
      { name: 'Suzhou', zh: '苏州市', region: 'Jiangsu', adcode: '320500' },
      { name: 'Suzhou', zh: '宿州市', region: 'Anhui', adcode: '341300' }
    ],
    taizhou: [
      { name: 'Taizhou', zh: '台州市', region: 'Zhejiang', adcode: '331000' },
      { name: 'Taizhou', zh: '泰州市', region: 'Jiangsu', adcode: '321200' }
    ],
    yulin: [
      { name: 'Yulin', zh: '玉林市', region: 'Guangxi', adcode: '450900' },
      { name: 'Yulin', zh: '榆林市', region: 'Shaanxi', adcode: '610800' }
    ],
    yichun: [
      { name: 'Yichun', zh: '宜春市', region: 'Jiangxi', adcode: '360900' },
      { name: 'Yichun', zh: '伊春市', region: 'Heilongjiang', adcode: '230700' }
    ],
    fuzhou: [
      { name: 'Fuzhou', zh: '福州市', region: 'Fujian', adcode: '350100' },
      { name: 'Fuzhou', zh: '抚州市', region: 'Jiangxi', adcode: '361000' }
    ],
    chaoyang: [
      { name: 'Chaoyang', zh: '朝阳区', region: 'Beijing', adcode: '110105' },
      { name: 'Chaoyang', zh: '朝阳市', region: 'Liaoning', adcode: '211300' }
    ],
    baoshan: [
      { name: 'Baoshan', zh: '宝山区', region: 'Shanghai', adcode: '310113' },
      { name: 'Baoshan', zh: '保山市', region: 'Yunnan', adcode: '530500' }
    ],
    fuyang: [
      { name: 'Fuyang', zh: '阜阳市', region: 'Anhui', adcode: '341200' },
      { name: 'Fuyang', zh: '富阳区', region: 'Zhejiang', adcode: '330111' }
    ]
  };

  var form = app.querySelector('[data-weather-form]');
  var input = app.querySelector('[data-weather-input]');
  var btn = app.querySelector('[data-weather-btn]');
  var result = app.querySelector('[data-weather-result]');

  // QWeather icon code -> { label (English), emoji }
  var ICON_MAP = {
    '100': ['Clear', '☀️'],
    '101': ['Cloudy', '⛅'],
    '102': ['Few Clouds', '🌤️'],
    '103': ['Partly Cloudy', '🌤️'],
    '104': ['Overcast', '☁️'],
    '150': ['Clear Night', '🌙'],
    '151': ['Few Clouds', '🌙'],
    '152': ['Partly Cloudy', '🌙'],
    '153': ['Cloudy Night', '☁️'],
    '154': ['Overcast Night', '☁️'],
    '300': ['Shower Rain', '🌦️'],
    '301': ['Heavy Shower Rain', '🌧️'],
    '302': ['Thunder Shower', '⛈️'],
    '303': ['Heavy Thunderstorm', '⛈️'],
    '304': ['Hail', '🧊'],
    '305': ['Light Rain', '🌦️'],
    '306': ['Moderate Rain', '🌧️'],
    '307': ['Heavy Rain', '🌧️'],
    '308': ['Extreme Rain', '🌧️'],
    '309': ['Drizzle', '🌦️'],
    '310': ['Storm Rain', '🌧️'],
    '311': ['Heavy Storm Rain', '🌧️'],
    '312': ['Severe Storm Rain', '🌧️'],
    '313': ['Freezing Rain', '🌧️'],
    '314': ['Light Shower Rain', '🌦️'],
    '315': ['Moderate Shower Rain', '🌧️'],
    '316': ['Heavy Shower Rain', '🌧️'],
    '317': ['Light Storm Rain', '🌧️'],
    '318': ['Storm Rain', '⛈️'],
    '350': ['Shower Rain', '🌦️'],
    '351': ['Heavy Shower Rain', '🌧️'],
    '399': ['Rain', '🌧️'],
    '400': ['Light Snow', '🌨️'],
    '401': ['Moderate Snow', '🌨️'],
    '402': ['Heavy Snow', '❄️'],
    '403': ['Snow Shower', '🌨️'],
    '404': ['Snow Flurry', '🌨️'],
    '405': ['Light Snow', '🌨️'],
    '406': ['Moderate Snow', '🌨️'],
    '407': ['Heavy Snow', '❄️'],
    '408': ['Sleet', '🌨️'],
    '409': ['Rain to Snow', '🌨️'],
    '410': ['Snow to Rain', '🌨️'],
    '456': ['Snow Shower', '🌨️'],
    '457': ['Snow Shower', '❄️'],
    '499': ['Snow', '❄️'],
    '500': ['Mist', '🌫️'],
    '501': ['Fog', '🌫️'],
    '502': ['Haze', '🌫️'],
    '503': ['Drifting Dust', '🌪️'],
    '504': ['Dust', '🌪️'],
    '507': ['Sandstorm', '🌪️'],
    '508': ['Severe Sandstorm', '🌪️'],
    '509': ['Fog', '🌫️'],
    '510': ['Fog', '🌫️'],
    '511': ['Haze', '🌫️'],
    '512': ['Haze', '🌫️'],
    '513': ['Haze', '🌫️'],
    '514': ['Fog', '🌫️'],
    '515': ['Haze', '🌫️'],
    '900': ['Hot', '🥵'],
    '901': ['Cold', '🥶'],
    '999': ['Unknown', '🌡️']
  };

  // Fallback mapping from Chinese condition text (used if the code is unknown)
  var WIND_EN = {
    '东风': 'E', '南风': 'S', '西风': 'W', '北风': 'N',
    '东北风': 'NE', '东南风': 'SE', '西北风': 'NW', '西南风': 'SW'
  };

  var requestSeq = 0; // ignore stale responses from earlier searches

  // Temperature unit preference, persisted across visits
  function loadUnit() {
    try { return localStorage.getItem('weatherUnit') === 'F' ? 'F' : 'C'; }
    catch (e) { return 'C'; }
  }
  function saveUnit(u) {
    try { localStorage.setItem('weatherUnit', u); } catch (e) { /* private mode etc. */ }
  }

  var unit = loadUnit();
  var lastData = null; // last weather payload, so toggling units needs no new API call

  // The API always returns Celsius; convert for display only
  function convertTemp(celsius) {
    var c = Number(celsius) || 0;
    return unit === 'F' ? Math.round(c * 9 / 5 + 32) : Math.round(c);
  }

  // Small °C / °F segmented control shown on the weather card
  function unitToggle() {
    var wrap = el('div', 'weather__units');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Temperature unit');

    ['C', 'F'].forEach(function (u) {
      var b = el('button', 'weather__unit' + (u === unit ? ' is-active' : ''), '°' + u);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(u === unit));
      b.addEventListener('click', function () {
        if (u === unit) return;
        unit = u;
        saveUnit(u);
        if (lastData) showWeather(lastData); // re-render instantly, no refetch
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // Resolve icon code -> { label, emoji }, with range + Chinese-text fallbacks
  function describe(data) {
    var code = String(data.weather_icon || '').trim();
    if (ICON_MAP[code]) {
      return { label: ICON_MAP[code][0], emoji: ICON_MAP[code][1] };
    }
    var n = parseInt(code, 10);
    if (!isNaN(n)) {
      if (n >= 300 && n < 400) return { label: 'Rain', emoji: '🌧️' };
      if (n >= 400 && n < 500) return { label: 'Snow', emoji: '🌨️' };
      if (n >= 500 && n < 503) return { label: 'Fog', emoji: '🌫️' };
      if (n >= 503 && n < 600) return { label: 'Dust', emoji: '🌪️' };
      if (n >= 150 && n < 200) return { label: 'Clear Night', emoji: '🌙' };
      if (n >= 100 && n < 200) return { label: 'Cloudy', emoji: '⛅' };
    }
    var cn = String(data.weather || '');
    if (cn.indexOf('雷') !== -1) return { label: 'Thunderstorm', emoji: '⛈️' };
    if (cn.indexOf('雪') !== -1) return { label: 'Snow', emoji: '🌨️' };
    if (cn.indexOf('雨') !== -1) return { label: 'Rain', emoji: '🌧️' };
    if (cn.indexOf('雾') !== -1 || cn.indexOf('霾') !== -1) return { label: 'Fog', emoji: '🌫️' };
    if (cn.indexOf('沙') !== -1 || cn.indexOf('尘') !== -1) return { label: 'Sandstorm', emoji: '🌪️' };
    if (cn.indexOf('晴') !== -1) return { label: 'Clear', emoji: '☀️' };
    if (cn.indexOf('阴') !== -1) return { label: 'Overcast', emoji: '☁️' };
    if (cn.indexOf('云') !== -1) return { label: 'Cloudy', emoji: '⛅' };
    return { label: cn || 'Unknown', emoji: '🌡️' };
  }

  // "4级" -> "4", "东北风" -> "NE"
  function windText(data) {
    var dir = WIND_EN[data.wind_direction] || data.wind_direction || '';
    var power = String(data.wind_power || '').replace('级', '').trim();
    return power ? dir + ' · Level ' + power : dir;
  }

  // Translate the Chinese "x 分钟前发布" style timestamp
  function timeText(t) {
    var s = String(t || '').trim();
    var min = s.match(/(\d+)\s*分钟/);
    if (min) return 'Updated ' + min[1] + ' min ago';
    var hr = s.match(/(\d+)\s*小时/);
    if (hr) return 'Updated ' + hr[1] + ' hr ago';
    if (s.indexOf('刚') !== -1) return 'Updated just now';
    return s ? 'Updated ' + s : '';
  }

  function showLoading() {
    result.innerHTML = '';
    var msg = el('p', 'weather__msg');
    msg.appendChild(el('span', 'weather__spinner'));
    msg.appendChild(document.createTextNode('Loading…'));
    result.appendChild(msg);
  }

  function showMessage(text, kind) {
    result.innerHTML = '';
    result.appendChild(el('p', 'weather__msg weather__msg--' + (kind || 'warn'), text));
  }

  // One pinyin spelling matches several real cities — let the user pick one,
  // then fetch its weather with the exact adcode (no guessing, no API call here)
  function showChoices(choices) {
    requestSeq++; // any in-flight text search is now irrelevant
    setLoading(false);
    result.innerHTML = '';

    var box = el('div', 'weather__choices');
    box.appendChild(el('p', 'weather__choices-title', 'Which city do you mean?'));

    choices.forEach(function (c) {
      var chip = el('button', 'weather__chip');
      chip.type = 'button';

      var left = el('span', 'weather__chip-main');
      left.appendChild(el('b', null, c.name));
      left.appendChild(el('small', null, c.region));
      chip.appendChild(left);
      chip.appendChild(el('span', 'weather__chip-zh', c.zh));

      chip.addEventListener('click', function () {
        search('adcode=' + encodeURIComponent(c.adcode));
      });
      box.appendChild(chip);
    });

    box.appendChild(el('p', 'weather__choices-tip',
      'Tip: typing Chinese (苏州) or province + name (江苏苏州) goes straight there.'));
    result.appendChild(box);
  }

  function showWeather(data) {
    var info = describe(data);
    lastData = data; // keep for instant °C/°F switching without refetching
    result.innerHTML = '';

    var card = el('div', 'weather__card');

    var top = el('div', 'weather__card-top');
    var topLeft = el('div');
    topLeft.appendChild(el('p', 'weather__city', data.district || data.city || 'Unknown city'));
    topLeft.appendChild(el('p', 'weather__region', data.province || ''));
    top.appendChild(topLeft);
    var topRight = el('div', 'weather__card-aside');
    topRight.appendChild(unitToggle());
    var updated = timeText(data.report_time);
    if (updated) topRight.appendChild(el('p', 'weather__updated', updated));
    top.appendChild(topRight);
    card.appendChild(top);

    var main = el('div', 'weather__card-main');
    main.appendChild(el('span', 'weather__icon', info.emoji));
    var tempWrap = el('div');
    var temp = el('p', 'weather__temp');
    temp.appendChild(document.createTextNode(String(convertTemp(data.temperature))));
    temp.appendChild(el('span', null, '°' + unit));
    tempWrap.appendChild(temp);
    tempWrap.appendChild(el('p', 'weather__cond', info.label));
    main.appendChild(tempWrap);
    card.appendChild(main);

    var meta = el('div', 'weather__meta');
    var humidity = el('div', 'weather__meta-item');
    humidity.appendChild(el('span', null, '💧'));
    var humBox = el('p');
    humBox.appendChild(el('strong', null, (data.humidity != null ? data.humidity : '—') + '%'));
    humBox.appendChild(el('small', null, 'Humidity'));
    humidity.appendChild(humBox);
    meta.appendChild(humidity);

    var wind = el('div', 'weather__meta-item');
    wind.appendChild(el('span', null, '🌬️'));
    var windBox = el('p');
    windBox.appendChild(el('strong', null, windText(data) || '—'));
    windBox.appendChild(el('small', null, 'Wind'));
    wind.appendChild(windBox);
    meta.appendChild(wind);
    card.appendChild(meta);

    result.appendChild(card);
  }

  function setLoading(isLoading) {
    btn.disabled = isLoading;
    btn.textContent = isLoading ? 'Searching…' : 'Search';
  }

  // `query` is an already-built query string, e.g. "city=Beijing" or "adcode=320500"
  async function search(query) {
    var seq = ++requestSeq;
    showLoading();
    setLoading(true);
    try {
      var res = await fetch(API_URL + '?' + query, { headers: { 'Accept': 'application/json' } });
      var data = null;
      try { data = await res.json(); } catch (e) { /* non-JSON response */ }

      if (seq !== requestSeq) return; // a newer search superseded this one

      if (!res.ok || (data && (data.error || data.code))) {
        // 404 LOCATION_NOT_FOUND or any business error -> city not found
        showMessage('Couldn\u2019t find that city \u2014 check the spelling.', 'error');
        return;
      }
      if (!data || typeof data.temperature === 'undefined') {
        showMessage('Something went wrong on our side. Please try again.', 'error');
        return;
      }
      showWeather(data);
    } catch (err) {
      if (seq !== requestSeq) return;
      showMessage('Network problem \u2014 check your connection and try again.', 'error');
    } finally {
      if (seq === requestSeq) setLoading(false);
    }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var city = input.value.trim();
    if (!city) {
      // Empty search: message only, never call the API
      showMessage('Enter a city first.', 'warn');
      input.focus();
      return;
    }
    // Exact 6-digit administrative code -> look up by adcode, never ambiguous
    if (/^\d{6}$/.test(city)) {
      search('adcode=' + encodeURIComponent(city));
      return;
    }
    // One pinyin spelling, several cities -> ask which one before calling the API
    var choices = AMBIGUOUS[city.toLowerCase()];
    if (choices) {
      showChoices(choices);
      return;
    }
    search('city=' + encodeURIComponent(city));
  });
})();
