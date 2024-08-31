require('dotenv').config();  // Load environment variables from .env file
const TelegramBot = require('node-telegram-bot-api');
const winston = require('winston');

// Initialize logging with winston
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} - ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

// Load the bot token from the environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  logger.error('BOT_TOKEN environment variable is not set.');
  process.exit(1);
}

// Create a bot instance
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Function to handle incoming messages and print chat ID
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  logger.info(`Chat ID: ${chatId}`);
  bot.sendMessage(chatId, `Your Chat ID is: ${chatId}`);
});

// Start the bot
bot.on('polling_error', (error) => {
  logger.error(`Polling error: ${error.code} - ${error.response.body}`);
});

logger.info('Bot is running...');
