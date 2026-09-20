/* ============================================================
   FitFlow client — no build step, no framework.
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

// Nutrition is rendered asynchronously, so bind this action to the stable app
// container instead of a one-off button node that can be replaced on rerender.
app.addEventListener('click', (event) => {
  if (event.target.closest?.('#manualBtn')) logSheet();
});

const state = {
  token: localStorage.getItem('ff_token') || null,
  user: null,
  route: 'summary',
  cache: {},
};

/* ---------- utils ---------- */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const round = (n) => Math.round(Number(n) || 0);
const clampPct = (v, t) => (t > 0 ? Math.min(100, Math.max(0, (v / t) * 100)) : 0);

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

let toastTimer;
function toast(msg, kind = 'ok') {
  $('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}

/* ---------- api ---------- */

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = {};
  try { data = await res.json(); } catch {}

  if (res.status === 401 && state.token) {
    signOut();
    throw new Error('Your session expired. Sign in again.');
  }
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}

/* ---------- icons ---------- */

const ICONS = {
  summary: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  workout: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11"/>',
  nutrition: '<path d="M12 21c-4 0-7-3.5-7-8 0-3 2-6 4.5-6 1.2 0 2 .6 2.5 1.2.5-.6 1.3-1.2 2.5-1.2C17 7 19 10 19 13c0 4.5-3 8-7 8z"/><path d="M12 7V3M12 3l2.5 1.5"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
};

const RUNNER_ART = `
  <svg viewBox="0 0 430 270" role="img" aria-label="Playful illustration of a runner in motion">
    <path class="art-blob" d="M42 184c-16-65 43-136 127-137 42-1 60 22 99 17 58-7 102 19 111 71 11 62-45 98-118 92-52-4-86 22-145 7-39-10-65-23-74-50Z"/>
    <circle class="art-sun" cx="365" cy="56" r="18"/>
    <path class="art-line" d="M365 22v-12M365 102V90M399 56h13M319 56h13M389 32l9-9M332 89l9-9"/>
    <path class="art-limb" d="M230 118c-31 22-62 39-98 49"/>
    <path class="art-leg" d="M246 165c-31 21-58 43-81 72"/>
    <path class="art-leg" d="M276 166c34 20 60 34 96 37"/>
    <path class="art-shoe" d="M165 237c-13 7-27 9-42 4 9-10 18-17 30-22"/>
    <path class="art-shoe" d="M370 202c17-4 31-1 43 8-13 7-29 8-45 3"/>
    <path class="art-shirt" d="M213 89c24-18 65-10 82 15l-14 67-66-3-20-48Z"/>
    <path class="art-shorts" d="M215 157h72l-8 31-32-9-28 14-19-20Z"/>
    <circle class="art-skin" cx="276" cy="75" r="27"/>
    <path class="art-hair" d="M249 77c-9-26 14-46 39-36 15 6 19 19 17 31-9-12-24-11-34-5-6 4-14 10-22 10Z"/>
    <path class="art-limb" d="M284 111c27 17 50 23 79 14"/>
    <path class="art-hand" d="M362 125l18-13"/>
    <circle class="art-eye" cx="285" cy="75" r="3"/>
    <path class="art-smile" d="M288 87c7 4 12 3 16-1"/>
    <path class="art-speed" d="M70 133h55M85 151h33M330 176h48"/>
  </svg>`;

const TYPE_META = {
  strength: { emoji: '🏋️', color: 'var(--workout)' },
  cardio: { emoji: '🏃', color: 'var(--nutrition)' },
  flexibility: { emoji: '🧘', color: 'var(--profile)' },
  sport: { emoji: '⚽', color: 'var(--success)' },
};

const MEAL_META = {
  breakfast: { emoji: '🌅', label: 'Breakfast' },
  lunch: { emoji: '☀️', label: 'Lunch' },
  dinner: { emoji: '🌙', label: 'Dinner' },
  snack: { emoji: '🍎', label: 'Snack' },
};

/* ---------- activity ring (canvas) ---------- */

function drawRing(canvas, rings) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const size = 200;
  canvas.width = size * dpr;
  canvas.height = size * dpr;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2, cy = size / 2;
  const start = -Math.PI / 2;

  rings.forEach((ring, i) => {
    const radius = 84 - i * 21;
    const width = 13;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(24,32,52,0.08)';
    ctx.lineWidth = width;
    ctx.stroke();

    const pct = Math.max(0, Math.min(1, ring.value / (ring.target || 1)));
    if (pct <= 0) return;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + pct * Math.PI * 2);
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.shadowColor = ring.color;
    ctx.shadowBlur = 11;
    ctx.stroke();
    ctx.shadowBlur = 0;
  });
}

function animateRing(canvas, rings) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    drawRing(canvas, rings);
    return;
  }
  const t0 = performance.now();
  const dur = 850;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    drawRing(canvas, rings.map((r) => ({ ...r, value: r.value * eased })));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- modal ---------- */

function openSheet(title, innerHTML, onMount) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', title);
  wrap.innerHTML = `<div class="sheet"><div class="grabber"></div><h2>${esc(title)}</h2>${innerHTML}</div>`;

  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeSheet(); });
  document.body.appendChild(wrap);
  document.body.style.overflow = 'hidden';

  const esc_ = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', esc_);
  wrap._esc = esc_;

  onMount?.(wrap);
  $('input, select, textarea, button', $('.sheet', wrap))?.focus();
  return wrap;
}

function closeSheet() {
  const m = $('.modal');
  if (!m) return;
  document.removeEventListener('keydown', m._esc);
  m.remove();
  document.body.style.overflow = '';
  stopCamera();
}

/* ---------- auth screens ---------- */

