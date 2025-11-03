import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv()

class Config:
    # credentials
    USERNAME = os.getenv('TWITTER_USERNAME')
    PASSWORD = os.getenv('TWITTER_PASSWORD')
    
    # browser settings
    HEADLESS = os.getenv('HEADLESS', 'False').lower() == 'true'
    TIMEOUT = int(os.getenv('TIMEOUT', '30000'))
    USE_FIREFOX = os.getenv('USE_FIREFOX', 'True').lower() == 'true'
    
    # filtering
    TARGET_DOMAINS = [d.strip() for d in os.getenv('TARGET_DOMAINS', '').split(',') if d]
    INCLUDE_PATTERNS = [p.strip() for p in os.getenv('INCLUDE_PATTERNS', '').split(',') if p]
    
    # paths
    BASE_DIR = Path(__file__).parent.parent
    DATA_DIR = BASE_DIR / 'data'
    LOG_DIR = BASE_DIR / 'logs'
    
    # ensure dirs exist
    DATA_DIR.mkdir(exist_ok=True)
    LOG_DIR.mkdir(exist_ok=True)