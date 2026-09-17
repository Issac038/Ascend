const mongoose = require("mongoose");

const goalSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        title: { type: String, required: true, trim: true, maxlength: 120 },
        description: { type: String, default: "", maxlength: 1000 },
        area: { type: String, required: true, maxlength: 30 },
        horizon: {
            type: String,
            enum: ["short", "medium", "long"],
            default: "medium"
        },
        deadline: { type: String, default: null },
        milestones: [
            {
                title: { type: String, required: true, maxlength: 120 },
                done: { type: Boolean, default: false }
            }
        ],
        habitIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Habit" }],
        taskIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Task" }],
        notes: { type: String, default: "", maxlength: 4000 },
        status: {
            type: String,
            enum: ["active", "completed", "archived"],
            default: "active"
        },
        completedAt: { type: Date, default: null },
        progressCache: { type: Number, default: 0, min: 0, max: 100 }
    },
    { timestamps: true }
);

module.exports = mongoose.model("Goal", goalSchema);