function renderAuth(mode = 'login') {
  stopCamera();
  const isLogin = mode === 'login';
  app.innerHTML = `
    <div class="auth">
      <div class="brand">
        <div class="logo">🏋️</div>
        <h1>FitFlow</h1>
        <p>${isLogin ? 'Track workouts, log meals, get coached.' : 'Two minutes to set up. Then just log.'}</p>
      </div>
      <form id="authForm" novalidate>
        ${isLogin ? '' : `
          <div class="field">
            <label for="name">Name</label>
            <input class="input" id="name" autocomplete="name" required placeholder="Rizky">
          </div>`}
        <div class="field">
          <label for="email">Email</label>
          <input class="input" id="email" type="email" autocomplete="email" required inputmode="email" placeholder="you@example.com">
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input class="input" id="password" type="password" required
                 autocomplete="${isLogin ? 'current-password' : 'new-password'}"
                 placeholder="${isLogin ? 'Your password' : 'At least 8 characters'}">
        </div>
        ${isLogin ? '' : `
          <div class="row">
            <div class="field">
              <label for="weight">Weight (kg)</label>
              <input class="input" id="weight" type="number" inputmode="decimal" value="70" min="25" max="300" step="0.1">
            </div>
            <div class="field">
              <label for="height">Height (cm)</label>
              <input class="input" id="height" type="number" inputmode="numeric" value="172" min="100" max="250">
            </div>
          </div>
          <div class="row">
            <div class="field">
              <label for="age">Age</label>
              <input class="input" id="age" type="number" inputmode="numeric" value="28" min="13" max="100">
            </div>
            <div class="field">
              <label for="sex">Sex</label>
              <select class="input" id="sex">
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label for="goal">Goal</label>
            <select class="input" id="goal">
              <option value="lose">Lose fat</option>
              <option value="maintain" selected>Maintain</option>
              <option value="gain">Build muscle</option>
            </select>
          </div>
          <div class="field">
            <label for="activity">Activity level</label>
            <select class="input" id="activity">
              <option value="sedentary">Sedentary — desk job</option>
              <option value="light">Light — 1-2 days/week</option>
              <option value="moderate" selected>Moderate — 3-4 days/week</option>
              <option value="active">Active — 5-6 days/week</option>
              <option value="athlete">Athlete — twice daily</option>
            </select>
          </div>`}
        <div class="err-text" id="authErr" role="alert"></div>
        <button class="btn btn-primary" type="submit" id="authBtn">
          ${isLogin ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <div class="auth-switch">
        ${isLogin ? "New here?" : 'Already have an account?'}
        <button type="button" id="switchMode">${isLogin ? 'Create an account' : 'Sign in'}</button>
      </div>
    </div>`;

  $('#switchMode').onclick = () => renderAuth(isLogin ? 'register' : 'login');

  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#authBtn');
    const err = $('#authErr');
    err.textContent = '';

    const payload = {
      email: $('#email').value.trim(),
      password: $('#password').value,
    };
    if (!isLogin) {
      Object.assign(payload, {
        name: $('#name').value.trim(),
        weight_kg: +$('#weight').value,
        height_cm: +$('#height').value,
        age: +$('#age').value,
        sex: $('#sex').value,
        goal: $('#goal').value,
        activity_level: $('#activity').value,
      });
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>';
    try {
      const data = await api(isLogin ? '/auth/login' : '/auth/register', { method: 'POST', body: payload });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('ff_token', data.token);
      go('summary');
      toast(isLogin ? `Welcome back, ${data.user.name}` : 'Account created. Log your first meal.');
    } catch (e2) {
      err.textContent = e2.message;
      btn.disabled = false;
      btn.textContent = isLogin ? 'Sign in' : 'Create account';
    }
  };
}

function signOut() {
  state.token = null;
  state.user = null;
  state.cache = {};
  localStorage.removeItem('ff_token');
  location.hash = '';
  renderAuth('login');
}

/* ---------- shell ---------- */

const TINTS = { summary: 'var(--workout)', workout: 'var(--workout)', nutrition: 'var(--nutrition)', profile: 'var(--profile)' };

function shell(inner) {
  const nav = ['summary', 'workout', 'nutrition', 'profile']
    .map((r) => `
      <a href="#${r}" ${state.route === r ? 'aria-current="page"' : ''} style="--tint:${TINTS[r]}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${ICONS[r]}</svg>
        <span>${r[0].toUpperCase() + r.slice(1)}</span>
      </a>`)
    .join('');

  const initial = esc(state.user?.name?.trim()?.[0]?.toUpperCase() || 'F');
  app.innerHTML = `
    <header class="topbar">
      <a class="brand-link" href="#summary" aria-label="FitFlow home">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i></span>
        <span>FitFlow</span>
      </a>
      <nav class="desktop-nav" aria-label="Main">${nav}</nav>
      <a class="profile-link" href="#profile" aria-label="Open profile">
        <span class="avatar">${initial}</span>
        <span class="profile-name">${esc(state.user?.name?.split(' ')[0] || 'You')}</span>
      </a>
    </header>
    <main class="screen screen-${state.route}" id="main-content">${inner}</main>
    <nav class="nav" aria-label="Mobile navigation">${nav}</nav>`;
}

function loadingScreen() {
  shell(`
    <div class="page-head"><div class="skeleton" style="height:14px;width:80px"></div>
      <div class="skeleton" style="height:26px;width:170px;margin-top:8px"></div></div>
    <div class="skeleton" style="height:250px;margin-bottom:14px"></div>
    <div class="skeleton" style="height:110px"></div>`);
}

/** Never leave a blank shell behind: show what failed and offer a way out. */
function errorScreen(message, retry) {
  toast(message, 'err');
  shell(`
    <div class="page-head">
      <div class="eyebrow">Something went wrong</div>
      <h1>Couldn't load this page</h1>
      <p>${esc(message)}</p>
    </div>
    <button class="btn btn-ghost" id="retryBtn">Try again</button>`);
  $('#retryBtn').onclick = retry;
}

/* ============================================================
   SUMMARY
   ============================================================ */

