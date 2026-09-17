const mongoose = require("mongoose");

const journalEntrySchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        date: { type: String, required: true }, // YYYY-MM-DD
        text: { type: String, default: "", maxlength: 8000 },

        prompts: {
            wentWell: { type: String, default: "", maxlength: 2000 },
            couldImprove: { type: String, default: "", maxlength: 2000 },
            learned: { type: String, default: "", maxlength: 2000 },
            proudOf: { type: String, default: "", maxlength: 2000 },
            tomorrow: { type: String, default: "", maxlength: 2000 }
        },

        mood: { type: Number, min: 1, max: 5, default: null },
        energy: { type: Number, min: 1, max: 5, default: null },
        stress: { type: Number, min: 1, max: 5, default: null },
        confidence: { type: Number, min: 1, max: 5, default: null },

        dayScore: { type: Number, default: null } // cached day score at write time
    },
    { timestamps: true }
);

journalEntrySchema.index({ userId: 1, date: 1 });

module.exports = mongoose.model("JournalEntry", journalEntrySchema);
