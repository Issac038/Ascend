// Starter exercise library — a sensible reusable starting point, not a
// complete database. Users can always add custom exercises in the builder.
export const EXERCISE_LIBRARY = [
    {
        group: "Chest",
        items: [
            { name: "Bench Press", type: "reps", sets: 4, reps: 8 },
            { name: "Incline Bench Press", type: "reps", sets: 3, reps: 10 },
            { name: "Dumbbell Press", type: "reps", sets: 3, reps: 10 },
            { name: "Incline Dumbbell Press", type: "reps", sets: 3, reps: 10 },
            { name: "Cable Fly", type: "reps", sets: 3, reps: 12 },
            { name: "Push-up", type: "reps", sets: 3, reps: 15 }
        ]
    },
    {
        group: "Back",
        items: [
            { name: "Lat Pulldown", type: "reps", sets: 4, reps: 10 },
            { name: "Seated Cable Row", type: "reps", sets: 3, reps: 10 },
            { name: "Barbell Row", type: "reps", sets: 4, reps: 8 },
            { name: "Deadlift", type: "reps", sets: 3, reps: 5 },
            { name: "Pull-up", type: "reps", sets: 3, reps: 8 }
        ]
    },
    {
        group: "Shoulders",
        items: [
            { name: "Shoulder Press", type: "reps", sets: 3, reps: 10 },
            { name: "Lateral Raise", type: "reps", sets: 3, reps: 12 },
            { name: "Rear Delt Fly", type: "reps", sets: 3, reps: 12 },
            { name: "Face Pull", type: "reps", sets: 3, reps: 15 }
        ]
    },
    {
        group: "Arms",
        items: [
            { name: "Bicep Curl", type: "reps", sets: 3, reps: 10 },
            { name: "Hammer Curl", type: "reps", sets: 3, reps: 10 },
            { name: "Tricep Pushdown", type: "reps", sets: 3, reps: 12 },
            { name: "Overhead Tricep Extension", type: "reps", sets: 3, reps: 12 }
        ]
    },
    {
        group: "Legs",
        items: [
            { name: "Squat", type: "reps", sets: 4, reps: 8 },
            { name: "Leg Press", type: "reps", sets: 3, reps: 10 },
            { name: "Leg Curl", type: "reps", sets: 3, reps: 12 },
            { name: "Leg Extension", type: "reps", sets: 3, reps: 12 },
            { name: "Calf Raise", type: "reps", sets: 4, reps: 15 },
            { name: "Romanian Deadlift", type: "reps", sets: 3, reps: 10 },
            { name: "Lunge", type: "reps", sets: 3, reps: 12 }
        ]
    },
    {
        group: "Core",
        items: [
            { name: "Plank", type: "duration", sets: 3, durationSec: 60 },
            { name: "Hanging Leg Raise", type: "reps", sets: 3, reps: 10 },
            { name: "Crunch", type: "reps", sets: 3, reps: 15 },
            { name: "Russian Twist", type: "reps", sets: 3, reps: 20 }
        ]
    },
    {
        group: "Cardio",
        items: [
            { name: "Treadmill", type: "duration", sets: 1, durationSec: 1200 },
            { name: "Running", type: "duration", sets: 1, durationSec: 1800 },
            { name: "Cycling", type: "duration", sets: 1, durationSec: 1800 },
            { name: "Walking", type: "duration", sets: 1, durationSec: 2400 },
            { name: "Rowing Machine", type: "duration", sets: 1, durationSec: 900 },
            { name: "Jump Rope", type: "duration", sets: 3, durationSec: 120 }
        ]
    }
];
