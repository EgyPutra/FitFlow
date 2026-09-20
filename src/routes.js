import { db, today } from './db.js';
import { hashPassword, verifyPassword, createToken, authenticate, computeTargets } from './auth.js';
import { searchFoods, analyzeProgress, coachReply, dailyInsight } from './ai.js';

/* ---------- helpers ---------- */

const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};

function requireUser(req) {
  const user = authenticate(req);
  if (!user) fail(401, 'Your session expired. Sign in again.');
  return user;
}

function publicUser(u) {
  const { password_hash, ...rest } = u;
  return rest;
}

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const clean = (s, max = 200) => String(s ?? '').trim().slice(0, max);

function loadWorkouts(userId, limit = 500) {
  const workouts = db
    .prepare('SELECT * FROM workouts WHERE user_id = ? ORDER BY logged_at DESC, id DESC LIMIT ?')
    .all(userId, limit);
  const stmt = db.prepare('SELECT * FROM workout_exercises WHERE workout_id = ? ORDER BY position, id');
  return workouts.map((w) => ({ ...w, exercises: stmt.all(w.id) }));
}

function dayTotals(userId, day) {
  const f = db
    .prepare(
      `SELECT COALESCE(SUM(calories),0) AS calories,
              COALESCE(SUM(protein_g),0) AS protein,
              COALESCE(SUM(carbs_g),0)   AS carbs,
              COALESCE(SUM(fat_g),0)     AS fat
       FROM foods WHERE user_id = ? AND substr(logged_at,1,10) = ?`
    )
    .get(userId, day);
  const w = db
    .prepare(
      `SELECT COALESCE(SUM(calories),0) AS burned, COALESCE(SUM(duration_min),0) AS minutes, COUNT(*) AS count
       FROM workouts WHERE user_id = ? AND substr(logged_at,1,10) = ?`
    )
    .get(userId, day);
  return { ...f, ...w };
}

