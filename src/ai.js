/**
 * AI layer.
 *
 * With ANTHROPIC_API_KEY set, the coach uses Claude. Without it, the coach
 * uses a local fallback.
 *
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *
 * analyzeProgress() and searchFoods() are pure logic and never call the model.
 */

const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const USE_CLAUDE = Boolean(API_KEY);
const API_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 20_000;

if (USE_CLAUDE) {
  console.log(`  AI: Claude (${MODEL}) — live coach`);
} else {
  console.log('  AI: local mode — set ANTHROPIC_API_KEY for the live coach');
}

/**
 * One place that talks to the API. Returns the concatenated text of the
 * response, or throws — callers decide whether to fall back.
 */
async function callClaude({ system, messages, max_tokens = 600 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens, ...(system ? { system } : {}), messages }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Claude ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = await res.json();
    return (data.content || []).map((c) => c.text || '').join('').trim();
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the first JSON object out of a model reply, tolerating stray prose or fences. */
function parseJSON(text) {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON in model reply');
  return JSON.parse(cleaned.slice(start, end + 1));
}

const FOOD_DB = [
  { name: 'Nasi Goreng Telur', per100: { calories: 174, protein: 5.2, carbs: 24.1, fat: 6.1 }, typical: 250 },
  { name: 'Ayam Bakar', per100: { calories: 197, protein: 27.0, carbs: 1.4, fat: 9.1 }, typical: 180 },
  { name: 'Soto Ayam', per100: { calories: 61, protein: 5.5, carbs: 3.8, fat: 2.6 }, typical: 400 },
  { name: 'Gado-Gado', per100: { calories: 137, protein: 6.1, carbs: 10.2, fat: 8.4 }, typical: 300 },
  { name: 'Rendang Sapi', per100: { calories: 234, protein: 19.8, carbs: 4.2, fat: 15.3 }, typical: 150 },
  { name: 'Mie Goreng', per100: { calories: 186, protein: 5.8, carbs: 26.4, fat: 6.7 }, typical: 250 },
  { name: 'Sate Ayam', per100: { calories: 216, protein: 24.1, carbs: 5.9, fat: 10.8 }, typical: 160 },
  { name: 'Bakso Sapi', per100: { calories: 118, protein: 9.4, carbs: 8.1, fat: 5.2 }, typical: 350 },
  { name: 'Tempe Goreng', per100: { calories: 225, protein: 18.5, carbs: 9.4, fat: 13.5 }, typical: 100 },
  { name: 'Tahu Goreng', per100: { calories: 178, protein: 14.2, carbs: 5.4, fat: 11.6 }, typical: 100 },
  { name: 'Nasi Putih', per100: { calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3 }, typical: 200 },
  { name: 'Dada Ayam Panggang', per100: { calories: 165, protein: 31.0, carbs: 0, fat: 3.6 }, typical: 150 },
  { name: 'Telur Rebus', per100: { calories: 155, protein: 12.6, carbs: 1.1, fat: 10.6 }, typical: 100 },
  { name: 'Salad Sayur', per100: { calories: 38, protein: 2.1, carbs: 6.4, fat: 0.6 }, typical: 200 },
  { name: 'Oatmeal', per100: { calories: 68, protein: 2.4, carbs: 12.0, fat: 1.4 }, typical: 250 },
  { name: 'Pisang', per100: { calories: 89, protein: 1.1, carbs: 22.8, fat: 0.3 }, typical: 120 },
  { name: 'Alpukat', per100: { calories: 160, protein: 2.0, carbs: 8.5, fat: 14.7 }, typical: 150 },
  { name: 'Ikan Salmon Panggang', per100: { calories: 208, protein: 20.4, carbs: 0, fat: 13.4 }, typical: 150 },
  { name: 'Protein Shake', per100: { calories: 52, protein: 9.6, carbs: 2.8, fat: 0.7 }, typical: 300 },
  { name: 'Roti Gandum', per100: { calories: 247, protein: 13.0, carbs: 41.0, fat: 3.4 }, typical: 60 },
];

export function searchFoods(query) {
  const q = (query || '').toLowerCase().trim();
  const list = q ? FOOD_DB.filter((f) => f.name.toLowerCase().includes(q)) : FOOD_DB;
  return list.slice(0, 12).map((f) => ({ name: f.name, per100: f.per100, typical: f.typical }));
}

/* ============================================================
   WORKOUT ANALYSIS  (pure logic — no model)
   ============================================================ */

export function analyzeProgress({ workouts, foods, user }) {
  const now = Date.now();
  const within = (list, days) => list.filter((w) => now - new Date(w.logged_at).getTime() < days * 864e5);

  const recent = within(workouts, 30);
  const prior = workouts.filter((w) => {
    const age = now - new Date(w.logged_at).getTime();
    return age >= 30 * 864e5 && age < 60 * 864e5;
  });

  const volume = (list) =>
    list.reduce((sum, w) => sum + (w.exercises || []).reduce((s, e) => s + e.sets * e.reps * e.weight_kg, 0), 0);

  const vRecent = volume(recent);
  const vPrior = volume(prior);
  const delta = vPrior > 0 ? Math.round(((vRecent - vPrior) / vPrior) * 100) : null;

  const byType = {};
  for (const w of recent) byType[w.type] = (byType[w.type] || 0) + 1;

  const suggestions = [];
  if (recent.length === 0) {
    suggestions.push('Log your first workout to unlock trend analysis.');
  } else {
    const perWeek = (recent.length / 30) * 7;
    if (perWeek < 3) suggestions.push(`You average ${perWeek.toFixed(1)} sessions a week. Adding one more is the fastest lever you have.`);
    if (!byType.cardio) suggestions.push('No cardio logged in 30 days. Two Zone 2 sessions a week will raise your work capacity.');
    if (!byType.flexibility) suggestions.push('Add a 20-minute mobility block on rest days to protect your squat depth.');
    if (delta !== null && delta > 25) suggestions.push(`Volume is up ${delta}%. Schedule a deload week to stay ahead of fatigue.`);
    if (delta !== null && delta < -15) suggestions.push(`Volume dropped ${Math.abs(delta)}%. Rebuild with the weight you last hit for clean reps.`);
    if (suggestions.length === 0) suggestions.push('Consistent and progressing. Add 2.5 kg to your main lift this week.');
  }

  const avgCalories = (() => {
    const days = new Set(within(foods, 7).map((f) => f.logged_at.slice(0, 10)));
    if (days.size === 0) return 0;
    return Math.round(within(foods, 7).reduce((s, f) => s + f.calories, 0) / days.size);
  })();

  return {
    trends: {
      sessions30d: recent.length,
      volumeKg: Math.round(vRecent),
      volumeDelta: delta,
      minutes30d: recent.reduce((s, w) => s + w.duration_min, 0),
      caloriesBurned30d: recent.reduce((s, w) => s + w.calories, 0),
      avgDailyIntake7d: avgCalories,
    },
    breakdown: byType,
    suggestions: suggestions.slice(0, 3),
    nextWorkout: pickNextWorkout(byType),
  };
}

function pickNextWorkout(byType) {
  const strength = byType.strength || 0;
  const cardio = byType.cardio || 0;
  if (strength === 0) return 'Full Body Express — rebuild the base';
  if (cardio * 2 < strength) return 'HIIT Burner — balance the cardio deficit';
  return 'Push Day — progressive overload on bench';
}

/* ============================================================
   COACH CHAT
   ============================================================ */

function coachSystem(user, context) {
  const { caloriesToday, proteinToday, workoutsThisWeek, analysis } = context;
  const toneGuide = {
    supportive: 'Nada: hangat dan mendukung, tapi tetap jujur.',
    direct: 'Nada: langsung ke poin, tanpa basa-basi.',
    tough: 'Nada: tough love — tegas, menantang, tapi tetap peduli.',
  }[user.coach_tone] || 'Nada: hangat dan mendukung.';

  return `Kamu pelatih kebugaran & gizi pribadi di dalam aplikasi FitFlow. ${toneGuide}

Data user saat ini (pakai angka ini, jangan mengarang):
- Nama: ${user.name}
- Goal: ${user.goal} (lose = defisit, maintain = seimbang, gain = surplus)
- Berat: ${user.weight_kg} kg, tinggi: ${user.height_cm} cm, umur: ${user.age}
- Target harian: ${user.target_calories} kkal, protein ${user.target_protein} g, karbo ${user.target_carbs} g, lemak ${user.target_fat} g
- Hari ini sudah masuk: ${caloriesToday} kkal, ${Math.round(proteinToday)} g protein
- Latihan minggu ini: ${workoutsThisWeek} sesi
- 30 hari terakhir: ${analysis.trends.sessions30d} sesi, ${analysis.trends.volumeKg} kg total volume${analysis.trends.volumeDelta !== null ? ` (${analysis.trends.volumeDelta >= 0 ? '+' : ''}${analysis.trends.volumeDelta}% vs bulan lalu)` : ''}

Aturan:
- Jawab dalam BAHASA YANG SAMA dengan pesan user (Indonesia atau Inggris).
- Ringkas: 2-4 kalimat. Spesifik ke angka user di atas.
- Beri saran yang bisa langsung dilakukan. Jangan memberi klaim/diagnosis medis.
- Kamu bukan dokter; untuk masalah kesehatan serius, sarankan konsultasi profesional.`;
}

export async function coachReply({ message, user, context }) {
  if (USE_CLAUDE) {
    try {
      const reply = await callClaude({
        system: coachSystem(user, context),
        messages: [{ role: 'user', content: message }],
        max_tokens: 500,
      });
      if (reply) return reply;
    } catch (err) {
      console.error('[ai] coach fell back to mock:', err.message);
    }
  }
  return mockCoachReply({ message, user, context });
}

/** Offline fallback: keyword-routed replies grounded in the same real numbers. */
function mockCoachReply({ message, user, context }) {
  const m = (message || '').toLowerCase();
  const tone = user.coach_tone || 'supportive';
  const { caloriesToday, proteinToday, workoutsThisWeek, analysis } = context;

  const open = {
    supportive: ['Good question.', 'Love that you asked.', "Here's what I'd do."],
    direct: ['Straight answer:', 'Here it is:', 'No fluff:'],
    tough: ["Let's not overthink this.", 'Real talk:', 'You already know this, but:'],
  }[tone] || ['Here it is:'];

  const lead = open[(message || '').length % open.length];
  const remaining = Math.max(0, user.target_calories - caloriesToday);
  const proteinLeft = Math.max(0, user.target_protein - proteinToday);

  let body;
  if (/protein/.test(m)) {
    body = proteinLeft > 0
      ? `You're at ${Math.round(proteinToday)} g of ${user.target_protein} g today, so ${Math.round(proteinLeft)} g to go. That's roughly ${Math.ceil(proteinLeft / 31)} portions of grilled chicken breast, or a protein shake plus two eggs. Front-load it at dinner rather than chasing it before bed.`
      : `You've already cleared your ${user.target_protein} g target at ${Math.round(proteinToday)} g. Anything extra is fine but not doing much — put the attention on carbs around training instead.`;
  } else if (/calorie|kalori|deficit|surplus|makan/.test(m)) {
    body = remaining > 0
      ? `You have ${remaining} kcal left of ${user.target_calories} today. With a "${user.goal}" goal, spend most of it on protein and vegetables at dinner — that keeps you full without eating into tomorrow.`
      : `You're ${caloriesToday - user.target_calories} kcal over your ${user.target_calories} target. One day doesn't undo anything. Keep tomorrow normal rather than cutting hard to compensate.`;
  } else if (/workout|latihan|gym|train|exercise|olahraga/.test(m)) {
    body = `You've logged ${workoutsThisWeek} session${workoutsThisWeek === 1 ? '' : 's'} this week. Based on your last 30 days, I'd put you on: ${analysis.nextWorkout}. ${analysis.suggestions[0]}`;
  } else if (/sleep|tidur|recover|rest|istirahat/.test(m)) {
    body = `Recovery is where the training actually lands. Seven to nine hours, consistent wake time, and no hard sessions two days in a row. If you're sore beyond 48 hours, that's a volume problem, not a toughness problem.`;
  } else if (/lose|turun|cut|diet|kurus|weight|berat/.test(m)) {
    body = `Your target is ${user.target_calories} kcal at ${user.target_protein} g protein. Hold that, keep lifting, and let the scale move slowly — 0.5 to 0.75% of bodyweight a week. Faster than that and you're spending muscle you'll want later.`;
  } else if (/plan|rencana|routine|program|schedule|jadwal/.test(m)) {
    body = `Here's a clean week: three lifts (Push, Pull, Legs), two Zone 2 cardio sessions of 30 minutes, one mobility block. Start with ${analysis.nextWorkout.split('—')[0].trim()}. Adjust weight so the last rep of every set is hard but clean.`;
  } else if (/^(hi|hello|hey|halo|hai)\b/.test(m.trim())) {
    body = `I've got your numbers in front of me: ${caloriesToday} kcal and ${Math.round(proteinToday)} g protein today, ${workoutsThisWeek} workouts this week. Ask me about training, food, or what to do next.`;
  } else {
    body = `Based on your last 30 days — ${analysis.trends.sessions30d} sessions, ${analysis.trends.volumeKg.toLocaleString()} kg moved — the one thing worth changing is this: ${analysis.suggestions[0]} Want me to build that into your week?`;
  }
  return `${lead} ${body}`;
}

/* ============================================================
   DASHBOARD INSIGHT  (rule-based — fast, deterministic)
   ============================================================ */

export function dailyInsight({ user, caloriesToday, proteinToday, workoutsThisWeek, streak }) {
  const pct = user.target_calories ? caloriesToday / user.target_calories : 0;
  if (streak >= 3) return `${streak}-day logging streak. Consistency like this is what actually moves the needle.`;
  if (workoutsThisWeek === 0) return 'No sessions logged this week yet. A 30-minute Full Body Express is enough to keep momentum.';
  if (pct < 0.35) return `Only ${caloriesToday} kcal in so far. Under-eating on a training day costs you the session tomorrow.`;
  if (pct > 1.1) return `You're over your calorie target today. Not a problem on its own — just keep tomorrow steady.`;
  if (proteinToday < user.target_protein * 0.5) return `Protein is at ${Math.round(proteinToday)} g of ${user.target_protein} g. Make the next meal the one that fixes it.`;
  return `${workoutsThisWeek} session${workoutsThisWeek === 1 ? '' : 's'} this week and macros on track. Keep the pattern.`;
}