async function renderSummary() {
  loadingScreen();
  let d;
  try { d = await api('/summary'); } catch (e) { return errorScreen(e.message, renderSummary); }
  state.cache.summary = d;

  const net = d.consumed - d.burned;
  const maxWeek = Math.max(...d.week.map((w) => w.calories), d.target, 1);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  shell(`
    <section class="summary-hero">
      <div class="hero-copy">
        <div class="eyebrow">${greet}, ${esc(state.user.name.split(' ')[0])} <span aria-hidden="true">☀️</span></div>
        <h1>Ready to<br><span>move?</span></h1>
        <p>${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · Small steps count.</p>
        <div class="insight"><div class="spark">✦</div><p>${esc(d.insight)}</p></div>
      </div>
      <div class="hero-art">${RUNNER_ART}<span class="scribble">move<br>happy!</span></div>
    </section>

    <section class="rhythm-section" aria-labelledby="rhythm-title">
      <div class="section-heading"><div><span class="section-kicker">Today</span><h2 id="rhythm-title">Your rhythm</h2></div><span class="date-chip">Live progress</span></div>
      <div class="stat-grid summary-stats">
        <div class="stat stat-coral"><div class="stat-icon">🔥</div><div class="k">Calories</div><div class="v">${d.consumed}<small> kcal</small></div><div class="mini-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><div class="s">${round(clampPct(d.consumed, d.target))}% of ${d.target}</div></div>
        <div class="stat stat-lavender"><div class="stat-icon">🥚</div><div class="k">Protein</div><div class="v">${round(d.macros.protein.value)}<small> g</small></div><div class="mini-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><div class="s">${round(clampPct(d.macros.protein.value, d.macros.protein.target))}% of ${d.macros.protein.target}g</div></div>
        <button class="stat stat-green" id="stepsBtn" style="text-align:left"><div class="stat-icon">👟</div><div class="k">Steps</div><div class="v">${d.steps.toLocaleString()}</div><div class="mini-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><div class="s">${d.distance_km} km · tap to log</div></button>
        <div class="stat stat-yellow"><div class="stat-icon">🏆</div><div class="k">Current streak</div><div class="v">${d.streak}<small> days</small></div><div class="s">Keep showing up</div></div>
      </div>
    </section>

    <div class="dashboard-grid">
      <section class="card challenge-card">
        <div class="challenge-copy"><span class="section-kicker">Daily challenge</span><h2>Move for a<br>brighter you</h2><p>${d.minutesToday >= 30 ? 'Challenge complete. Great work today.' : `${Math.max(0, 30 - d.minutesToday)} active minutes to go.`}</p><a class="btn btn-primary btn-inline" href="#workout">Let’s move →</a></div>
        <div class="ring-wrap"><div class="ring-center"><canvas id="ring" role="img" aria-label="Calories ${d.consumed} of ${d.target}, protein ${round(d.macros.protein.value)} of ${d.macros.protein.target} grams, steps ${d.steps} of ${d.stepsTarget}"></canvas><div class="ring-label"><div class="ring-value">${round(net)}</div><div class="ring-unit">net kcal</div></div></div><div class="ring-legend"><span><i class="dot" style="background:var(--workout)"></i>Calories</span><span><i class="dot" style="background:var(--protein)"></i>Protein</span><span><i class="dot" style="background:var(--profile)"></i>Steps</span></div></div>
      </section>

      <section class="card activity-card">
        <div class="card-title"><span>Weekly activity</span><span>This week</span></div>
        <div class="week">
        ${d.week.map((w) => {
          const isToday = w.day === d.date;
          const h = clampPct(w.calories, maxWeek);
          return `<div class="week-col ${isToday ? 'today' : ''}">
            <div class="week-bar"><i style="height:${h}%"></i></div>
            <small>${new Date(w.day + 'T12:00').toLocaleDateString('en-US', { weekday: 'narrow' })}</small>
          </div>`;
        }).join('')}
        </div>
      </section>

      <section class="card recent-card">
      <div class="card-title">
        <span>Recent workouts</span>
        <a href="#workout" style="color:var(--workout);text-decoration:none;font-size:11px">All →</a>
      </div>
      ${d.recentWorkouts.length === 0
        ? `<div class="empty"><div class="big">🏋️</div>No workouts yet.<br>Log one from the Workout tab.</div>`
        : d.recentWorkouts.map((w) => {
            const m = TYPE_META[w.type] || TYPE_META.strength;
            return `<div class="item">
              <div class="icon" style="background:${m.color}22">${m.emoji}</div>
              <div class="body">
                <div class="t">${esc(w.name)}</div>
                <div class="m">${w.duration_min} min · ${w.exercises.length} exercise${w.exercises.length === 1 ? '' : 's'} · ${timeAgo(w.logged_at)}</div>
              </div>
              <div class="end"><div class="n">${w.calories}</div><div class="u">kcal</div></div>
            </div>`;
          }).join('')}
      </section>
    </div>`);

  animateRing($('#ring'), [
    { value: d.consumed, target: d.target, color: '#ff806c' },
    { value: d.macros.protein.value, target: d.macros.protein.target, color: '#7b73f1' },
    { value: d.steps, target: d.stepsTarget, color: '#79c86b' },
  ]);

  $('#stepsBtn').onclick = () => {
    openSheet('Log steps', `
      <div class="field">
        <label for="stepVal">Steps today</label>
        <input class="input" id="stepVal" type="number" inputmode="numeric" value="${d.steps}" min="0" max="200000">
      </div>
      <button class="btn btn-primary" id="saveSteps">Save steps</button>`,
    (w) => {
      $('#saveSteps', w).onclick = async () => {
        const btn = $('#saveSteps', w);
        btn.disabled = true;
        try {
          await api('/stats/steps', { method: 'PUT', body: { steps: +$('#stepVal', w).value } });
          closeSheet();
          toast('Steps saved');
          renderSummary();
        } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
      };
    });
  };
}

