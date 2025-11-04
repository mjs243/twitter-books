// improved twitter bookmark scraper with better quote detection
(async function() {
    console.log('Starting Twitter Bookmark Scraper (Enhanced Quote Detection)...');
    
    // configuration (same as before)
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
        continueOnError: true,
        detectUserScrolling: true,
        skipDuplicateDelay: 500
    };
    
    // state
    const state = {
        currentDelay: config.minScrollDelay,
        scrollCount: 0,
        errorCount: 0,
        rateLimitCount: 0,
        lastSaveScroll: 0,
        startTime: Date.now(),
        shouldStop: false,
        isPaused: false,
        seenIds: new Set(),
        lastScrollPosition: 0,
        isScrollingUp: false,
        duplicatesSkipped: 0,
        newTweetsAfterResume: 0,
        sessionStartTime: null,
        quotesDetected: 0  // track quote detection
    };
    
    const yearPattern = /\b(19|20)\d{2}\b/;
    const moviePattern = /\bmovies?\b/i;
    
    const results = {
        allTweets: [],
        filteredTweets: [],
        stats: {
            total: 0,
            withYears: 0,
            withMovies: 0,
            withDomains: 0,
            errors: [],
            duplicatesSkipped: 0,
            newOnResume: 0,
            quotesFound: 0
        }
    };
    
    // load session data
    function loadSessionData() {
        try {
            const saved = localStorage.getItem('twitterScraperSession');
            if (saved) {
                const session = JSON.parse(saved);
                state.seenIds = new Set(session.seenIds || []);
                state.sessionStartTime = session.sessionStartTime;
                console.log(`Loaded ${state.seenIds.size} previously seen tweet IDs`);
                return true;
            }
            state.sessionStartTime = Date.now();
            return false;
        } catch (e) {
            console.error('Error loading session:', e);
            state.sessionStartTime = Date.now();
            return false;
        }
    }
    
    // save session data
    function saveSessionData() {
        try {
            const session = {
                seenIds: Array.from(state.seenIds),
                sessionStartTime: state.sessionStartTime,
                savedAt: new Date().toISOString()
            };
            localStorage.setItem('twitterScraperSession', JSON.stringify(session));
        } catch (e) {
            console.error('Error saving session:', e);
        }
    }
    
    // detect quoted tweet with multiple strategies
    function extractQuotedTweetData(article) {
        let quotedData = {
            text: '',
            links: [],
            author: ''
        };
        
        // Strategy 1: Look for nested article in role="link"
        let quotedArticle = article.querySelector('div[role="link"] article');
        
        // Strategy 2: If not found, look for article within blockquote
        if (!quotedArticle) {
            quotedArticle = article.querySelector('blockquote article');
        }
        
        // Strategy 3: Look for any article that's not the main one
        if (!quotedArticle) {
            const allArticles = article.querySelectorAll('article');
            if (allArticles.length > 1) {
                quotedArticle = allArticles[1];
            }
        }
        
        // Strategy 4: Look for quote container div
        if (!quotedArticle) {
            const quoteContainer = article.querySelector('[data-testid="card.wrapper"]');
            if (quoteContainer) {
                // extract text from quote container
                const textEl = quoteContainer.querySelector('[data-testid="tweetText"]');
                if (textEl) {
                    quotedData.text = textEl.innerText;
                }
                
                // extract links from quote container
                quotedData.links = Array.from(quoteContainer.querySelectorAll('a'))
                    .map(a => a.href)
                    .filter(href => !href.includes('twitter.com') && !href.includes('x.com'));
                
                // extract author
                const authorEl = quoteContainer.querySelector('[data-testid="User-Name"]');
                if (authorEl) {
                    quotedData.author = authorEl.innerText.split('\n')[0];
                }
                
                return quotedData;
            }
        }
        
        // If we found an article, extract from it
        if (quotedArticle) {
            // get text
            const textElement = quotedArticle.querySelector('[data-testid="tweetText"]');
            if (textElement) {
                quotedData.text = textElement.innerText;
            }
            
            // get links
            quotedData.links = Array.from(quotedArticle.querySelectorAll('a'))
                .map(a => a.href)
                .filter(href => !href.includes('twitter.com') && !href.includes('x.com'));
            
            // get author
            const authorElement = quotedArticle.querySelector('[data-testid="User-Name"]');
            if (authorElement) {
                quotedData.author = authorElement.innerText.split('\n')[0];
            }
            
            return quotedData;
        }
        
        // Strategy 5: Try to find quote via external link that looks like a tweet
        const tweetLinks = Array.from(article.querySelectorAll('a'))
            .filter(a => a.href.includes('/status/') || a.href.includes('x.com/'));
        
        // Check if any of these are quote links (not the main tweet URL)
        const mainTweetLink = article.querySelector('time')?.closest('a')?.href;
        
        for (const link of tweetLinks) {
            if (link.href !== mainTweetLink && link.href.includes('/status/')) {
                // This might be a quoted tweet link
                // We can't extract the content without fetching, but we can note it
                quotedData.links.push(link.href);
            }
        }
        
        return quotedData;
    }
    
    // create control panel
    function createControlPanel() {
        const panel = document.createElement('div');
        panel.id = 'twitter-scraper-control-panel';
        panel.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #1a1a1a;
            border: 2px solid #1d9bf0;
            border-radius: 12px;
            padding: 16px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            color: #fff;
            z-index: 99999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            min-width: 280px;
            max-height: 400px;
            overflow-y: auto;
        `;
        
        const html = `
            <div style="margin-bottom: 12px; font-weight: bold; color: #1d9bf0;">
                🐦 Twitter Bookmark Scraper
            </div>
            
            <div style="margin-bottom: 8px; font-size: 12px; line-height: 1.6;">
                <div>📊 Scrolls: <span id="scraper-scroll-count">0</span></div>
                <div>✓ Matched: <span id="scraper-matched-count">0</span></div>
                <div>📝 Total seen: <span id="scraper-total-count">0</span></div>
                <div>💬 Quotes found: <span id="scraper-quote-count">0</span></div>
                <div>⏭️  Duplicates: <span id="scraper-dup-count">0</span></div>
                <div>⏰ Time: <span id="scraper-time">0m 0s</span></div>
                <div>Status: <span id="scraper-status" style="color: #1d9bf0;">Running</span></div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
                <button id="scraper-pause-btn" style="
                    padding: 8px 12px;
                    background: #1d9bf0;
                    border: none;
                    border-radius: 20px;
                    color: white;
                    font-weight: bold;
                    cursor: pointer;
                    font-size: 12px;
                    transition: background 0.2s;
                " onmouseover="this.style.background='#1a8cd8'" onmouseout="this.style.background='#1d9bf0'">
                    Pause
                </button>
                
                <button id="scraper-stop-btn" style="
                    padding: 8px 12px;
                    background: #f4245e;
                    border: none;
                    border-radius: 20px;
                    color: white;
                    font-weight: bold;
                    cursor: pointer;
                    font-size: 12px;
                    transition: background 0.2s;
                " onmouseover="this.style.background='#e01c52'" onmouseout="this.style.background='#f4245e'">
                    Stop
                </button>
            </div>
            
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #333; font-size: 11px; color: #999;">
                <div>ESC - Stop | Ctrl+Space - Pause</div>
                <div style="margin-top: 4px;">Commands:</div>
                <div style="margin-left: 4px;">stopScraper()</div>
                <div style="margin-left: 4px;">pauseScraper()</div>
                <div style="margin-left: 4px;">getScrapeStatus()</div>
            </div>
        `;
        
        panel.innerHTML = html;
        document.body.appendChild(panel);
        
        document.getElementById('scraper-stop-btn').addEventListener('click', () => {
            console.log('Stop button clicked');
            state.shouldStop = true;
            document.getElementById('scraper-status').textContent = 'Stopping...';
        });
        
        document.getElementById('scraper-pause-btn').addEventListener('click', (e) => {
            state.isPaused = !state.isPaused;
            e.target.textContent = state.isPaused ? 'Resume' : 'Pause';
            e.target.style.background = state.isPaused ? '#f4245e' : '#1d9bf0';
            const status = state.isPaused ? 'Paused' : 'Running';
            document.getElementById('scraper-status').textContent = status;
            console.log(state.isPaused ? '⏸️  Paused' : '▶️  Resumed');
        });
    }
    
    function updateControlPanel() {
        const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        
        const scrollEl = document.getElementById('scraper-scroll-count');
        const matchedEl = document.getElementById('scraper-matched-count');
        const totalEl = document.getElementById('scraper-total-count');
        const dupEl = document.getElementById('scraper-dup-count');
        const quoteEl = document.getElementById('scraper-quote-count');
        const timeEl = document.getElementById('scraper-time');
        
        if (scrollEl) scrollEl.textContent = state.scrollCount;
        if (matchedEl) matchedEl.textContent = results.filteredTweets.length;
        if (totalEl) totalEl.textContent = results.allTweets.length;
        if (dupEl) dupEl.textContent = state.duplicatesSkipped;
        if (quoteEl) quoteEl.textContent = state.quotesDetected;
        if (timeEl) timeEl.textContent = `${minutes}m ${seconds}s`;
    }
    
    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                console.log('ESC pressed');
                state.shouldStop = true;
            }
            
            if (e.key === ' ' && e.ctrlKey) {
                e.preventDefault();
                state.isPaused = !state.isPaused;
                const pauseBtn = document.getElementById('scraper-pause-btn');
                if (pauseBtn) {
                    pauseBtn.textContent = state.isPaused ? 'Resume' : 'Pause';
                    pauseBtn.style.background = state.isPaused ? '#f4245e' : '#1d9bf0';
                }
                console.log(state.isPaused ? '⏸️  Paused' : '▶️  Resumed');
            }
        });
    }
    
    window.stopScraper = function() {
        console.log('Stopping scraper');
        state.shouldStop = true;
    };
    
    window.pauseScraper = function() {
        state.isPaused = !state.isPaused;
        console.log(state.isPaused ? '⏸️  Paused' : '▶️  Resumed');
    };
    
    window.getScrapeStatus = function() {
        const status = {
            running: !state.shouldStop,
            paused: state.isPaused,
            scrolls: state.scrollCount,
            matched: results.filteredTweets.length,
            totalSeen: results.allTweets.length,
            duplicatesSkipped: state.duplicatesSkipped,
            quotesDetected: state.quotesDetected,
            seenIds: state.seenIds.size,
            timeElapsed: Math.floor((Date.now() - state.startTime) / 1000)
        };
        console.table(status);
        return status;
    };
    
    function loadProgress() {
        const saved = localStorage.getItem('twitterBookmarkScraperProgress');
        if (saved) {
            const data = JSON.parse(saved);
            const resume = confirm(`Found previous session with ${data.filteredTweets.length} tweets. Resume?`);
            if (resume) {
                results.allTweets = data.allTweets || [];
                results.filteredTweets = data.filteredTweets || [];
                results.stats = data.stats || results.stats;
                
                for (const tweet of results.allTweets) {
                    state.seenIds.add(tweet.id);
                }
                
                console.log(`Resumed with ${results.filteredTweets.length} filtered tweets`);
            } else {
                localStorage.removeItem('twitterBookmarkScraperProgress');
                state.seenIds.clear();
            }
        }
    }
    
    function saveProgress() {
        if (config.autoSave) {
            localStorage.setItem('twitterBookmarkScraperProgress', JSON.stringify(results));
            saveSessionData();
            console.log(`Saved: ${results.filteredTweets.length} filtered tweets`);
        }
    }
    
    function getRandomDelay(base) {
        if (!config.randomizeDelays) return base;
        const variation = base * 0.3;
        return base + (Math.random() * variation * 2 - variation);
    }
    
    async function simulateReading() {
        if (!config.simulateReading) return;
        
        if (Math.random() < 0.1) {
            const scrollUp = Math.random() * 300 + 100;
            window.scrollBy(0, -scrollUp);
            await sleep(getRandomDelay(1000));
            window.scrollBy(0, scrollUp);
        }
        
        if (Math.random() < 0.2) {
            window.scrollBy(0, Math.random() * 50 - 25);
        }
    }
    
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    async function simulateReadingDuplicate() {
        if (Math.random() < 0.3) {
            await sleep(config.skipDuplicateDelay + Math.random() * 500);
        }
    }
    
    function checkForRateLimit() {
        const errorMessages = document.querySelectorAll('[role="alert"]');
        for (const msg of errorMessages) {
            if (msg.innerText.toLowerCase().includes('rate') || 
                msg.innerText.toLowerCase().includes('try again')) {
                return true;
            }
        }
        
        const spinner = document.querySelector('[role="progressbar"]');
        if (spinner && state.scrollCount > 5) {
            return true;
        }
        
        return false;
    }
    
    function extractTweets() {
        const tweets = [];
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        
        articles.forEach(article => {
            try {
                const timeLink = article.querySelector('time')?.closest('a');
                const tweetId = timeLink ? timeLink.href.split('/').pop() : null;
                
                if (!tweetId) return;
                
                const isDuplicate = state.seenIds.has(tweetId);
                
                const textElement = article.querySelector('[data-testid="tweetText"]');
                const text = textElement ? textElement.innerText : '';
                
                const links = Array.from(article.querySelectorAll('a'))
                    .map(a => a.href)
                    .filter(href => !href.includes('twitter.com') && !href.includes('x.com'));
                
                // IMPROVED: Use multi-strategy quote detection
                const quotedData = extractQuotedTweetData(article);
                const hasQuote = quotedData.text.length > 0;
                
                if (hasQuote) {
                    state.quotesDetected++;
                    results.stats.quotesFound++;
                }
                
                const tweetUrl = timeLink ? timeLink.href : '';
                
                const tweetData = {
                    id: tweetId,
                    author: article.querySelector('[data-testid="User-Name"]')?.innerText.split('\n')[0] || '',
                    text: text,
                    links: links,
                    quoted_author: quotedData.author,
                    quoted_text: quotedData.text,
                    quoted_links: quotedData.links,
                    has_quote: hasQuote,
                    url: tweetUrl,
                    isDuplicate: isDuplicate,
                    scraped_at: new Date().toISOString()
                };
                
                tweets.push(tweetData);
            } catch (e) {
                console.error('Error extracting:', e);
                state.errorCount++;
            }
        });
        
        return tweets;
    }
    
    function matchesFilter(tweet) {
        const allText = (tweet.text + ' ' + tweet.quoted_text).toLowerCase();
        const allLinks = [...tweet.links, ...tweet.quoted_links];
        
        if (yearPattern.test(allText)) {
            results.stats.withYears++;
            return true;
        }
        
        if (moviePattern.test(allText)) {
            results.stats.withMovies++;
            return true;
        }
        
        for (const pattern of config.includePatterns) {
            if (allText.includes(pattern.toLowerCase())) {
                return true;
            }
        }
        
        for (const link of allLinks) {
            for (const domain of config.targetDomains) {
                if (link.includes(domain)) {
                    results.stats.withDomains++;
                    return true;
                }
            }
        }
        
        return false;
    }
    
    async function scrollAndCollect() {
        let noNewTweetsCount = 0;
        
        while (state.scrollCount < config.maxScrolls && !state.shouldStop) {
            while (state.isPaused && !state.shouldStop) {
                await sleep(1000);
            }
            
            if (state.shouldStop) break;
            
            try {
                if (checkForRateLimit()) {
                    state.rateLimitCount++;
                    console.warn(`⚠️  Rate limit #${state.rateLimitCount}`);
                    results.stats.errors.push({
                        type: 'rate_limit',
                        scroll: state.scrollCount,
                        time: new Date().toISOString()
                    });
                    
                    state.currentDelay = Math.min(state.currentDelay * 1.5, config.maxScrollDelay);
                    await sleep(config.delayAfter429);
                }
                
                const newTweets = extractTweets();
                const beforeCount = results.allTweets.length;
                let newUniqueTweets = 0;
                
                for (const tweet of newTweets) {
                    if (!state.seenIds.has(tweet.id)) {
                        state.seenIds.add(tweet.id);
                        results.allTweets.push(tweet);
                        
                        if (matchesFilter(tweet)) {
                            results.filteredTweets.push(tweet);
                            newUniqueTweets++;
                            
                            let logMsg = `✓ ${tweet.id}`;
                            if (tweet.has_quote) logMsg += ' [HAS QUOTE]';
                            console.log(logMsg);
                        }
                    } else {
                        state.duplicatesSkipped++;
                        results.stats.duplicatesSkipped++;
                        
                        if (state.isScrollingUp) {
                            await simulateReadingDuplicate();
                        }
                    }
                }
                
                if (newUniqueTweets > 0 && state.scrollCount < 3) {
                    state.newTweetsAfterResume += newUniqueTweets;
                    results.stats.newOnResume = state.newTweetsAfterResume;
                }
                
                if (results.allTweets.length === beforeCount) {
                    noNewTweetsCount++;
                    if (noNewTweetsCount >= 5) {
                        console.log('No new tweets, stopping');
                        break;
                    }
                } else {
                    noNewTweetsCount = 0;
                }
                
                await simulateReading();
                
                const scrollDistance = document.body.scrollHeight - window.innerHeight - window.scrollY;
                if (scrollDistance > 0) {
                    window.scrollTo({
                        top: document.body.scrollHeight,
                        behavior: 'smooth'
                    });
                }
                
                state.scrollCount++;
                updateControlPanel();
                
                const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
                console.log(`Scroll ${state.scrollCount}: ${results.allTweets.length} unique, ${results.filteredTweets.length} matched, ${state.quotesDetected} quotes | ${Math.floor(elapsed/60)}m`);
                
                if (config.autoSave && state.scrollCount - state.lastSaveScroll >= config.saveEvery) {
                    saveProgress();
                    state.lastSaveScroll = state.scrollCount;
                }
                
                if (state.scrollCount % config.batchPauseEvery === 0) {
                    console.log(`Break for ${config.batchPauseTime/1000}s...`);
                    await sleep(config.batchPauseTime);
                }
                
                const delay = getRandomDelay(state.currentDelay);
                await sleep(delay);
                
                state.currentDelay = Math.min(
                    state.currentDelay + config.delayIncrement,
                    config.maxScrollDelay
                );
                
                if (document.querySelector('[data-testid="emptyState"]')) {
                    console.log('Reached end');
                    break;
                }
                
            } catch (error) {
                state.errorCount++;
                console.error('Error:', error);
                results.stats.errors.push({
                    type: 'scroll_error',
                    error: error.message,
                    scroll: state.scrollCount,
                    time: new Date().toISOString()
                });
                
                if (!config.continueOnError) throw error;
                await sleep(config.delayAfter429);
            }
        }
    }
    
    function downloadResults() {
        const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
        
        const data = {
            config: config,
            stats: {
                ...results.stats,
                unique_tweets: results.allTweets.length,
                matched_filters: results.filteredTweets.length,
                quotes_detected: state.quotesDetected,
                scrolls: state.scrollCount,
                duplicates_skipped: state.duplicatesSkipped,
                errors: state.errorCount,
                rate_limits: state.rateLimitCount,
                time_elapsed: elapsed
            },
            tweets: results.filteredTweets,
            scraped_at: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `twitter_bookmarks_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    try {
        if (!window.location.href.includes('/bookmarks')) {
            const confirmNav = confirm('Go to bookmarks page?');
            if (confirmNav) {
                window.location.href = 'https://twitter.com/i/bookmarks';
                return;
            }
        }
        
        loadProgress();
        loadSessionData();
        createControlPanel();
        setupKeyboardShortcuts();
        
        console.log('Scraper ready');
        await scrollAndCollect();
        saveProgress();
        
        const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
        console.log('\n=== COMPLETE ===');
        console.log(`Time: ${Math.floor(elapsed/60)}m ${elapsed%60}s`);
        console.log(`Unique bookmarks: ${results.allTweets.length}`);
        console.log(`Matched: ${results.filteredTweets.length}`);
        console.log(`Quotes detected: ${state.quotesDetected}`);
        console.log(`Skipped: ${state.duplicatesSkipped}`);
        
        if (results.filteredTweets.length > 0) {
            downloadResults();
            console.log('Results downloaded!');
            localStorage.removeItem('twitterBookmarkScraperProgress');
        }
        
    } catch (error) {
        console.error('Fatal error:', error);
        saveProgress();
        console.log('Progress saved');
    }
})();