function weekWorkoutCount(userId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM workouts
       WHERE user_id = ? AND logged_at >= datetime('now','-7 days')`
    )
    .get(userId).n;
}

function loggingStreak(userId) {
  const days = db
    .prepare(
      `SELECT DISTINCT substr(logged_at,1,10) AS d FROM (
         SELECT logged_at FROM foods WHERE user_id = ?1
         UNION ALL SELECT logged_at FROM workouts WHERE user_id = ?1
       ) ORDER BY d DESC LIMIT 60`
    )
    .all(userId)
    .map((r) => r.d);

  let streak = 0;
  const cursor = new Date();
  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (days.includes(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else if (streak === 0 && key === today()) {
      cursor.setDate(cursor.getDate() - 1); // today not logged yet — check yesterday
    } else break;
    if (streak > 59) break;
  }
  return streak;
}

function analysisFor(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const workouts = loadWorkouts(userId);
  const foods = db.prepare('SELECT * FROM foods WHERE user_id = ? ORDER BY logged_at DESC LIMIT 500').all(userId);
  return analyzeProgress({ workouts, foods, user });
}

/* ---------- routes ---------- */

export const routes = [
  /* ===== auth ===== */
  {
    method: 'POST',
    pattern: /^\/api\/auth\/register$/,
    handler: ({ body }) => {
      const email = clean(body.email, 120).toLowerCase();
      const name = clean(body.name, 60);
      const password = String(body.password || '');

      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Enter a valid email address.');
      if (password.length < 8) fail(400, 'Password needs at least 8 characters.');
      if (!name) fail(400, 'Enter your name.');
      if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
        fail(409, 'That email is already registered. Sign in instead.');
      }

      const profile = {
        height_cm: num(body.height_cm, 172),
        weight_kg: num(body.weight_kg, 70),
        age: num(body.age, 28),
        sex: ['male', 'female'].includes(body.sex) ? body.sex : 'male',
        activity_level: clean(body.activity_level, 20) || 'moderate',
        goal: ['lose', 'maintain', 'gain'].includes(body.goal) ? body.goal : 'maintain',
      };
      const t = computeTargets(profile);

      const info = db
        .prepare(
          `INSERT INTO users (email, password_hash, name, height_cm, weight_kg, age, sex,
             activity_level, goal, target_calories, target_protein, target_carbs, target_fat)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(email, hashPassword(password), name, profile.height_cm, profile.weight_kg, profile.age,
          profile.sex, profile.activity_level, profile.goal,
          t.target_calories, t.target_protein, t.target_carbs, t.target_fat);

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
      return { status: 201, body: { token: createToken(user.id), user: publicUser(user) } };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/auth\/login$/,
    handler: ({ body }) => {
      const email = clean(body.email, 120).toLowerCase();
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user || !verifyPassword(String(body.password || ''), user.password_hash)) {
        fail(401, 'Email or password is incorrect.');
      }
      return { body: { token: createToken(user.id), user: publicUser(user) } };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/auth\/me$/,
    handler: ({ req }) => ({ body: { user: publicUser(requireUser(req)) } }),
  },

  /* ===== profile ===== */
  {
    method: 'PUT',
    pattern: /^\/api\/profile$/,
    handler: ({ req, body }) => {
      const user = requireUser(req);
      const merged = {
        name: clean(body.name, 60) || user.name,
        avatar_emoji: clean(body.avatar_emoji, 8) || user.avatar_emoji,
        height_cm: num(body.height_cm, user.height_cm),
        weight_kg: num(body.weight_kg, user.weight_kg),
        age: num(body.age, user.age),
        sex: ['male', 'female'].includes(body.sex) ? body.sex : user.sex,
        activity_level: clean(body.activity_level, 20) || user.activity_level,
        goal: ['lose', 'maintain', 'gain'].includes(body.goal) ? body.goal : user.goal,
        coach_tone: ['supportive', 'direct', 'tough'].includes(body.coach_tone) ? body.coach_tone : user.coach_tone,
        target_steps: num(body.target_steps, user.target_steps),
      };

      // Recompute macros unless the user overrode them by hand.
      const auto = computeTargets(merged);
      const targets = body.auto_macros === false
        ? {
            target_calories: num(body.target_calories, user.target_calories),
            target_protein: num(body.target_protein, user.target_protein),
            target_carbs: num(body.target_carbs, user.target_carbs),
            target_fat: num(body.target_fat, user.target_fat),
          }
        : auto;

      db.prepare(
        `UPDATE users SET name=?, avatar_emoji=?, height_cm=?, weight_kg=?, age=?, sex=?,
           activity_level=?, goal=?, coach_tone=?, target_steps=?,
           target_calories=?, target_protein=?, target_carbs=?, target_fat=? WHERE id=?`
      ).run(merged.name, merged.avatar_emoji, merged.height_cm, merged.weight_kg, merged.age, merged.sex,
        merged.activity_level, merged.goal, merged.coach_tone, merged.target_steps,
        targets.target_calories, targets.target_protein, targets.target_carbs, targets.target_fat, user.id);

      return { body: { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) } };
    },
  },

  /* ===== summary ===== */
  {
    method: 'GET',
    pattern: /^\/api\/summary$/,
    handler: ({ req }) => {
      const user = requireUser(req);
      const day = today();
      const totals = dayTotals(user.id, day);
      const stats = db.prepare('SELECT * FROM daily_stats WHERE user_id = ? AND day = ?').get(user.id, day)
        || { steps: 0, distance_km: 0 };
      const workoutsThisWeek = weekWorkoutCount(user.id);
      const streak = loggingStreak(user.id);

      const week = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const t = dayTotals(user.id, key);
        week.push({ day: key, calories: t.calories, burned: t.burned, workouts: t.count });
      }

      return {
        body: {
          date: day,
          consumed: totals.calories,
          burned: totals.burned,
          target: user.target_calories,
          macros: {
            protein: { value: +totals.protein.toFixed(1), target: user.target_protein },
            carbs: { value: +totals.carbs.toFixed(1), target: user.target_carbs },
            fat: { value: +totals.fat.toFixed(1), target: user.target_fat },
          },
          steps: stats.steps,
          stepsTarget: user.target_steps,
          distance_km: stats.distance_km,
          workoutsThisWeek,
          minutesToday: totals.minutes,
          streak,
          week,
          recentWorkouts: loadWorkouts(user.id, 3),
          insight: dailyInsight({
            user,
            caloriesToday: totals.calories,
            proteinToday: totals.protein,
            workoutsThisWeek,
            streak,
          }),
        },
      };
    },
  },
  {
    method: 'PUT',
    pattern: /^\/api\/stats\/steps$/,
    handler: ({ req, body }) => {
      const user = requireUser(req);
      const day = clean(body.day, 10) || today();
      const steps = Math.max(0, Math.round(num(body.steps, 0)));
      const distance = +(steps * 0.000762).toFixed(2); // ~76 cm stride
      db.prepare(
        `INSERT INTO daily_stats (user_id, day, steps, distance_km) VALUES (?,?,?,?)
         ON CONFLICT(user_id, day) DO UPDATE SET steps=excluded.steps, distance_km=excluded.distance_km`
      ).run(user.id, day, steps, distance);
      return { body: { day, steps, distance_km: distance } };
    },
  },

  /* ===== workouts ===== */
  {
    method: 'GET',
    pattern: /^\/api\/workouts$/,
    handler: ({ req, query }) => {
      const user = requireUser(req);
      const limit = Math.min(200, Math.max(1, num(query.get('limit'), 50)));
      return { body: { workouts: loadWorkouts(user.id, limit) } };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/workouts\/(?<id>\d+)$/,
    handler: ({ req, params }) => {
      const user = requireUser(req);
      const w = db.prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ?').get(+params.id, user.id);
      if (!w) fail(404, 'That workout no longer exists.');
      w.exercises = db.prepare('SELECT * FROM workout_exercises WHERE workout_id = ? ORDER BY position, id').all(w.id);
      return { body: { workout: w } };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/workouts$/,
    handler: ({ req, body }) => {
      const user = requireUser(req);
      const name = clean(body.name, 80);
      if (!name) fail(400, 'Give the workout a name.');

      const type = ['strength', 'cardio', 'flexibility', 'sport'].includes(body.type) ? body.type : 'strength';
      const duration = Math.max(0, Math.round(num(body.duration_min, 0)));
      const exercises = Array.isArray(body.exercises) ? body.exercises.slice(0, 40) : [];

      // Estimate burn when the client doesn't supply it.
      const mets = { strength: 5.0, cardio: 8.5, flexibility: 2.5, sport: 7.0 };
      const est = Math.round((mets[type] * 3.5 * (user.weight_kg || 70) / 200) * duration);
      const calories = Math.max(0, Math.round(num(body.calories, est)));
      const loggedAt = clean(body.logged_at, 25) || new Date().toISOString();

      const info = db
        .prepare('INSERT INTO workouts (user_id, name, type, duration_min, calories, notes, logged_at) VALUES (?,?,?,?,?,?,?)')
        .run(user.id, name, type, duration, calories, clean(body.notes, 500) || null, loggedAt);

      const insertEx = db.prepare(
        'INSERT INTO workout_exercises (workout_id, name, sets, reps, weight_kg, position) VALUES (?,?,?,?,?,?)'
      );
      exercises.forEach((e, i) => {
        const exName = clean(e.name, 80);
        if (!exName) return;
        insertEx.run(info.lastInsertRowid, exName, Math.round(num(e.sets)), Math.round(num(e.reps)), num(e.weight_kg), i);
      });

      const w = db.prepare('SELECT * FROM workouts WHERE id = ?').get(info.lastInsertRowid);
      w.exercises = db.prepare('SELECT * FROM workout_exercises WHERE workout_id = ? ORDER BY position').all(w.id);
      return { status: 201, body: { workout: w } };
    },
  },
  {
    method: 'PUT',
    pattern: /^\/api\/workouts\/(?<id>\d+)$/,
    handler: ({ req, body, params }) => {
      const user = requireUser(req);
      const id = +params.id;
      const existing = db.prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ?').get(id, user.id);
      if (!existing) fail(404, 'That workout no longer exists.');

      db.prepare('UPDATE workouts SET name=?, type=?, duration_min=?, calories=?, notes=? WHERE id=?').run(
        clean(body.name, 80) || existing.name,
        ['strength', 'cardio', 'flexibility', 'sport'].includes(body.type) ? body.type : existing.type,
        Math.max(0, Math.round(num(body.duration_min, existing.duration_min))),
        Math.max(0, Math.round(num(body.calories, existing.calories))),
        body.notes === undefined ? existing.notes : clean(body.notes, 500) || null,
        id
      );

      if (Array.isArray(body.exercises)) {
        db.prepare('DELETE FROM workout_exercises WHERE workout_id = ?').run(id);
        const insertEx = db.prepare(
          'INSERT INTO workout_exercises (workout_id, name, sets, reps, weight_kg, position) VALUES (?,?,?,?,?,?)'
        );
        body.exercises.slice(0, 40).forEach((e, i) => {
          const exName = clean(e.name, 80);
          if (!exName) return;
          insertEx.run(id, exName, Math.round(num(e.sets)), Math.round(num(e.reps)), num(e.weight_kg), i);
        });
      }

      const w = db.prepare('SELECT * FROM workouts WHERE id = ?').get(id);
      w.exercises = db.prepare('SELECT * FROM workout_exercises WHERE workout_id = ? ORDER BY position').all(id);
      return { body: { workout: w } };
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/workouts\/(?<id>\d+)$/,
    handler: ({ req, params }) => {
      const user = requireUser(req);
      const info = db.prepare('DELETE FROM workouts WHERE id = ? AND user_id = ?').run(+params.id, user.id);
      if (info.changes === 0) fail(404, 'That workout no longer exists.');
      return { body: { deleted: true } };
    },
  },

  /* ===== routines ===== */
  {
    method: 'GET',
    pattern: /^\/api\/routines$/,
    handler: ({ req }) => {
      const user = requireUser(req);
      const rows = db
        .prepare('SELECT * FROM routines WHERE is_template = 1 OR user_id = ? ORDER BY is_template DESC, id')
        .all(user.id);
      return { body: { routines: rows.map((r) => ({ ...r, exercises: JSON.parse(r.exercises) })) } };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/routines$/,
    handler: ({ req, body }) => {
      const user = requireUser(req);
      const name = clean(body.name, 80);
      if (!name) fail(400, 'Give the routine a name.');
      const exercises = (Array.isArray(body.exercises) ? body.exercises : []).slice(0, 40).map((e) => ({
        name: clean(e.name, 80),
        sets: Math.round(num(e.sets)),
        reps: Math.round(num(e.reps)),
        weight_kg: num(e.weight_kg),
      })).filter((e) => e.name);

      const info = db
        .prepare('INSERT INTO routines (user_id, name, type, duration_min, exercises, is_template) VALUES (?,?,?,?,?,0)')
        .run(user.id,
          name,
          ['strength', 'cardio', 'flexibility', 'sport'].includes(body.type) ? body.type : 'strength',
          Math.max(0, Math.round(num(body.duration_min, 45))),
          JSON.stringify(exercises));

      const r = db.prepare('SELECT * FROM routines WHERE id = ?').get(info.lastInsertRowid);
      return { status: 201, body: { routine: { ...r, exercises: JSON.parse(r.exercises) } } };
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/routines\/(?<id>\d+)$/,
    handler: ({ req, params }) => {
      const user = requireUser(req);
      const info = db.prepare('DELETE FROM routines WHERE id = ? AND user_id = ?').run(+params.id, user.id);
      if (info.changes === 0) fail(404, 'You can only delete routines you created.');
      return { body: { deleted: true } };
    },
  },

  /* ===== nutrition ===== */
  {
    method: 'GET',
    pattern: /^\/api\/food\/search$/,
    handler: ({ req, query }) => {
      requireUser(req);
      return { body: { foods: searchFoods(query.get('q')) } };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/nutrition\/log$/,
    handler: ({ req, body }) => {
      const user = requireUser(req);
      const name = clean(body.name, 80);
      if (!name) fail(400, 'Name the food before logging it.');

      const meal = ['breakfast', 'lunch', 'dinner', 'snack'].includes(body.meal) ? body.meal : 'lunch';
      const info = db
        .prepare(
          `INSERT INTO foods (user_id, name, meal, portion_g, calories, protein_g, carbs_g, fat_g, source, confidence, logged_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(user.id, name, meal,
          Math.max(0, num(body.portion_g, 100)),
          Math.max(0, Math.round(num(body.calories))),
          Math.max(0, num(body.protein_g)),
          Math.max(0, num(body.carbs_g)),
          Math.max(0, num(body.fat_g)),
          ['scan', 'manual', 'search'].includes(body.source) ? body.source : 'manual',
          body.confidence == null ? null : Math.round(num(body.confidence)),
          clean(body.logged_at, 25) || new Date().toISOString());

      return { status: 201, body: { food: db.prepare('SELECT * FROM foods WHERE id = ?').get(info.lastInsertRowid) } };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/nutrition\/daily$/,
    handler: ({ req, query }) => {
      const user = requireUser(req);
      const day = clean(query.get('day'), 10) || today();
      const foods = db
        .prepare('SELECT * FROM foods WHERE user_id = ? AND substr(logged_at,1,10) = ? ORDER BY id')
        .all(user.id, day);
      const t = dayTotals(user.id, day);

      return {
        body: {
          day,
          foods,
          totals: {
            calories: t.calories,
            protein: +t.protein.toFixed(1),
            carbs: +t.carbs.toFixed(1),
            fat: +t.fat.toFixed(1),
          },
          targets: {
            calories: user.target_calories,
            protein: user.target_protein,
            carbs: user.target_carbs,
            fat: user.target_fat,
          },
        },
      };
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/nutrition\/(?<id>\d+)$/,
    handler: ({ req, params }) => {
      const user = requireUser(req);
      const info = db.prepare('DELETE FROM foods WHERE id = ? AND user_id = ?').run(+params.id, user.id);
      if (info.changes === 0) fail(404, 'That entry is already gone.');
      return { body: { deleted: true } };
    },
  },

  /* ===== AI coach ===== */
  {
    method: 'GET',
    pattern: /^\/api\/coach\/history$/,
    handler: ({ req }) => {
      const user = requireUser(req);
      return {
        body: {
          messages: db
            .prepare('SELECT id, role, content, created_at FROM coach_messages WHERE user_id = ? ORDER BY id LIMIT 100')
            .all(user.id),
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/coach\/chat$/,
    handler: async ({ req, body }) => {
      const user = requireUser(req);
      const message = clean(body.message, 1000);
      if (!message) fail(400, 'Type a message first.');

      const totals = dayTotals(user.id, today());
      // await works whether coachReply is sync (mock) or async (real Claude call).
      const reply = await coachReply({
        message,
        user,
        context: {
          caloriesToday: totals.calories,
          proteinToday: totals.protein,
          workoutsThisWeek: weekWorkoutCount(user.id),
          analysis: analysisFor(user.id),
        },
      });

      const insert = db.prepare('INSERT INTO coach_messages (user_id, role, content) VALUES (?,?,?)');
      insert.run(user.id, 'user', message);
      const info = insert.run(user.id, 'assistant', reply);

      return {
        body: { reply, message: db.prepare('SELECT id, role, content, created_at FROM coach_messages WHERE id = ?').get(info.lastInsertRowid) },
      };
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/coach\/history$/,
    handler: ({ req }) => {
      const user = requireUser(req);
      db.prepare('DELETE FROM coach_messages WHERE user_id = ?').run(user.id);
      return { body: { cleared: true } };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/coach\/analyze$/,
    handler: ({ req }) => {
      const user = requireUser(req);
      return { body: { analysis: analysisFor(user.id) } };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/coach\/plan$/,
    handler: ({ req }) => {
      const user = requireUser(req);
      const analysis = analysisFor(user.id);
      const focus = user.goal === 'lose' ? 'calorie control with lifting to protect muscle'
        : user.goal === 'gain' ? 'progressive overload with a small surplus'
        : 'steady volume and consistent intake';

      return {
        body: {
          plan: {
            focus,
            targets: {
              calories: user.target_calories,
              protein: user.target_protein,
              carbs: user.target_carbs,
              fat: user.target_fat,
            },
            week: [
              { day: 'Monday', session: 'Push Day', minutes: 50 },
              { day: 'Tuesday', session: 'Easy Run', minutes: 35 },
              { day: 'Wednesday', session: 'Pull Day', minutes: 50 },
              { day: 'Thursday', session: 'Mobility & Core', minutes: 20 },
              { day: 'Friday', session: 'Leg Day', minutes: 55 },
              { day: 'Saturday', session: 'HIIT Burner', minutes: 25 },
              { day: 'Sunday', session: 'Rest', minutes: 0 },
            ],
            notes: analysis.suggestions,
          },
        },
      };
    },
  },

  /* ===== health ===== */
  {
    method: 'GET',
    pattern: /^\/api\/health$/,
    handler: () => ({ body: { status: 'ok', time: new Date().toISOString() } }),
  },
];
