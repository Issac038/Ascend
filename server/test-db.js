require("dotenv").config();
const mongoose = require("mongoose");

async function test() {
    try {
        console.log("Connecting to MongoDB...");

        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 10000
        });

        console.log("SUCCESS: MongoDB connection works");

        await mongoose.connection.db.admin().ping();

        console.log("SUCCESS: MongoDB ping works");

        await mongoose.disconnect();
    } catch (error) {
        console.error("FAILED:");
        console.error(error);
    }
}

test();