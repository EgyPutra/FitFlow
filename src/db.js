import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Vercel Functions have a read-only deployment filesystem. `/tmp` lets the
// demo run there; use a managed database before relying on data persistence.
const isServerless = Boolean(
  process.env.VERCEL || process.env.VERCEL_REGION || process.env.NOW_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME
);
const DB_PATH = process.env.DATABASE_PATH || (isServerless
  ? '/tmp/fitflow.db'
  : resolve(process.cwd(), 'data/fitflow.db'));
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  avatar_emoji  TEXT    NOT NULL DEFAULT '🔥',
  height_cm     INTEGER,
  weight_kg     REAL,
  age           INTEGER,
  sex           TEXT,
  activity_level TEXT   NOT NULL DEFAULT 'moderate',
  goal          TEXT    NOT NULL DEFAULT 'maintain',
  coach_tone    TEXT    NOT NULL DEFAULT 'supportive',
  target_calories INTEGER NOT NULL DEFAULT 2200,
  target_protein  INTEGER NOT NULL DEFAULT 140,
  target_carbs    INTEGER NOT NULL DEFAULT 250,
  target_fat      INTEGER NOT NULL DEFAULT 70,
  target_steps    INTEGER NOT NULL DEFAULT 10000,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workouts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL DEFAULT 'strength',
  duration_min INTEGER NOT NULL DEFAULT 0,
  calories    INTEGER NOT NULL DEFAULT 0,
  notes       TEXT,
  logged_at   TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts(user_id, logged_at DESC);

CREATE TABLE IF NOT EXISTS workout_exercises (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  sets       INTEGER NOT NULL DEFAULT 0,
  reps       INTEGER NOT NULL DEFAULT 0,
  weight_kg  REAL    NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_exercises_workout ON workout_exercises(workout_id);

CREATE TABLE IF NOT EXISTS foods (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name      TEXT    NOT NULL,
  meal      TEXT    NOT NULL DEFAULT 'lunch',
  portion_g REAL    NOT NULL DEFAULT 100,
  calories  INTEGER NOT NULL DEFAULT 0,
  protein_g REAL    NOT NULL DEFAULT 0,
  carbs_g   REAL    NOT NULL DEFAULT 0,
  fat_g     REAL    NOT NULL DEFAULT 0,
  source    TEXT    NOT NULL DEFAULT 'manual',
  confidence INTEGER,
  logged_at TEXT    NOT NULL,
  created_at TEXT   NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_foods_user_date ON foods(user_id, logged_at DESC);

CREATE TABLE IF NOT EXISTS daily_stats (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day      TEXT    NOT NULL,
  steps    INTEGER NOT NULL DEFAULT 0,
  distance_km REAL NOT NULL DEFAULT 0,
  UNIQUE(user_id, day)
);

CREATE TABLE IF NOT EXISTS routines (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name      TEXT    NOT NULL,
  type      TEXT    NOT NULL DEFAULT 'strength',
  duration_min INTEGER NOT NULL DEFAULT 45,
  exercises TEXT    NOT NULL DEFAULT '[]',
  is_template INTEGER NOT NULL DEFAULT 0,
  created_at TEXT   NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS coach_messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT    NOT NULL,
  content   TEXT    NOT NULL,
  created_at TEXT   NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_coach_user ON coach_messages(user_id, id);
`);

// Global routine templates, seeded once.
const templateCount = db.prepare('SELECT COUNT(*) AS n FROM routines WHERE is_template = 1').get().n;
if (templateCount === 0) {
  const insert = db.prepare(
    'INSERT INTO routines (user_id, name, type, duration_min, exercises, is_template) VALUES (NULL, ?, ?, ?, ?, 1)'
  );
  const templates = [
    ['Push Day', 'strength', 50, [
      { name: 'Bench Press', sets: 4, reps: 8, weight_kg: 60 },
      { name: 'Overhead Press', sets: 3, reps: 10, weight_kg: 35 },
      { name: 'Incline Dumbbell Press', sets: 3, reps: 12, weight_kg: 20 },
      { name: 'Triceps Pushdown', sets: 3, reps: 15, weight_kg: 25 },
    ]],
    ['Pull Day', 'strength', 50, [
      { name: 'Deadlift', sets: 4, reps: 5, weight_kg: 100 },
      { name: 'Pull-up', sets: 4, reps: 8, weight_kg: 0 },
      { name: 'Barbell Row', sets: 3, reps: 10, weight_kg: 50 },
      { name: 'Face Pull', sets: 3, reps: 15, weight_kg: 20 },
    ]],
    ['Leg Day', 'strength', 55, [
      { name: 'Back Squat', sets: 4, reps: 6, weight_kg: 80 },
      { name: 'Romanian Deadlift', sets: 3, reps: 10, weight_kg: 60 },
      { name: 'Leg Press', sets: 3, reps: 12, weight_kg: 120 },
      { name: 'Calf Raise', sets: 4, reps: 15, weight_kg: 40 },
    ]],
    ['Full Body Express', 'strength', 30, [
      { name: 'Goblet Squat', sets: 3, reps: 12, weight_kg: 24 },
      { name: 'Push-up', sets: 3, reps: 15, weight_kg: 0 },
      { name: 'Dumbbell Row', sets: 3, reps: 12, weight_kg: 22 },
      { name: 'Plank', sets: 3, reps: 45, weight_kg: 0 },
    ]],
    ['HIIT Burner', 'cardio', 25, [
      { name: 'Burpee', sets: 5, reps: 12, weight_kg: 0 },
      { name: 'Mountain Climber', sets: 5, reps: 30, weight_kg: 0 },
      { name: 'Jump Squat', sets: 5, reps: 15, weight_kg: 0 },
    ]],
    ['Easy Run', 'cardio', 35, [
      { name: 'Zone 2 Run', sets: 1, reps: 35, weight_kg: 0 },
    ]],
    ['Mobility & Core', 'flexibility', 20, [
      { name: 'Cat-Cow', sets: 2, reps: 10, weight_kg: 0 },
      { name: 'Hip Flexor Stretch', sets: 2, reps: 30, weight_kg: 0 },
      { name: 'Dead Bug', sets: 3, reps: 12, weight_kg: 0 },
    ]],
  ];
  for (const [name, type, mins, ex] of templates) {
    insert.run(name, type, mins, JSON.stringify(ex));
  }
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
