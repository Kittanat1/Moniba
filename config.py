import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "dev-secret-key")
    DEBUG = os.getenv("FLASK_DEBUG", "True") == "True"
    DEV_MODE = os.getenv("DEV_MODE", "True") == "True"

    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", "sqlite:///moniba.db")
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN")
    LINE_LOGIN_CHANNEL_ID = os.getenv("LINE_LOGIN_CHANNEL_ID")
    LIFF_ID = os.getenv("LIFF_ID","")
    GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
    GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
    LINE_ID_TOKEN_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify"
    LINE_PUSH_API_URL = os.getenv("LINE_PUSH_API_URL", "https://api.line.me/v2/bot/message/push")