/* ============================================================
   WORKOUT
   ============================================================ */

async function renderWorkout() {
  loadingScreen();
  let workouts, routines;
  try {
    [{ workouts }, { routines }] = await Promise.all([api('/workouts?limit=50'), api('/routines')]);
  } catch (e) { return errorScreen(e.message, renderWorkout); }

  const totalMin = workouts.reduce((s, w) => s + w.duration_min, 0);
  const totalKcal = workouts.reduce((s, w) => s + w.calories, 0);

  shell(`
    <div class="page-head">
      <div class="eyebrow">Training</div>
      <h1>Workouts</h1>
      <p>${workouts.length} logged · ${totalMin} min · ${totalKcal.toLocaleString()} kcal</p>
    </div>

    <button class="btn btn-primary" id="newWorkout" style="margin-bottom:14px">＋ Log a workout</button>

    <div class="card">
      <div class="card-title">Routines · tap to load</div>
      <div class="chips">
        ${routines.map((r) => `<button class="chip" data-routine="${r.id}">${TYPE_META[r.type]?.emoji || '🏋️'} ${esc(r.name)}</button>`).join('')}
      </div>
      <div class="row-3">
        <div class="stat" style="padding:10px">
          <div class="k">Strength</div>
          <div class="v" style="font-size:18px">${workouts.filter((w) => w.type === 'strength').length}</div>
        </div>
        <div class="stat" style="padding:10px">
          <div class="k">Cardio</div>
          <div class="v" style="font-size:18px">${workouts.filter((w) => w.type === 'cardio').length}</div>
        </div>
        <div class="stat" style="padding:10px">
          <div class="k">Mobility</div>
          <div class="v" style="font-size:18px">${workouts.filter((w) => w.type === 'flexibility').length}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">History</div>
      <div id="history">
        ${workouts.length === 0
          ? `<div class="empty"><div class="big">💪</div>Nothing logged yet.<br>Start with a routine above.</div>`
          : workouts.map((w) => {
              const m = TYPE_META[w.type] || TYPE_META.strength;
              const vol = w.exercises.reduce((s, e) => s + e.sets * e.reps * e.weight_kg, 0);
              return `<div class="item">
                <div class="icon" style="background:${m.color}22">${m.emoji}</div>
                <div class="body">
                  <div class="t">${esc(w.name)}</div>
                  <div class="m">${w.duration_min} min · ${w.calories} kcal${vol > 0 ? ` · ${round(vol).toLocaleString()} kg volume` : ''} · ${timeAgo(w.logged_at)}</div>
                </div>
                <button class="del" data-del="${w.id}" aria-label="Delete ${esc(w.name)}">✕</button>
              </div>`;
            }).join('')}
      </div>
    </div>`);

  $('#newWorkout').onclick = () => workoutSheet();

  app.querySelectorAll('[data-routine]').forEach((b) => {
    b.onclick = () => {
      const r = routines.find((x) => x.id === +b.dataset.routine);
      workoutSheet(r);
    };
  });

  app.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Delete this workout?')) return;
      try {
        await api(`/workouts/${b.dataset.del}`, { method: 'DELETE' });
        toast('Workout deleted');
        renderWorkout();
      } catch (e) { toast(e.message, 'err'); }
    };
  });
}

function workoutSheet(routine) {
  const ex = routine?.exercises || [];
  const rows = (list) =>
    list.map((e, i) => exRow(e, i)).join('') || exRow({ name: '', sets: 3, reps: 10, weight_kg: 0 }, 0);

  openSheet(routine ? `Log: ${routine.name}` : 'Log a workout', `
    <div class="field">
      <label for="wName">Workout name</label>
      <input class="input" id="wName" value="${esc(routine?.name || '')}" placeholder="Push Day" required>
    </div>
    <div class="field">
      <label>Type</label>
      <div class="seg" id="wType" role="group" aria-label="Workout type">
        ${['strength', 'cardio', 'flexibility', 'sport'].map((t) =>
          `<button type="button" data-t="${t}" aria-pressed="${(routine?.type || 'strength') === t}">${TYPE_META[t].emoji}</button>`).join('')}
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label for="wMin">Duration (min)</label>
        <input class="input" id="wMin" type="number" inputmode="numeric" value="${routine?.duration_min || 45}" min="1" max="600">
      </div>
      <div class="field">
        <label for="wKcal">Calories <span style="color:var(--text-3);font-weight:400">(auto)</span></label>
        <input class="input" id="wKcal" type="number" inputmode="numeric" placeholder="auto" min="0" max="5000">
      </div>
    </div>

    <div class="card-title" style="margin-top:6px">Exercises</div>
    <div id="exList">${rows(ex)}</div>
    <button class="btn btn-ghost btn-sm" id="addEx" style="width:100%;margin:4px 0 14px">＋ Add exercise</button>

    <div class="field">
      <label for="wNotes">Notes</label>
      <textarea class="input" id="wNotes" placeholder="Felt strong. Bench moved well."></textarea>
    </div>
    <div class="err-text" id="wErr" role="alert"></div>
    <button class="btn btn-primary" id="saveW">Save workout</button>`,
  (w) => {
    let type = routine?.type || 'strength';
    $('#wType', w).querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        type = b.dataset.t;
        $('#wType', w).querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      };
    });

    const bindRemove = () => {
      $('#exList', w).querySelectorAll('[data-rm]').forEach((b) => {
        b.onclick = () => {
          if ($('#exList', w).children.length > 1) b.closest('.ex-row').remove();
          else toast('Keep at least one exercise', 'err');
        };
      });
    };
    bindRemove();

    $('#addEx', w).onclick = () => {
      $('#exList', w).insertAdjacentHTML('beforeend', exRow({ name: '', sets: 3, reps: 10, weight_kg: 0 }));
      bindRemove();
      $('#exList', w).lastElementChild.querySelector('input').focus();
    };

    $('#saveW', w).onclick = async () => {
      const name = $('#wName', w).value.trim();
      const err = $('#wErr', w);
      if (!name) { err.textContent = 'Give the workout a name.'; return; }

      const exercises = [...$('#exList', w).querySelectorAll('.ex-row')].map((r) => ({
        name: r.querySelector('[data-n]').value.trim(),
        sets: +r.querySelector('[data-s]').value || 0,
        reps: +r.querySelector('[data-r]').value || 0,
        weight_kg: +r.querySelector('[data-kg]').value || 0,
      })).filter((e) => e.name);

      const kcalRaw = $('#wKcal', w).value;
      const btn = $('#saveW', w);
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>';

      try {
        await api('/workouts', {
          method: 'POST',
          body: {
            name, type,
            duration_min: +$('#wMin', w).value || 0,
            ...(kcalRaw !== '' ? { calories: +kcalRaw } : {}),
            notes: $('#wNotes', w).value.trim(),
            exercises,
          },
        });
        closeSheet();
        toast('Workout saved');
        renderWorkout();
      } catch (e) {
        err.textContent = e.message;
        btn.disabled = false;
        btn.textContent = 'Save workout';
      }
    };
  });
}

