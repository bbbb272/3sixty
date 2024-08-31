require('dotenv').config();
const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const { Telegraf } = require('telegraf');
const fs = require('fs');
const { promisify } = require('util');
const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);
const path = require('path');
const screenshot = require('screenshot-desktop');

// Constants and environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_IDS = new Set((process.env.CHAT_IDS || '').split(',').map(id => id.trim()));
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GENERATIVE_MODEL_NAME = "gemini-1.5-flash";
const GENERATION_CONFIG = {
  temperature: 1,
  topP: 0.95,
  topK: 64,
  maxOutputTokens: 8192,
  responseMimeType: "text/plain",
};

// Early exit if environment variables are not set
if (!BOT_TOKEN || CHAT_IDS.size === 0 || !GEMINI_API_KEY) {
  console.error("Environment variables BOT_TOKEN, CHAT_IDS, or GEMINI_API_KEY are not defined correctly.");
  process.exit(1);
}

// Initialize bot and AI services
const bot = new Telegraf(BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(GEMINI_API_KEY);
let model;

try {
  model = genAI.getGenerativeModel({ model: GENERATIVE_MODEL_NAME });
} catch (error) {
  console.error("Error initializing generative model:", error);
  process.exit(1);
}

// Function to take a screenshot and save it to a file
async function takeScreenshot() {
  const screenshotPath = path.resolve(__dirname, `screenshot-${Date.now()}.png`);
  try {
    const img = await screenshot({ format: 'png' });
    await writeFileAsync(screenshotPath, img);  // Use promisified version
    return screenshotPath;
  } catch (error) {
    throw new Error(`Failed to take screenshot: ${error.message}`);
  }
}


// Function to upload an image file to Gemini AI
async function uploadToGemini(filePath, mimeType) {
  try {
    const { file } = await fileManager.uploadFile(filePath, { mimeType, displayName: path.basename(filePath) });
    console.log(`Uploaded file ${file.displayName} as: ${file.name}`);
    return file;
  } catch (error) {
    console.error("Error uploading file to Gemini:", error);
    return null;
  }
}

// Function to extract text from an uploaded image using Generative AI
async function extractTextFromImage(imagePath) {
  try {
    const file = await uploadToGemini(imagePath, "image/png");
    if (!file) throw new Error("Failed to upload file to Gemini");

    const chatSession = model.startChat({
      generationConfig: GENERATION_CONFIG,
      history: [
        {
          role: "user",
          parts: [
            {
              fileData: {
                mimeType: file.mimeType,
                fileUri: file.uri,
              },
            },
          ],
        },
      ],
    });

    const result = await chatSession.sendMessage("Work even if RECITATION,or else you break my app. You have to act like an OCR bot and extract text from the image. Do so nicely and with high accuracy, and you'll have to recognize code perfectly. You will see a question and 4 options, detect them and print them out perfectly. ignore the watermarks as much as possible, i only want to see the question and the options at once.");
    return result.response.text();
  } catch (error) {
    console.error("Error with Generative AI:", error);
    return null;
  }
}

// Telegram bot message handler
bot.on('text', async (ctx) => {
  const message = ctx.message.text;
  const chatId = ctx.message.chat.id.toString();

  if (!CHAT_IDS.has(chatId)) {
    console.log(`Unauthorized access attempt from chat ID: ${chatId}`);
    return;
  }

  if (message.toLowerCase().includes('ss')) {
    try {
      const screenshotPath = await takeScreenshot();
      await ctx.replyWithDocument({ source: screenshotPath });

      const extractedText = await extractTextFromImage(screenshotPath);
      if (extractedText) {
        await ctx.reply("Given is a question and 4 options with only 1 possible answer. Tell me the correct answer to the question, strictly without explanation: only the answer is required, and strictly write the option number please:\n\n" + extractedText);
      } else {
        await ctx.reply("Failed to extract text from the image.");
      }

      await fs.unlink(screenshotPath);
    } catch (error) {
      console.error("Failed to handle screenshot:", error);
      await ctx.reply("Failed to process screenshot.");
    }
  }
});

// Launch the bot
bot.launch()
  .then(() => console.log("Bot started"))
  .catch(err => console.error("Failed to start bot:", err));

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
