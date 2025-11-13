// twitter bookmark scraper - simplified output with post date
(async function() {
    console.log('Starting Twitter Bookmark Scraper (Simplified Output)...');
    
    // --- Configuration ---
    const config = {
        targetDomains: ['transfer.it', 'gofile.io', 'hubcloud.fit', 'drive.google.com', 'mega.nz', 'boxd.it'],
        includePatterns: ['documentary', 'film', 'cinema', '35mm', 'imax', '1080p', 'remux', 'hd', 'uhd', '4k', 'gb'],
        minScrollDelay: 3000,
        maxScrollDelay: 15000,
        delayAfter429: 60000,
        delayIncrement: 1000,
        batchPauseEvery: 5,
        batchPauseTime: 30000,
        maxScrolls: 500,
        simulateReading: true,
        randomizeDelays: true,
        autoSave: true,
        saveEvery: 10,
        continueOnError: true
    };
    
    // --- State Management ---
    const state = {
        currentDelay: config.minScrollDelay,
        scrollCount: 0,
        startTime: null,
        shouldStop: false,
        isPaused: false,
        hasStarted: false,
        seenIds: new Set(),
        quotesDetected: 0,
        quotesFiltered: 0
    };
    
    // --- Regex Patterns ---
    const yearPattern = /\b(19|20)\d{2}\b/;
    const moviePattern = /\bmovies?\b/i;
    const urlPattern = /(https?:\/\/[^\s]+)/g;

    // --- Data Storage ---
    const results = {
        allTweets: [],
        filteredTweets: [],
        stats: { quotesMatched: 0 }
    };

    // --- Core Functions ---

    function extractQuotedTweetData(article) {
        let quotedData = { text: '', author: '', found: false };
        const allDivs = Array.from(article.querySelectorAll('div'));
        for (const div of allDivs) {
            if (div.textContent && div.textContent.trim() === 'Quote') {
                let current = div.parentElement;
                while (current && !current.querySelector('div[role="link"]')) {
                    current = current.parentElement;
                }
                if (current) {
                    const quoteContainer = current.querySelector('div[role="link"]');
                    if (quoteContainer) {
                        quotedData.found = true;
                        const authorSpans = quoteContainer.querySelectorAll('[data-testid="User-Name"] span');
                        if (authorSpans.length > 0) quotedData.author = authorSpans[0].innerText.trim();
                        const textSpans = quoteContainer.querySelectorAll('div[dir="auto"]');
                        for (const span of textSpans) {
                            const text = span.innerText?.trim();
                            if (text && !text.match(/^\d+:\d+/) && !text.match(/^[A-Za-z]{3} \d+/) && !text.includes('@') && text.length > 5) {
                                quotedData.text = text;
                                break;
                            }
                        }
                        return quotedData;
                    }
                }
            }
        }
        return quotedData;
    }
    
    // UPDATED: Filter now scans text for URLs directly
    function matchesFilter(tweet) {
        const combinedText = (tweet.text + ' ' + tweet.quoted_text).toLowerCase();
        
        // Find all URLs in the combined text for filtering
        const urlsInText = combinedText.match(urlPattern) || [];
        
        const hasYear = yearPattern.test(combinedText);
        const hasMovie = moviePattern.test(combinedText);
        const hasPattern = config.includePatterns.some(p => combinedText.includes(p.toLowerCase()));
        const hasUrl = urlsInText.some(l => config.targetDomains.some(d => l.includes(d)));
        
        const matches = hasYear || hasMovie || hasPattern || hasUrl;
        
        if (matches && tweet.has_quote && !mainTweetMatches(tweet)) {
            results.stats.quotesMatched++;
        }
        
        return matches;
    }
    
    // Helper to check if the main tweet part matched (for stats)
    function mainTweetMatches(tweet) {
        const mainText = tweet.text.toLowerCase();
        const mainUrls = mainText.match(urlPattern) || [];
        return yearPattern.test(tweet.text) || moviePattern.test(tweet.text) || config.includePatterns.some(p => mainText.includes(p.toLowerCase())) || mainUrls.some(l => config.targetDomains.some(d => l.includes(d)));
    }

    function extractTweets() {
        const tweets = [];
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        articles.forEach((article) => {
            try {
                const timeLink = article.querySelector('time')?.closest('a');
                const tweetId = timeLink ? timeLink.href.split('/').pop() : null;
                if (!tweetId || state.seenIds.has(tweetId)) return;
                
                const textElement = article.querySelector('[data-testid="tweetText"]');
                const text = textElement ? textElement.innerText : '';
                
                // ADDED: Extract tweet's post date from the <time> element
                const timeElement = article.querySelector('time');
                const posted_at = timeElement ? timeElement.getAttribute('datetime') : null;

                const quotedData = extractQuotedTweetData(article);
                if (quotedData.found) state.quotesDetected++;
                
                tweets.push({
                    id: tweetId,
                    author: article.querySelector('[data-testid="User-Name"]')?.innerText.split('\n')[0] || '',
                    text,
                    posted_at, // New field
                    quoted_author: quotedData.author,
                    quoted_text: quotedData.text,
                    has_quote: quotedData.found,
                    url: timeLink ? timeLink.href : '',
                    scraped_at: new Date().toISOString()
                    // REMOVED: `links` and `quoted_links` properties
                });
            } catch (e) {
                console.error('Extract error:', e);
            }
        });
        return tweets;
    }
    
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // --- UI and Scraper Logic (mostly unchanged) ---
    function createControlPanel() {
        if (document.getElementById('twitter-scraper-control-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'twitter-scraper-control-panel';
        panel.style.cssText = `position:fixed;bottom:20px;right:20px;background:#1a1a1a;border:2px solid #1d9bf0;border-radius:12px;padding:16px;font-family:sans-serif;font-size:13px;color:#fff;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);min-width:280px;`;
        const html = `
            <div style="margin-bottom:12px;font-weight:bold;color:#1d9bf0;">🐦 Twitter Bookmark Scraper</div>
            <div style="margin-bottom:8px;font-size:12px;line-height:1.6;">
                <div>Scrolls: <span id="scraper-scroll-count">0</span></div>
                <div>Matched: <span id="scraper-matched-count">0</span></div>
                <div>Quotes Found: <span id="scraper-quote-count">0</span></div>
                <div>Status: <span id="scraper-status" style="color:#1d9bf0;">Ready</span></div>
            </div>
            <div id="scraper-start-container">
                 <button id="scraper-start-btn" style="width:100%;padding:10px;background:#1d9bf0;border:none;border-radius:20px;color:white;font-weight:bold;cursor:pointer;font-size:14px;">Start Scraping</button>
            </div>
            <div id="scraper-active-controls" style="display:none;grid-template-columns:1fr 1fr;gap:8px;">
                <button id="scraper-pause-btn" style="padding:8px 12px;background:#1d9bf0;border:none;border-radius:20px;color:white;font-weight:bold;cursor:pointer;font-size:12px;">Pause</button>
                <button id="scraper-stop-btn" style="padding:8px 12px;background:#f4245e;border:none;border-radius:20px;color:white;font-weight:bold;cursor:pointer;font-size:12px;">Stop</button>
            </div>
        `;
        panel.innerHTML = html;
        document.body.appendChild(panel);
        document.getElementById('scraper-start-btn').addEventListener('click', () => {
            document.getElementById('scraper-start-container').style.display = 'none';
            document.getElementById('scraper-active-controls').style.display = 'grid';
            runScraper();
        });
        document.getElementById('scraper-stop-btn').addEventListener('click', () => state.shouldStop = true);
        document.getElementById('scraper-pause-btn').addEventListener('click', (e) => {
            state.isPaused = !state.isPaused;
            e.target.textContent = state.isPaused ? 'Resume' : 'Pause';
            document.getElementById('scraper-status').textContent = state.isPaused ? 'Paused' : 'Running';
        });
    }

    function updateControlPanel() {
        if (!state.hasStarted) return;
        const el = id => document.getElementById(id);
        if (el('scraper-scroll-count')) {
            el('scraper-scroll-count').textContent = state.scrollCount;
            el('scraper-matched-count').textContent = results.filteredTweets.length;
            el('scraper-quote-count').textContent = state.quotesDetected;
        }
    }

    async function scrollAndCollect() {
        let noNewTweetsCount = 0;
        while (state.scrollCount < config.maxScrolls && !state.shouldStop) {
            while (state.isPaused && !state.shouldStop) await sleep(1000);
            if (state.shouldStop) break;
            
            try {
                const newTweets = extractTweets();
                if (newTweets.length === 0) {
                    noNewTweetsCount++;
                    if (noNewTweetsCount >= 5) break;
                } else {
                    noNewTweetsCount = 0;
                    for (const tweet of newTweets) {
                        state.seenIds.add(tweet.id);
                        results.allTweets.push(tweet);
                        if (matchesFilter(tweet)) {
                            results.filteredTweets.push(tweet);
                        }
                    }
                }
                
                state.scrollCount++;
                updateControlPanel();
                console.log(`Scroll ${state.scrollCount}: ${results.allTweets.length} total, ${results.filteredTweets.length} matched`);
                
                if (config.autoSave && state.scrollCount % config.saveEvery === 0) {
                    localStorage.setItem('twitterBookmarkScraperProgress', JSON.stringify(results));
                }
                
                window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                await sleep(state.currentDelay);
                state.currentDelay = Math.min(state.currentDelay + config.delayIncrement, config.maxScrollDelay);
                
                if (document.querySelector('[data-testid="emptyState"]')) break;
            } catch (error) {
                console.error('Scroll error:', error);
                await sleep(config.delayAfter429);
            }
        }
    }

    async function runScraper() {
        state.hasStarted = true;
        state.startTime = Date.now();
        document.getElementById('scraper-status').textContent = 'Running';
        await scrollAndCollect();
        console.log('\n=== COMPLETE ===');
        document.getElementById('scraper-status').textContent = 'Finished';
        
        if (results.filteredTweets.length > 0) {
            const blob = new Blob([JSON.stringify({ config, stats: results.stats, tweets: results.filteredTweets }, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `twitter_bookmarks_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
            a.click();
            URL.revokeObjectURL(url);
            localStorage.removeItem('twitterBookmarkScraperProgress');
        }
    }

    function initialize() {
        if (!window.location.href.includes('/bookmarks')) {
            if (confirm('Go to bookmarks page?')) window.location.href = 'https://twitter.com/i/bookmarks';
            return;
        }
        createControlPanel();
        const savedProgress = localStorage.getItem('twitterBookmarkScraperProgress');
        if (savedProgress) {
            const data = JSON.parse(savedProgress);
            if (confirm(`Found a previous session with ${data.filteredTweets.length} tweets. Resume?`)) {
                results.allTweets = data.allTweets || [];
                results.filteredTweets = data.filteredTweets || [];
                results.stats = data.stats || results.stats;
                for (const tweet of results.allTweets) state.seenIds.add(tweet.id);
                document.getElementById('scraper-start-container').style.display = 'none';
                document.getElementById('scraper-active-controls').style.display = 'grid';
                runScraper();
                return;
            } else {
                localStorage.removeItem('twitterBookmarkScraperProgress');
            }
        }
    }

    initialize();
})();