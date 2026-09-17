const { todayKey, addDays, startOfWeek, endOfMonth, startOfMonth, eachDay, diffDays } = require("./date");

// ============================================================
// ACHIEVEMENT DEFINITIONS
// ============================================================
// Each definition receives a context with all user data and
// returns true when earned. They are pure functions — no side effects.

function defineAchievements() {
    const list = [
        {
            code: "FIRST_STEP",
            name: "First Step",
            description: "Complete your first tracked action.",
            how: "Complete any habit or task once.",
            check: (c) => c.totalActions >= 1
        },
        {
            code: "SEVEN_DAYS",
            name: "7 Days",
            description: "Hold a 7-day streak.",
            how: "Score at least 30 points for 7 days in a row.",
            check: (c) => c.bestStreak >= 7
        },
        {
            code: "THIRTY_DAYS",
            name: "30 Days",
            description: "Hold a 30-day streak.",
            how: "Thirty consistent days. This is discipline.",
            check: (c) => c.bestStreak >= 30
        },
        {
            code: "FIRST_GOAL",
            name: "First Goal",
            description: "Complete your first goal.",
            how: "Move a goal to 100%.",
            check: (c) => c.completedGoals >= 1
        },
        {
            code: "THREE_GOALS",
            name: "Triple Delivered",
            description: "Complete three goals.",
            how: "Finish three goals.",
            check: (c) => c.completedGoals >= 3
        },
        {
            code: "COMEBACK",
            name: "Comeback",
            description: "Return after missing multiple days.",
            how: "Score 50+ today after 3+ missed days.",
            check: (c) => {
                if (!c.todayScore || c.todayScore < 50) return false;
                // look back: 3 consecutive missed days before today
                let missed = 0;
                for (let i = 1; i <= 3; i += 1) {
                    const d = c.scoresByDate[addDays(c.today, -i)];
                    if (!d || d.score === null) missed += 1;
                    else break;
                }
                return missed >= 3;
            }
        },
        {
            code: "HUNDRED_ACTIONS",
            name: "100 Actions",
            description: "Complete 100 tracked actions.",
            how: "Habits and tasks combined.",
            check: (c) => c.totalActions >= 100
        },
        {
            code: "FIVE_HUNDRED_ACTIONS",
            name: "500 Actions",
            description: "Complete 500 tracked actions.",
            how: "Half a thousand reps. Relentless.",
            check: (c) => c.totalActions >= 500
        },
        {
            code: "REFLECTIVE",
            name: "Reflective",
            description: "Write 10 journal entries.",
            how: "Ten reflections logged.",
            check: (c) => c.journalCount >= 10
        },
        {
            code: "WEEK_WARRIOR",
            name: "Week Warrior",
            description: "Perfect week — every scheduled action done.",
            how: "7 days at 100% (min 3 scheduled/day).",
            check: (c) => {
                let perfect = 0;
                for (const day of c.weekDays) {
                    const s = c.scoresByDate[day];
                    if (s && s.score >= 100 && s.scheduled >= 3) perfect += 1;
                }
                return perfect >= 7;
            }
        },
        {
            code: "EARLY_BIRD",
            name: "Early Bird",
            description: "Complete your morning block 10 times.",
            how: "Clear your morning tasks 10 days.",
            check: (c) => c.morningBlocks >= 10
        },
        {
            code: "ALL_AREAS",
            name: "Whole Self",
            description: "Track progress in every default area.",
            how: "Have goals or habits in all 9 areas.",
            check: (c) => {
                const set = new Set();
                for (const g of c.goals) set.add(g.area);
                for (const h of c.habits) set.add(h.area);
                for (const a of ["body", "mind", "discipline", "learning", "productivity", "relationships", "finances", "skills", "personal"]) {
                    if (!set.has(a)) return false;
                }
                return true;
            }
        }
    ];

    return list;
}

// ============================================================
// EVALUATION CONTEXT
// ============================================================

function buildContext({
    goals,
    habits,
    dayScores,
    journalCount,
    today,
    weekDays,
    morningBlocks
}) {
    let totalActions = 0;
    for (const d of dayScores) {
        totalActions += (d.habitsDone || 0) + (d.tasksDone || 0);
    }

    const scoresByDate = {};
    for (const d of dayScores) scoresByDate[d.date] = d;

    const completedGoals = goals.filter((g) => g.status === "completed").length;
    const bestStreak = dayScores.reduce((m, d) => Math.max(m, d.bestStreak || 0), 0);

    return {
        goals,
        habits,
        dayScores,
        scoresByDate,
        totalActions,
        completedGoals,
        bestStreak,
        journalCount,
        today,
        weekDays,
        morningBlocks
    };
}

module.exports = {
    ACHIEVEMENTS: defineAchievements(),
    buildContext
};
