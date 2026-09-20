/**
 * Seeds a demo account with 30 days of history.
 *   node scripts/seed.js
 * Login: demo@fitflow.app / demo1234
 */

import { db } from '../src/db.js';
import { hashPassword, computeTargets } from '../src/auth.js';

const EMAIL = 'demo@fitflow.app';
const PASSWORD = 'demo1234';

db.prepare('DELETE FROM users WHERE email = ?').run(EMAIL);

const profile = {
  height_cm: 175,
  weight_kg: 74,
  age: 27,
  sex: 'male',
  activity_level: 'moderate',
  goal: 'lose',
};
const t = computeTargets(profile);

const { lastInsertRowid: userId } = db
  .prepare(
    `INSERT INTO users (email, password_hash, name, height_cm, weight_kg, age, sex,
       activity_level, goal, target_calories, target_protein, target_carbs, target_fat)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
  .run(EMAIL, hashPassword(PASSWORD), 'Demo User', profile.height_cm, profile.weight_kg, profile.age,
    profile.sex, profile.activity_level, profile.goal,
    t.target_calories, t.target_protein, t.target_carbs, t.target_fat);

const iso = (daysAgo, hour) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

/* ---------- workouts: a realistic 5-week block ---------- */

const plan = [
  ['Push Day', 'strength', 50, [['Bench Press', 4, 8, 60], ['Overhead Press', 3, 10, 35], ['Triceps Pushdown', 3, 15, 25]]],
  ['Pull Day', 'strength', 50, [['Deadlift', 4, 5, 100], ['Pull-up', 4, 8, 0], ['Barbell Row', 3, 10, 50]]],
  ['Leg Day', 'strength', 55, [['Back Squat', 4, 6, 80], ['Romanian Deadlift', 3, 10, 60], ['Leg Press', 3, 12, 120]]],
  ['Easy Run', 'cardio', 35, [['Zone 2 Run', 1, 35, 0]]],
  ['HIIT Burner', 'cardio', 25, [['Burpee', 5, 12, 0], ['Jump Squat', 5, 15, 0]]],
  ['Mobility & Core', 'flexibility', 20, [['Dead Bug', 3, 12, 0], ['Cat-Cow', 2, 10, 0]]],
];

const insertWorkout = db.prepare(
  'INSERT INTO workouts (user_id, name, type, duration_min, calories, notes, logged_at) VALUES (?,?,?,?,?,?,?)'
);
const insertEx = db.prepare(
  'INSERT INTO workout_exercises (workout_id, name, sets, reps, weight_kg, position) VALUES (?,?,?,?,?,?)'
);
const mets = { strength: 5.0, cardio: 8.5, flexibility: 2.5 };

// 70 days so the 30-day window has a full prior block to compare against —
// otherwise the volume delta compares against near-zero and reads as nonsense.
let workoutCount = 0;
for (let day = 69; day >= 0; day--) {
  const dow = (new Date().getDay() - day % 7 + 70) % 7;
  if (dow === 0) continue; // Sunday rest

  // ~4 sessions a week, deterministic so the demo looks the same every seed.
  if (day % 7 === 2 || day % 7 === 5) continue;

  const [name, type, mins, exs] = plan[day % plan.length];
  // Progressive overload: weights creep up as days get more recent.
  const progress = 1 + (69 - day) * 0.003;
  const kcal = Math.round((mets[type] * 3.5 * profile.weight_kg / 200) * mins);

  const { lastInsertRowid: wid } = insertWorkout.run(
    userId, name, type, mins, kcal, null, iso(day, 18)
  );
  exs.forEach(([exName, sets, reps, kg], i) =>
    insertEx.run(wid, exName, sets, reps, Math.round(kg * progress * 2) / 2, i)
  );
  workoutCount++;
}

/* ---------- food: 30 days of meals ---------- */

const meals = [
  ['Oatmeal', 'breakfast', 250, 170, 6, 30, 3.5],
  ['Telur Rebus', 'breakfast', 100, 155, 12.6, 1.1, 10.6],
  ['Ayam Bakar', 'lunch', 180, 355, 48.6, 2.5, 16.4],
  ['Nasi Putih', 'lunch', 200, 260, 5.4, 56.4, 0.6],
  ['Salad Sayur', 'lunch', 200, 76, 4.2, 12.8, 1.2],
  ['Ikan Salmon Panggang', 'dinner', 150, 312, 30.6, 0, 20.1],
  ['Tempe Goreng', 'dinner', 100, 225, 18.5, 9.4, 13.5],
  ['Protein Shake', 'snack', 300, 156, 28.8, 8.4, 2.1],
  ['Pisang', 'snack', 120, 107, 1.3, 27.4, 0.4],
];

const insertFood = db.prepare(
  `INSERT INTO foods (user_id, name, meal, portion_g, calories, protein_g, carbs_g, fat_g, source, confidence, logged_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`
);
const hours = { breakfast: 7, lunch: 12, dinner: 19, snack: 15 };

let foodCount = 0;
for (let day = 29; day >= 0; day--) {
  // 5 items a day, rotating through the list.
  for (let i = 0; i < 5; i++) {
    const [name, meal, g, kcal, p, c, f] = meals[(day * 5 + i) % meals.length];
    const scanned = i % 3 === 0;
    insertFood.run(userId, name, meal, g, kcal, p, c, f,
      scanned ? 'scan' : 'manual', scanned ? 88 + (day % 10) : null, iso(day, hours[meal]));
    foodCount++;
  }
}

/* ---------- steps ---------- */

const insertSteps = db.prepare(
  `INSERT INTO daily_stats (user_id, day, steps, distance_km) VALUES (?,?,?,?)
   ON CONFLICT(user_id, day) DO UPDATE SET steps=excluded.steps, distance_km=excluded.distance_km`
);
for (let day = 29; day >= 0; day--) {
  const steps = 6200 + ((day * 37) % 6000);
  insertSteps.run(userId, iso(day, 12).slice(0, 10), steps, +(steps * 0.000762).toFixed(2));
}

console.log(`
  Seeded demo account
  ───────────────────────────────
  email     ${EMAIL}
  password  ${PASSWORD}

  ${workoutCount} workouts · ${foodCount} food entries · 30 days of steps
`);
