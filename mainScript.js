require('dotenv').config();
const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const { Telegraf } = require('telegraf');
const fs = require('fs').promises;
const path = require('path');
const screenshot = require('screenshot-desktop');
const OpenAI = require('openai');
const sharp = require('sharp'); // Add this for image optimization

// Initialize bot, AI services, and OpenAI API
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_IDS = new Set((process.env.CHAT_IDS || '').split(',').map(id => id.trim()));
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!BOT_TOKEN || CHAT_IDS.size === 0 || !GEMINI_API_KEY || !OPENAI_API_KEY) {
  console.error("Environment variables BOT_TOKEN, CHAT_IDS, GEMINI_API_KEY, or OPENAI_API_KEY are not defined correctly.");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(GEMINI_API_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const GENERATIVE_MODEL_NAME = "gemini-1.5-flash"; // Updated model name

// Gemini AI generation config
const GENERATION_CONFIG = {
  temperature: 0.4,
  topK: 32,
  topP: 1,
  maxOutputTokens: 4096,
};

// Initialize Gemini model
let model;

try {
  model = genAI.getGenerativeModel({ model: GENERATIVE_MODEL_NAME });
} catch (error) {
  console.error("Error initializing generative model:", error);
  process.exit(1);
}

// Function to take a screenshot, optimize it, and save it to a file
async function takeScreenshot() {
  const screenshotPath = path.resolve(__dirname, `screenshot-${Date.now()}.png`);
  try {
    const img = await screenshot({ format: 'png' });
    await sharp(img)
      .resize(1280) // Resize to a maximum width of 1280px
      .jpeg({ quality: 80 }) // Convert to JPEG with 80% quality
      .toFile(screenshotPath);
    return screenshotPath;
  } catch (error) {
    throw new Error(`Failed to take or optimize screenshot: ${error.message}`);
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
    const file = await uploadToGemini(imagePath, "image/jpeg");
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

// Function to ask ChatGPT for the correct answer based on the extracted text
async function getAnswerFromChatGPT(promptText) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4-0613", // Updated to the latest GPT-4 model
      messages: [
        {
          role: "system",
          content: "You are a highly accurate quiz answer bot.",
        },
        {
          role: "user",
          content: `The extracted text from the image is: "${promptText}". Please provide the answer in the format: (Question number): ([Option number/name], [Answer])`,
        },
      ],
      max_tokens: 50,
    });

    const answer = completion.choices[0].message.content.trim();
    return answer;
  } catch (error) {
    console.error("Error fetching answer from ChatGPT:", error);
    return "Failed to get the answer from ChatGPT.";
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
      // Send a "processing" message to indicate the bot is working
      const processingMsg = await ctx.reply("Processing your request...");

      const screenshotPath = await takeScreenshot();

      // Start both Gemini and OpenAI processes concurrently
      const [extractedText, documentSent] = await Promise.all([
        extractTextFromImage(screenshotPath),
        ctx.replyWithDocument({ source: screenshotPath })
      ]);

      if (extractedText) {
        // Send the extracted text
        await ctx.reply("Extracted text:\n\n" + extractedText);

        // Get and send the ChatGPT answer
        const chatGptAnswer = await getAnswerFromChatGPT(extractedText);
        await ctx.reply("ChatGPT Answer:\n\n" + chatGptAnswer);
      } else {
        await ctx.reply("Failed to extract text from the image.");
      }

      // Clean up
      await fs.unlink(screenshotPath);
      await ctx.deleteMessage(processingMsg.message_id);
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