function exRow(e) {
  return `<div class="ex-row" style="display:grid;grid-template-columns:1fr 46px 46px 56px 32px;gap:6px;margin-bottom:7px;align-items:center">
    <input class="input" data-n style="min-height:42px;font-size:14px;padding:8px 10px" placeholder="Exercise" value="${esc(e.name || '')}">
    <input class="input" data-s style="min-height:42px;font-size:14px;padding:8px 4px;text-align:center" type="number" inputmode="numeric" value="${e.sets ?? 3}" aria-label="Sets">
    <input class="input" data-r style="min-height:42px;font-size:14px;padding:8px 4px;text-align:center" type="number" inputmode="numeric" value="${e.reps ?? 10}" aria-label="Reps">
    <input class="input" data-kg style="min-height:42px;font-size:14px;padding:8px 4px;text-align:center" type="number" inputmode="decimal" value="${e.weight_kg ?? 0}" aria-label="Weight kg">
    <button class="del" data-rm aria-label="Remove exercise">✕</button>
  </div>`;
}

/* ============================================================
   NUTRITION
   ============================================================ */

let stream = null;

function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

async function renderNutrition() {
  loadingScreen();
  let d;
  try { d = await api('/nutrition/daily'); } catch (e) { return errorScreen(e.message, renderNutrition); }

  const left = Math.max(0, d.targets.calories - d.totals.calories);
  const byMeal = { breakfast: [], lunch: [], dinner: [], snack: [] };
  d.foods.forEach((f) => (byMeal[f.meal] || byMeal.snack).push(f));

  const macroBar = (name, val, target, color) => `
    <div class="macro">
      <div class="macro-top">
        <span class="name">${name}</span>
        <span class="val">${round(val)} / ${target} g</span>
      </div>
      <div class="bar"><span style="width:${clampPct(val, target)}%;background:${color}"></span></div>
    </div>`;

  shell(`
    <div class="page-head">
      <div class="eyebrow">Nutrition</div>
      <h1>Today's food</h1>
      <p>${d.totals.calories} of ${d.targets.calories} kcal · ${left} left</p>
    </div>

    <div class="row" style="margin-bottom:14px">
      <button class="btn btn-ghost" id="searchBtn">🔍 Search</button>
      <button class="btn btn-ghost" id="manualBtn">✏️ Manual</button>
    </div>

    <div class="card">
      <div class="card-title">Macros</div>
      <div class="macro">
        <div class="macro-top">
          <span class="name">Calories</span>
          <span class="val">${d.totals.calories} / ${d.targets.calories}</span>
        </div>
        <div class="bar"><span style="width:${clampPct(d.totals.calories, d.targets.calories)}%;background:linear-gradient(90deg,var(--workout),var(--nutrition))"></span></div>
      </div>
      ${macroBar('Protein', d.totals.protein, d.targets.protein, 'var(--nutrition)')}
      ${macroBar('Carbs', d.totals.carbs, d.targets.carbs, 'var(--warning)')}
      ${macroBar('Fat', d.totals.fat, d.targets.fat, 'var(--profile)')}
    </div>

    ${Object.entries(byMeal).map(([meal, items]) => {
      const kcal = items.reduce((s, f) => s + f.calories, 0);
      return `<div class="card tight">
        <div class="card-title">
          <span>${MEAL_META[meal].emoji} ${MEAL_META[meal].label}</span>
          <span>${kcal} kcal</span>
        </div>
        ${items.length === 0
          ? `<div style="color:var(--text-3);font-size:12.5px;padding:2px 0 4px">Nothing logged.</div>`
          : items.map((f) => `
            <div class="item">
              <div class="body">
                <div class="t">${esc(f.name)}
                  ${f.source === 'scan' ? `<span class="badge badge-info" style="margin-left:5px">AI${f.confidence ? ` ${f.confidence}%` : ''}</span>` : ''}
                </div>
                <div class="m">${round(f.portion_g)} g · P${round(f.protein_g)} C${round(f.carbs_g)} F${round(f.fat_g)}</div>
              </div>
              <div class="end"><div class="n">${f.calories}</div><div class="u">kcal</div></div>
              <button class="del" data-delf="${f.id}" aria-label="Remove ${esc(f.name)}">✕</button>
            </div>`).join('')}
      </div>`;
    }).join('')}`);

$('#searchBtn').onclick = searchSheet;

  app.querySelectorAll('[data-delf]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api(`/nutrition/${b.dataset.delf}`, { method: 'DELETE' });
        toast('Removed');
        renderNutrition();
      } catch (e) { toast(e.message, 'err'); }
    };
  });
}

