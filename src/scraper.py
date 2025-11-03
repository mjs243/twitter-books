import asyncio
import json
import logging
from datetime import datetime
from typing import List, Dict, Optional
from playwright.async_api import async_playwright, Page
from .filters import TweetFilter
from .config import Config

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(Config.LOG_DIR / f'scraper_{datetime.now():%Y%m%d_%H%M%S}.log'),
        logging.StreamHandler()
    ]
)

class TwitterBookmarkScraper:
    def __init__(self, target_domains: List[str] = None, include_patterns: List[str] = None):
        self.filter = TweetFilter(
            target_domains or Config.TARGET_DOMAINS,
            include_patterns or Config.INCLUDE_PATTERNS
        )
        self.bookmarks = []
        self.seen_ids = set()
        self.total_processed = 0
    
    async def type_like_human(self, page: Page, selector: str, text: str):
        """type text with human-like delays"""
        element = await page.wait_for_selector(selector)
        await element.click()
        await page.wait_for_timeout(500)
        
        for char in text:
            await page.keyboard.type(char)
            await page.wait_for_timeout(100 + (50 if char == '@' or char == '.' else 0))
    
    async def login_with_cookies(self, page: Page):
        """try to use existing cookies if available"""
        try:
            # load cookies if they exist
            import pickle
            from pathlib import Path
            cookie_file = Path('cookies.pkl')
            
            if cookie_file.exists():
                logging.info("found saved cookies, attempting to restore session...")
                with open(cookie_file, 'rb') as f:
                    cookies = pickle.load(f)
                    await page.context.add_cookies(cookies)
                
                await page.goto('https://twitter.com/home')
                await page.wait_for_timeout(3000)
                
                # check if logged in
                try:
                    await page.wait_for_selector('[data-testid="AppTabBar_Home_Link"]', timeout=5000)
                    logging.info("restored session successfully!")
                    return True
                except:
                    logging.info("saved cookies expired, need fresh login")
                    cookie_file.unlink()
        except Exception as e:
            logging.debug(f"cookie restoration failed: {e}")
        
        return False
    
    async def save_cookies(self, page: Page):
        """save cookies for future use"""
        try:
            import pickle
            cookies = await page.context.cookies()
            with open('cookies.pkl', 'wb') as f:
                pickle.dump(cookies, f)
            logging.info("saved cookies for future use")
        except Exception as e:
            logging.debug(f"failed to save cookies: {e}")
    
    async def manual_login(self, page: Page):
        """allow manual login with cookie saving"""
        logging.info("opening twitter for manual login...")
        
        # check for existing cookies first
        if await self.login_with_cookies(page):
            return True
        
        await page.goto('https://twitter.com/login')
        
        logging.info("please log in manually in the browser window")
        logging.info("waiting for login to complete...")
        
        # wait for login with periodic checks
        for i in range(120):  # wait up to 10 minutes
            try:
                await page.wait_for_selector('[data-testid="AppTabBar_Home_Link"], [aria-label="Home"]', timeout=5000)
                logging.info("manual login successful!")
                await self.save_cookies(page)
                return True
            except:
                if i % 6 == 0:  # log every 30 seconds
                    logging.info(f"waiting for login... ({i*5}/600 seconds)")
                await page.wait_for_timeout(5000)
        
        raise Exception("login timeout - please try again")
    
    async def extract_tweet_data(self, page: Page) -> List[Dict]:
        """extract tweet data from current page"""
        return await page.evaluate('''() => {
            const tweets = [];
            const articles = document.querySelectorAll('article[data-testid="tweet"]');
            
            articles.forEach(article => {
                try {
                    // get tweet id
                    const timeLink = article.querySelector('time')?.closest('a');
                    const tweetId = timeLink ? timeLink.href.split('/').pop() : null;
                    
                    // get main text
                    const textElement = article.querySelector('[data-testid="tweetText"]');
                    const text = textElement ? textElement.innerText : '';
                    
                    // get all links (excluding twitter.com)
                    const links = Array.from(article.querySelectorAll('a'))
                        .map(a => a.href)
                        .filter(href => !href.includes('twitter.com') && !href.includes('x.com'));
                    
                    // check for quoted tweet
                    const quotedArticle = article.querySelector('div[role="link"] article');
                    let quotedText = '';
                    let quotedLinks = [];
                    
                    if (quotedArticle) {
                        const quotedTextEl = quotedArticle.querySelector('[data-testid="tweetText"]');
                        quotedText = quotedTextEl ? quotedTextEl.innerText : '';
                        quotedLinks = Array.from(quotedArticle.querySelectorAll('a'))
                            .map(a => a.href)
                            .filter(href => !href.includes('twitter.com') && !href.includes('x.com'));
                    }
                    
                    // get author
                    const authorElement = article.querySelector('[data-testid="User-Name"]');
                    const author = authorElement ? authorElement.innerText.split('\\n')[0] : '';
                    
                    tweets.push({
                        id: tweetId,
                        author: author,
                        text: text,
                        links: links,
                        quoted_text: quotedText,
                        quoted_links: quotedLinks,
                        has_quote: quotedArticle !== null
                    });
                } catch (e) {
                    console.error('Error extracting tweet:', e);
                }
            });
            
            return tweets;
        }''')
    
    async def scrape_bookmarks(self, username: str = None, password: str = None):
        """main scraping function with stealth options"""
        username = username or Config.USERNAME
        password = password or Config.PASSWORD
        
        # always use manual mode for now due to detection
        manual_mode = True
        
        async with async_playwright() as p:
            # use firefox as it's less detected than chromium
            browser_type = p.firefox if Config.USE_FIREFOX else p.chromium
            
            browser = await browser_type.launch(
                headless=False,  # never run headless
                args=[
                    '--disable-blink-features=AutomationControlled',
                    '--disable-dev-shm-usage',
                    '--no-sandbox',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--disable-setuid-sandbox'
                ] if not Config.USE_FIREFOX else []
            )
            
            # create context with stealth settings
            context = await browser.new_context(
                viewport={'width': 1280, 'height': 720},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                locale='en-US',
                timezone_id='America/New_York',
                permissions=['geolocation'],
                ignore_https_errors=True,
                java_script_enabled=True
            )
            
            # add stealth scripts
            await context.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
                
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5]
                });
                
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['en-US', 'en']
                });
                
                window.chrome = {
                    runtime: {}
                };
                
                Object.defineProperty(navigator, 'permissions', {
                    get: () => ({
                        query: () => Promise.resolve({ state: 'granted' })
                    })
                });
            """)
            
            page = await context.new_page()
            
            try:
                # always use manual login for now
                await self.manual_login(page)
                
                # navigate to bookmarks
                logging.info("navigating to bookmarks...")
                await page.wait_for_timeout(2000)
                await page.goto('https://twitter.com/i/bookmarks')
                
                # wait for bookmarks to load
                try:
                    await page.wait_for_selector('article[data-testid="tweet"]', timeout=10000)
                except:
                    logging.warning("no bookmarks found or page didn't load properly")
                    # check if bookmarks are empty
                    empty_state = await page.query_selector('[data-testid="emptyState"]')
                    if empty_state:
                        logging.info("no bookmarks found")
                        return []
                
                # scroll and collect
                no_new_tweets_count = 0
                scroll_count = 0
                
                while True:
                    # extract tweets
                    tweets = await self.extract_tweet_data(page)
                    new_tweets = 0
                    
                    for tweet in tweets:
                        if tweet['id'] and tweet['id'] not in self.seen_ids:
                            self.seen_ids.add(tweet['id'])
                            self.total_processed += 1
                            
                            # apply filter (now includes year/movie check)
                            if self.filter.matches_target(tweet):
                                self.bookmarks.append(tweet)
                                new_tweets += 1
                                
                                # log what matched
                                all_text = tweet.get('text', '') + ' ' + tweet.get('quoted_text', '')
                                match_reasons = []
                                
                                if self.filter.year_pattern.search(all_text):
                                    match_reasons.append('year')
                                if self.filter.movie_pattern.search(all_text):
                                    match_reasons.append('movie')
                                
                                # check for domain matches
                                for url in tweet.get('links', []):
                                    domain = self.filter.get_domain(url)
                                    for target in self.filter.target_domains:
                                        if target.lower() in domain:
                                            match_reasons.append(f'domain:{target}')
                                            break
                                
                                logging.info(f"matched tweet {tweet['id']} - reasons: {', '.join(match_reasons)}")
                    
                    if new_tweets == 0:
                        no_new_tweets_count += 1
                        if no_new_tweets_count >= 3:
                            logging.info("no new tweets found, stopping")
                            break
                    else:
                        no_new_tweets_count = 0
                    
                    # scroll
                    scroll_count += 1
                    logging.info(f"scroll {scroll_count}: {len(self.bookmarks)} matched, {self.total_processed} processed")
                    
                    # human-like scroll
                    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                    await page.wait_for_timeout(2000 + (scroll_count * 100))  # gradually slower scrolling
                    
                    # check for end of bookmarks
                    end_element = await page.query_selector('[data-testid="emptyState"]')
                    if end_element:
                        logging.info("reached end of bookmarks")
                        break
                
                logging.info("scraping complete - browser will close in 5 seconds")
                await page.wait_for_timeout(5000)
                
            except Exception as e:
                logging.error(f"scraping error: {e}")
                raise
            finally:
                await browser.close()
        
        logging.info(f"Final: {len(self.bookmarks)}/{self.total_processed} tweets matched filters")
        return self.bookmarks