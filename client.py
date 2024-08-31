import logging
import os
import pyautogui
import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold
from telegram import Update
from telegram.ext import Application, MessageHandler, filters, ContextTypes
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()
BOT_TOKEN = os.getenv('BOT_TOKEN')
CHAT_ID = os.getenv('CHAT_ID')  # Replace with the chat ID you obtained
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')

# Configure Google Gemini AI
genai.configure(api_key=GEMINI_API_KEY)

# Enable logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', level=logging.INFO
)
logger = logging.getLogger(__name__)

# Initialize the bot
bot = None


# Upload image to Gemini and extract text
def upload_to_gemini(path, mime_type=None):
    """Uploads the given file to Gemini."""
    file = genai.upload_file(path, mime_type=mime_type)
    logger.info(f"Uploaded file '{file.display_name}' as: {file.uri}")
    return file


# Configure the generative model
generation_config = {
    "temperature": 1,
    "top_p": 0.95,
    "top_k": 64,
    "max_output_tokens": 4096,
    "response_mime_type": "text/plain",
}

model = genai.GenerativeModel(
    model_name="gemini-1.5-flash",
    generation_config=generation_config,
    safety_settings={
        HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
        HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
        HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE
    }
    # See https://ai.google.dev/gemini-api/docs/safety-settings
)


async def extract_text_from_image(image_path):
    try:
        file = upload_to_gemini(image_path, mime_type="image/jpeg")
        chat_session = model.start_chat(
            history=[
                {
                    "role": "user",
                    "parts": [
                        file,
                    ],
                },
            ]
        )
        response = chat_session.send_message(
            "You have to act like an OCR bot and extract text from the image. Do so nicely and with high accuracy, and you'll have to recognize code perfectly. You will see a question and 4 options, detect them and print them out perfectly. ignore the watermarks as much as possible, i only want to see the question and the options at once.")
        return response.text
    except Exception as e:
        logger.error(f"Failed to extract text from image: {e}")
        return None


async def take_screenshot(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    try:
        # Take a screenshot at the native resolution
        screenshot = pyautogui.screenshot()
        screenshot_path = "screenshot.png"
        screenshot.save(screenshot_path, "PNG")  # Save as PNG to maintain high quality

        # Send the screenshot as a file
        await bot.send_document(chat_id=CHAT_ID, document=open(screenshot_path, 'rb'))

        # Extract text from the image
        extracted_text = await extract_text_from_image(screenshot_path)
        if extracted_text:
            await bot.send_message(chat_id=CHAT_ID, text=extracted_text)
        else:
            await bot.send_message(chat_id=CHAT_ID, text="Failed to extract text from the image.")
    except Exception as e:
        logger.error(f"Failed to take screenshot: {e}")
        await update.message.reply_text("Failed to take screenshot.")


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if 'ss' or "Ss" in update.message.text.lower():
        await take_screenshot(update, context)


def main() -> None:
    """Start the bot."""
    global bot
    # Initialize the bot application with the token from the .env file
    application = Application.builder().token(BOT_TOKEN).build()
    bot = application.bot

    # Add handler
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    # Start the Bot
    application.run_polling()


if __name__ == '__main__':
    main()