function guessMeal() {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

function searchSheet() {
  openSheet('Search foods', `
    <div class="field">
      <input class="input" id="q" placeholder="Type a food name…" autocomplete="off" enterkeyhint="search">
    </div>
    <div id="results"></div>`,
  (w) => {
    const run = async () => {
      const q = $('#q', w).value.trim();
      try {
        const { foods } = await api(`/food/search?q=${encodeURIComponent(q)}`);
        $('#results', w).innerHTML = foods.length === 0
          ? `<div class="empty">No match for "${esc(q)}". Try the manual entry.</div>`
          : foods.map((f, i) => `
            <button class="item" data-i="${i}" style="width:100%;text-align:left">
              <div class="icon" style="background:rgba(255,27,156,0.14)">🍽️</div>
              <div class="body">
                <div class="t">${esc(f.name)}</div>
                <div class="m">${f.typical} g · P${f.per100.protein} C${f.per100.carbs} F${f.per100.fat} per 100g</div>
              </div>
              <div class="end"><div class="n">${round(f.per100.calories * f.typical / 100)}</div><div class="u">kcal</div></div>
            </button>`).join('');

        $('#results', w).querySelectorAll('[data-i]').forEach((b) => {
          b.onclick = () => {
            const f = foods[+b.dataset.i];
            logSheet({
              foodType: f.name,
              portion: f.typical,
              per100: f.per100,
              confidence: null,
              macros: {
                protein: +(f.per100.protein * f.typical / 100).toFixed(1),
                carbs: +(f.per100.carbs * f.typical / 100).toFixed(1),
                fat: +(f.per100.fat * f.typical / 100).toFixed(1),
              },
              calories: round(f.per100.calories * f.typical / 100),
            });
          };
        });
      } catch (e) { toast(e.message, 'err'); }
    };

    let t;
    $('#q', w).oninput = () => { clearTimeout(t); t = setTimeout(run, 220); };
    run();
  });
}

function logSheet(preset) {
  openSheet(preset ? `Log ${preset.foodType}` : 'Manual entry', `
    <div class="field">
      <label for="fName">Food</label>
      <input class="input" id="fName" value="${esc(preset?.foodType || '')}" placeholder="What did you eat?">
    </div>
    <div class="row">
      <div class="field">
        <label for="fPortion">Portion (g)</label>
        <input class="input" id="fPortion" type="number" inputmode="decimal" value="${preset?.portion || 200}" min="1">
      </div>
      <div class="field">
        <label for="fMeal">Meal</label>
        <select class="input" id="fMeal">
          ${Object.entries(MEAL_META).map(([k, v]) =>
            `<option value="${k}" ${k === guessMeal() ? 'selected' : ''}>${v.emoji} ${v.label}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label for="fKcal">Calories</label>
        <input class="input" id="fKcal" type="number" inputmode="numeric" value="${preset?.calories ?? ''}" min="0">
      </div>
      <div class="field">
        <label for="fP">Protein (g)</label>
        <input class="input" id="fP" type="number" inputmode="decimal" value="${preset?.macros.protein ?? ''}" min="0">
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label for="fC">Carbs (g)</label>
        <input class="input" id="fC" type="number" inputmode="decimal" value="${preset?.macros.carbs ?? ''}" min="0">
      </div>
      <div class="field">
        <label for="fF">Fat (g)</label>
        <input class="input" id="fF" type="number" inputmode="decimal" value="${preset?.macros.fat ?? ''}" min="0">
      </div>
    </div>
    <div class="err-text" id="fErr" role="alert"></div>
    <button class="btn btn-nutrition" id="fSave">Add to log</button>`,
  (w) => {
    if (preset?.per100) {
      $('#fPortion', w).oninput = () => {
        const k = Math.max(1, +$('#fPortion', w).value || 1) / 100;
        $('#fKcal', w).value = round(preset.per100.calories * k);
        $('#fP', w).value = +(preset.per100.protein * k).toFixed(1);
        $('#fC', w).value = +(preset.per100.carbs * k).toFixed(1);
        $('#fF', w).value = +(preset.per100.fat * k).toFixed(1);
      };
    }

    $('#fSave', w).onclick = async () => {
      const name = $('#fName', w).value.trim();
      if (!name) { $('#fErr', w).textContent = 'Name the food first.'; return; }

      const btn = $('#fSave', w);
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>';
      try {
        await api('/nutrition/log', {
          method: 'POST',
          body: {
            name,
            meal: $('#fMeal', w).value,
            portion_g: +$('#fPortion', w).value || 0,
            calories: +$('#fKcal', w).value || 0,
            protein_g: +$('#fP', w).value || 0,
            carbs_g: +$('#fC', w).value || 0,
            fat_g: +$('#fF', w).value || 0,
            source: preset ? 'search' : 'manual',
          },
        });
        closeSheet();
        toast(`${name} logged`);
        renderNutrition();
      } catch (e) {
        $('#fErr', w).textContent = e.message;
        btn.disabled = false;
        btn.textContent = 'Add to log';
      }
    };
  });
}

/* ============================================================
   PROFILE + COACH
   ============================================================ */

async function renderProfile() {
  loadingScreen();
  let messages = [], analysis;
  try {
    [{ messages }, { analysis }] = await Promise.all([
      api('/coach/history'),
      api('/coach/analyze', { method: 'POST' }),
    ]);
  } catch (e) { return errorScreen(e.message, renderProfile); }

  const u = state.user;
  const delta = analysis.trends.volumeDelta;

  shell(`
    <div class="page-head">
      <div class="eyebrow">Profile</div>
      <h1>${esc(u.name)}</h1>
      <p>${esc(u.email)}</p>
    </div>

    <div class="card">
      <div class="card-title"><span>Your numbers</span><button class="btn btn-ghost btn-sm" id="editP">Edit</button></div>
      <div class="row-3" style="margin-bottom:10px">
        <div class="stat" style="padding:10px"><div class="k">Weight</div><div class="v" style="font-size:17px">${u.weight_kg} kg</div></div>
        <div class="stat" style="padding:10px"><div class="k">Height</div><div class="v" style="font-size:17px">${u.height_cm} cm</div></div>
        <div class="stat" style="padding:10px"><div class="k">Goal</div><div class="v" style="font-size:17px;text-transform:capitalize">${esc(u.goal)}</div></div>
      </div>
      <div class="row-3">
        <div class="stat" style="padding:10px"><div class="k">Kcal</div><div class="v" style="font-size:17px">${u.target_calories}</div></div>
        <div class="stat" style="padding:10px"><div class="k">Protein</div><div class="v" style="font-size:17px">${u.target_protein}g</div></div>
        <div class="stat" style="padding:10px"><div class="k">Steps</div><div class="v" style="font-size:17px">${(u.target_steps / 1000).toFixed(0)}k</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title"><span>30-day analysis</span>
        ${delta !== null ? `<span class="badge ${delta >= 0 ? 'badge-success' : 'badge-warning'}">${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}% volume</span>` : ''}
      </div>
      <div class="row" style="margin-bottom:12px">
        <div class="stat" style="padding:10px"><div class="k">Sessions</div><div class="v" style="font-size:17px">${analysis.trends.sessions30d}</div></div>
        <div class="stat" style="padding:10px"><div class="k">Volume</div><div class="v" style="font-size:17px">${analysis.trends.volumeKg.toLocaleString()} kg</div></div>
      </div>
      ${analysis.suggestions.map((s) => `
        <div class="item" style="padding:9px 0">
          <div class="icon" style="background:rgba(0,169,255,0.14);width:30px;height:30px;flex-basis:30px;font-size:13px">→</div>
          <div class="body"><div class="m" style="color:var(--text-2);font-size:12.5px;line-height:1.45">${esc(s)}</div></div>
        </div>`).join('')}
      <button class="btn btn-ghost btn-sm" id="planBtn" style="width:100%;margin-top:10px">Build my week</button>
    </div>

    <div class="card">
      <div class="card-title">
        <span>AI Coach</span>
        ${messages.length ? '<button class="btn btn-ghost btn-sm" id="clearChat">Clear</button>' : ''}
      </div>
      <div class="chips">
        ${['How much protein do I need?', 'What should I train today?', 'Am I eating enough?', 'Build me a plan']
          .map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
      </div>
      <div class="chat" id="chat" role="log" aria-live="polite">
        ${messages.length === 0
          ? `<div class="msg bot">I've got your logs in front of me. Ask about training, food, or what to do next.</div>`
          : messages.map((m) => `<div class="msg ${m.role === 'user' ? 'user' : 'bot'}">${esc(m.content)}</div>`).join('')}
      </div>
      <div class="chat-bar">
        <input class="input" id="chatIn" placeholder="Ask your coach…" enterkeyhint="send" autocomplete="off">
        <button class="btn btn-profile" id="sendBtn" aria-label="Send">↑</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Coach tone</div>
      <div class="seg" id="toneSeg" role="group" aria-label="Coach tone">
        ${[['supportive', 'Supportive'], ['direct', 'Direct'], ['tough', 'Tough love']]
          .map(([k, l]) => `<button data-tone="${k}" aria-pressed="${u.coach_tone === k}">${l}</button>`).join('')}
      </div>
    </div>

    <button class="btn btn-danger" id="signOut">Sign out</button>`);

  const chat = $('#chat');
  chat.scrollTop = chat.scrollHeight;

  const send = async (text) => {
    const msg = (text ?? $('#chatIn').value).trim();
    if (!msg) return;
    $('#chatIn').value = '';

    chat.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(msg)}</div>`);
    chat.insertAdjacentHTML('beforeend', `<div class="msg bot" id="typing"><div class="typing"><i></i><i></i><i></i></div></div>`);
    chat.scrollTop = chat.scrollHeight;
    $('#sendBtn').disabled = true;

    try {
      const { reply } = await api('/coach/chat', { method: 'POST', body: { message: msg } });
      await new Promise((r) => setTimeout(r, 380));
      $('#typing').outerHTML = `<div class="msg bot">${esc(reply)}</div>`;
    } catch (e) {
      $('#typing').outerHTML = `<div class="msg bot" style="border-color:rgba(255,71,87,.4)">${esc(e.message)}</div>`;
    }
    $('#sendBtn').disabled = false;
    chat.scrollTop = chat.scrollHeight;
  };

  $('#sendBtn').onclick = () => send();
  $('#chatIn').onkeydown = (e) => { if (e.key === 'Enter') send(); };
  app.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => send(b.dataset.q)));

  $('#clearChat')?.addEventListener('click', async () => {
    try {
      await api('/coach/history', { method: 'DELETE' });
      renderProfile();
    } catch (e) { toast(e.message, 'err'); }
  });

  $('#toneSeg').querySelectorAll('[data-tone]').forEach((b) => {
    b.onclick = async () => {
      try {
        const { user } = await api('/profile', { method: 'PUT', body: { coach_tone: b.dataset.tone } });
        state.user = user;
        $('#toneSeg').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
        toast(`Coach set to ${b.dataset.tone}`);
      } catch (e) { toast(e.message, 'err'); }
    };
  });

  $('#planBtn').onclick = async () => {
    try {
      const { plan } = await api('/coach/plan', { method: 'POST' });
      openSheet('Your week', `
        <div class="card" style="margin:0 0 12px">
          <div class="card-title">Focus</div>
          <p style="font-size:13.5px;color:var(--text-2)">${esc(plan.focus)}</p>
        </div>
        <div class="card" style="margin:0 0 12px">
          <div class="card-title">Daily targets</div>
          <div class="row-3">
            <div class="stat" style="padding:9px"><div class="k">Kcal</div><div class="v" style="font-size:15px">${plan.targets.calories}</div></div>
            <div class="stat" style="padding:9px"><div class="k">Protein</div><div class="v" style="font-size:15px">${plan.targets.protein}g</div></div>
            <div class="stat" style="padding:9px"><div class="k">Carbs</div><div class="v" style="font-size:15px">${plan.targets.carbs}g</div></div>
          </div>
        </div>
        <div class="card" style="margin:0">
          <div class="card-title">Schedule</div>
          ${plan.week.map((d) => `
            <div class="item" style="padding:9px 0">
              <div class="body"><div class="t">${esc(d.day)}</div><div class="m">${esc(d.session)}</div></div>
              <div class="end"><div class="n">${d.minutes || '—'}</div><div class="u">${d.minutes ? 'min' : 'rest'}</div></div>
            </div>`).join('')}
        </div>`);
    } catch (e) { toast(e.message, 'err'); }
  };

  $('#editP').onclick = () => editProfileSheet();
  $('#signOut').onclick = () => { if (confirm('Sign out of FitFlow?')) signOut(); };
}

