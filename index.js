require("dotenv").config();
const { Telegraf } = require("telegraf");
const axios = require("axios");
const { MongoClient } = require("mongodb");
const https = require("https");

const bot = new Telegraf(process.env.BOT_TOKEN);
const BASE_URL = "https://alphaapis.org/terabox?id="; // Corrected API endpoint
const CHANNEL_USERNAME = "@Potterhub";
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
    // Improved regex to handle various TeraBox URL formats
    const match = text.match(/(?:\/s\/|id=|v=)([a-zA-Z0-9_-]+)/);
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
        const response = await axios.get(`${BASE_URL}${videoId}`, { 
            httpsAgent: agent,
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });
        console.log("API Response:", response.data);

        // Check response structure based on API docs
        if (!response.data || response.data.status !== "success") {
            const errorMsg = response.data?.message || "Failed to fetch video";
            return ctx.reply(`❌ ${errorMsg}. Please check the link.`);
        }

        const downloadUrl = response.data.data.download_url;
        const fileName = response.data.data.file_name;
        const fileSize = response.data.data.file_size || 0;

        console.log("Download URL:", downloadUrl);
        console.log("File Name:", fileName);

        if (!downloadUrl) {
            return ctx.reply("❌ No download link found in API response.");
        }

        // Convert file size to bytes if it's in MB format
        const sizeInBytes = typeof fileSize === 'string' && fileSize.includes('MB') 
            ? parseFloat(fileSize) * 1024 * 1024 
            : fileSize;

        if (sizeInBytes > 50000000) { // 50MB Telegram limit
            return ctx.reply(`🚨 Video is too large for Telegram (${fileSize})! Download manually: ${downloadUrl}`);
        }

        await ctx.reply("✅ Video found! 🔄 Downloading...");

        // Stream video directly to Telegram
        const videoResponse = await axios({
            method: "GET",
            url: downloadUrl,
            responseType: "stream",
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });

        await ctx.replyWithVideo(
            { source: videoResponse.data },
            { 
                caption: fileName || "Downloaded via TeraBox Bot",
                disable_notification: true
            }
        );

        await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    } catch (error) {
        console.error("Error in processing:", {
            message: error.message,
            response: error.response?.data,
            stack: error.stack
        });
        ctx.reply("❌ Something went wrong. Please try again later.");
    }
});

bot.launch();
console.log("🚀 TeraBox Video Bot is running...");
