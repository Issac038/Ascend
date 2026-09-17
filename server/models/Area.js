const mongoose = require("mongoose");

const areaSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        key: { type: String, required: true, maxlength: 30 },
        name: { type: String, required: true, trim: true, maxlength: 40 },
        focus: { type: Boolean, default: false },
        order: { type: Number, default: 0 },
        archived: { type: Boolean, default: false }
    },
    { timestamps: true }
);

module.exports = mongoose.model("Area", areaSchema);