function editProfileSheet() {
  const u = state.user;
  openSheet('Edit profile', `
    <div class="field">
      <label for="pName">Name</label>
      <input class="input" id="pName" value="${esc(u.name)}">
    </div>
    <div class="row">
      <div class="field">
        <label for="pW">Weight (kg)</label>
        <input class="input" id="pW" type="number" inputmode="decimal" value="${u.weight_kg}" step="0.1" min="25" max="300">
      </div>
      <div class="field">
        <label for="pH">Height (cm)</label>
        <input class="input" id="pH" type="number" inputmode="numeric" value="${u.height_cm}" min="100" max="250">
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label for="pA">Age</label>
        <input class="input" id="pA" type="number" inputmode="numeric" value="${u.age}" min="13" max="100">
      </div>
      <div class="field">
        <label for="pS">Sex</label>
        <select class="input" id="pS">
          <option value="male" ${u.sex === 'male' ? 'selected' : ''}>Male</option>
          <option value="female" ${u.sex === 'female' ? 'selected' : ''}>Female</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label for="pG">Goal</label>
      <select class="input" id="pG">
        ${[['lose', 'Lose fat'], ['maintain', 'Maintain'], ['gain', 'Build muscle']]
          .map(([k, l]) => `<option value="${k}" ${u.goal === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label for="pAct">Activity level</label>
      <select class="input" id="pAct">
        ${[['sedentary', 'Sedentary'], ['light', 'Light'], ['moderate', 'Moderate'], ['active', 'Active'], ['athlete', 'Athlete']]
          .map(([k, l]) => `<option value="${k}" ${u.activity_level === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label for="pSteps">Daily step goal</label>
      <input class="input" id="pSteps" type="number" inputmode="numeric" value="${u.target_steps}" min="1000" max="50000" step="500">
    </div>
    <div class="card tight" style="background:rgba(0,169,255,0.07);border-color:rgba(0,169,255,0.25)">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
        <input type="checkbox" id="autoMac" checked style="width:19px;height:19px;accent-color:var(--profile)">
        <span style="font-size:13px">Recalculate my macros from these numbers</span>
      </label>
    </div>
    <div id="manualMac" style="display:none">
      <div class="row">
        <div class="field"><label for="tK">Calories</label><input class="input" id="tK" type="number" value="${u.target_calories}"></div>
        <div class="field"><label for="tP">Protein (g)</label><input class="input" id="tP" type="number" value="${u.target_protein}"></div>
      </div>
      <div class="row">
        <div class="field"><label for="tC">Carbs (g)</label><input class="input" id="tC" type="number" value="${u.target_carbs}"></div>
        <div class="field"><label for="tF">Fat (g)</label><input class="input" id="tF" type="number" value="${u.target_fat}"></div>
      </div>
    </div>
    <button class="btn btn-profile" id="pSave">Save changes</button>`,
  (w) => {
    $('#autoMac', w).onchange = (e) => {
      $('#manualMac', w).style.display = e.target.checked ? 'none' : 'block';
    };

    $('#pSave', w).onclick = async () => {
      const auto = $('#autoMac', w).checked;
      const btn = $('#pSave', w);
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>';
      try {
        const { user } = await api('/profile', {
          method: 'PUT',
          body: {
            name: $('#pName', w).value.trim(),
            weight_kg: +$('#pW', w).value,
            height_cm: +$('#pH', w).value,
            age: +$('#pA', w).value,
            sex: $('#pS', w).value,
            goal: $('#pG', w).value,
            activity_level: $('#pAct', w).value,
            target_steps: +$('#pSteps', w).value,
            auto_macros: auto,
            ...(auto ? {} : {
              target_calories: +$('#tK', w).value,
              target_protein: +$('#tP', w).value,
              target_carbs: +$('#tC', w).value,
              target_fat: +$('#tF', w).value,
            }),
          },
        });
        state.user = user;
        closeSheet();
        toast('Profile updated');
        renderProfile();
      } catch (e) {
        toast(e.message, 'err');
        btn.disabled = false;
        btn.textContent = 'Save changes';
      }
    };
  });
}

/* ============================================================
   ROUTER
   ============================================================ */

const PAGES = { summary: renderSummary, workout: renderWorkout, nutrition: renderNutrition, profile: renderProfile };

function go(route) {
  if (location.hash.slice(1) === route) route_(route);
  else location.hash = route;
}

function route_(route) {
  stopCamera();
  closeSheet();
  state.route = PAGES[route] ? route : 'summary';
  PAGES[state.route]();
}

window.addEventListener('hashchange', () => {
  if (!state.token) return;
  route_(location.hash.slice(1) || 'summary');
});

async function boot() {
  if (!state.token) return renderAuth('login');
  try {
    const { user } = await api('/auth/me');
    state.user = user;
    route_(location.hash.slice(1) || 'summary');
  } catch {
    renderAuth('login');
  }
}

boot();
