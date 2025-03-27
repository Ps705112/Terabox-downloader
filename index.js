require("dotenv").config();
const { Telegraf } = require("telegraf");
const axios = require("axios");
const { MongoClient } = require("mongodb");
const https = require("https");

const bot = new Telegraf(process.env.BOT_TOKEN);
const BASE_URL = "https://alphaapis.org/terabox/v3/dl?id="; // Updated API link
const CHANNEL_USERNAME = "@awt_bots";
const MONGO_URI = process.env.MONGO_URI;

// Create HTTP agent for faster persistent connections
const agent = new https.Agent({ keepAlive: true, maxSockets: 10 });

const client = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
let usersCollection;

(async () => {
    await client.connect();
    usersCollection = client.db("telegramBot").collection("users");
    console.log("📂 Connected to MongoDB");
})();

async function isUserMember(userId) {
    try {
        const chatMember = await bot.telegram.getChatMember(CHANNEL_USERNAME, userId);
        return ["member", "administrator", "creator"].includes(chatMember.status);
    } catch (error) {
        console.error("Error checking membership:", error.message);
        return false;
    }
}

async function saveUser(userId) {
    await usersCollection.updateOne({ userId }, { $set: { userId } }, { upsert: true });
}

function extractTeraboxId(text) {
    const match = text.match(/\/s\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : text.trim();
}

bot.start((ctx) => ctx.reply("Send me a TeraBox link or Video ID, and I'll download it for you!"));

bot.on("text", async (ctx) => {
    const userId = ctx.from.id;
    if (!(await isUserMember(userId))) {
        return ctx.reply(`❌ You must join ${CHANNEL_USERNAME} to use this bot.`);
    }
    await saveUser(userId);

    const text = ctx.message.text.trim();
    const videoId = extractTeraboxId(text);

    if (!videoId) {
        return ctx.reply("❌ Invalid TeraBox link. Please send a correct link or ID.");
    }

    console.log("Extracted Video ID:", videoId);
    const processingMsg = await ctx.reply("⏳ Fetching video link...");

    try {
        const response = await axios.get(`${BASE_URL}${videoId}`, { httpsAgent: agent }); // Faster API request
        console.log("API Response:", response.data);

        if (!response.data || response.data.success !== true) {
            return ctx.reply("❌ Failed to fetch video. Please check the link.");
        }

        const downloadUrl = response.data.data.downloadLink;
        const fileSize = parseInt(response.data.data.size, 10) || 0;

        console.log("Download URL:", downloadUrl);

        if (!downloadUrl) {
            return ctx.reply("❌ No download link found.");
        }

        if (fileSize > 50000000) {
            return ctx.reply(`🚨 Video is too large for Telegram! Download manually: ${downloadUrl}`);
        }

        await ctx.reply("✅ Video found! 🔄 Downloading...");

        // Stream video directly to Telegram without saving to disk
        const videoStream = await axios({
            method: "GET",
            url: downloadUrl,
            responseType: "stream",
        });

        await ctx.replyWithVideo(
            { source: videoStream.data }, 
            { disable_notification: true } // Speeds up Telegram upload
        );

        await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    } catch (error) {
        console.error("Error fetching Terabox video:", error.message);
        ctx.reply("❌ Something went wrong. Try again later.");
    }
});

bot.launch();
console.log("🚀 TeraBox Video Bot is running...");
