// twitter bookmark scraper - IMPROVED RESUME & LINK TRACKING
(async function() {
    console.log('Starting Twitter Bookmark Scraper...');
    
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
        seenLinks: new Set(), // Track all links we've seen
        sessionStartTime: null,
        quotesDetected: 0,
        quotesFiltered: 0
    };
    
    const yearPattern = /\b(19|20)\d{2}\b/;
    const moviePattern = /\bmovies?\b/i;
    
    const results = {
        allTweets: [],
        filteredTweets: [],
        allLinks: [], // Store all extracted links
        stats: {
            total: 0,
            withYears: 0,
            withMovies: 0,
            withDomains: 0,
            errors: [],
            quotesFound: 0,
            quotesMatched: 0,
            quotesFiltered: 0,
            uniqueLinks: 0
        }
    };
    
    // Extract links from text content
    function extractLinksFromText(text) {
        const links = [];
        if (!text) return links;
        
        for (const domain of config.targetDomains) {
            const regex = new RegExp(`https?://[^\\s]*${domain}[^\\s]*`, 'gi');
            const matches = text.match(regex);
            if (matches) {
                links.push(...matches);
            }
            
            const brokenRegex = new RegExp(`https?://\\s*${domain}[^\\s]*`, 'gi');
            const brokenMatches = text.match(brokenRegex);
            if (brokenMatches) {
                const fixed = brokenMatches.map(url => url.replace(/https?:\/\/\s+/g, 'https://'));
                links.push(...fixed);
            }
        }
        
        for (const domain of config.targetDomains) {
            if (text.includes(domain) && !links.some(l => l.includes(domain))) {
                const regex = new RegExp(`${domain}/[^\\s]+`, 'gi');
                const matches = text.match(regex);
                if (matches) {
                    const fullUrls = matches.map(m => 'https://' + m);
                    links.push(...fullUrls);
                }
            }
        }
        
        return [...new Set(links)];
    }
    
    function extractQuotedTweetData(article) {
        let quotedData = {
            text: '',
            links: [],
            author: '',
            found: false
        };
        
        try {
            const quoteIndicator = Array.from(article.querySelectorAll('div'))
                .find(div => div.textContent?.trim() === 'Quote');
            
            if (quoteIndicator) {
                const quotedContainer = article.querySelector('div[tabindex="0"][role="link"]');
                
                if (quotedContainer) {
                    quotedData.found = true;
                    
                    const authorEl = quotedContainer.querySelector('[data-testid="User-Name"]');
                    if (authorEl) {
                        quotedData.author = authorEl.innerText?.split('\n')[0] || '';
                    }
                    
                    const textDivs = quotedContainer.querySelectorAll('div[dir="auto"]');
                    for (const div of textDivs) {
                        const text = div.innerText?.trim();
                        if (text && 
                            text.length > 10 && 
                            !text.startsWith('@') && 
                            !text.match(/^[A-Z][a-z]+ \d+$/) &&
                            !text.includes('.com/') &&
                            !text.match(/^\d+$/)) {
                            quotedData.text = text;
                            break;
                        }
                    }
                    
                    if (quotedData.text) {
                        quotedData.links = extractLinksFromText(quotedData.text);
                    }
                    
                    const quotedAnchors = quotedContainer.querySelectorAll('a');
                    for (const anchor of quotedAnchors) {
                        const href = anchor.href;
                        if (href && config.targetDomains.some(d => href.includes(d))) {
                            if (!quotedData.links.includes(href)) {
                                quotedData.links.push(href);
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Error extracting quoted tweet:', e);
        }
        
        return quotedData;
    }
    
    function matchesFilter(tweet) {
        const mainText = tweet.text.toLowerCase();
        const mainHasYear = yearPattern.test(tweet.text);
        const mainHasMovie = moviePattern.test(tweet.text);
        const mainHasPattern = config.includePatterns.some(p => mainText.includes(p.toLowerCase()));
        const mainHasUrl = tweet.links.some(l => config.targetDomains.some(d => l.includes(d)));
        
        const mainMatches = mainHasYear || mainHasMovie || mainHasPattern || mainHasUrl;
        
        if (mainMatches) {
            if (mainHasYear) results.stats.withYears++;
            if (mainHasMovie) results.stats.withMovies++;
            if (mainHasUrl) results.stats.withDomains++;
            return true;
        }
        
        if (tweet.has_quote && tweet.quoted_text) {
            const quotedText = tweet.quoted_text.toLowerCase();
            const quotedHasYear = yearPattern.test(tweet.quoted_text);
            const quotedHasMovie = moviePattern.test(tweet.quoted_text);
            const quotedHasPattern = config.includePatterns.some(p => quotedText.includes(p.toLowerCase()));
            const quotedHasUrl = tweet.quoted_links.some(l => config.targetDomains.some(d => l.includes(d)));
            
            const quotedMatches = quotedHasYear || quotedHasMovie || quotedHasPattern || quotedHasUrl;
            
            if (quotedMatches) {
                if (quotedHasYear) results.stats.withYears++;
                if (quotedHasMovie) results.stats.withMovies++;
                if (quotedHasUrl) results.stats.withDomains++;
                results.stats.quotesMatched++;
                return true;
            }
        }
        
        return false;
    }
    
    // Enhanced load with options
    function loadPreviousSession() {
        const saved = localStorage.getItem('twitterBookmarkScraperProgress');
        const session = localStorage.getItem('twitterScraperSession');
        
        if (saved || session) {
            const data = saved ? JSON.parse(saved) : null;
            const sessionData = session ? JSON.parse(session) : null;
            
            // Show detailed resume dialog
            let message = '📚 Previous session found!\n\n';
            if (data) {
                const linkCount = data.allLinks ? data.allLinks.length : 0;
                message += `📝 Tweets: ${data.filteredTweets?.length || 0} matched, ${data.allTweets?.length || 0} total\n`;
                message += `🔗 Links: ${linkCount} unique URLs\n`;
                message += `📅 Saved: ${new Date(data.stats?.savedAt || Date.now()).toLocaleString()}\n\n`;
            }
            message += 'Choose an option:\n';
            message += '1. Resume with all data (tweets + links + seen IDs)\n';
            message += '2. Start fresh but keep seen IDs (avoid re-processing)\n';
            message += '3. Start completely fresh\n\n';
            message += 'Enter 1, 2, or 3:';
            
            const choice = prompt(message, '1');
            
            if (choice === '1') {
                // Full resume
                if (data) {
                    results.allTweets = data.allTweets || [];
                    results.filteredTweets = data.filteredTweets || [];
                    results.allLinks = data.allLinks || [];
                    results.stats = data.stats || results.stats;
                    
                    // Rebuild seen sets
                    for (const tweet of results.allTweets) {
                        state.seenIds.add(tweet.id);
                        [...tweet.links, ...tweet.quoted_links].forEach(link => {
                            if (link) state.seenLinks.add(link);
                        });
                    }
                    
                    console.log(`✅ Resumed with ${results.filteredTweets.length} tweets and ${state.seenLinks.size} unique links`);
                }
                
            } else if (choice === '2') {
                // Keep only seen IDs to avoid reprocessing
                if (sessionData) {
                    state.seenIds = new Set(sessionData.seenIds || []);
                    console.log(`✅ Starting fresh but skipping ${state.seenIds.size} already-seen tweets`);
                }
                
            } else {
                // Complete fresh start
                localStorage.removeItem('twitterBookmarkScraperProgress');
                localStorage.removeItem('twitterScraperSession');
                console.log('✅ Starting completely fresh');
            }
            
        } else {
            console.log('No previous session found, starting fresh');
        }
        
        state.sessionStartTime = Date.now();
    }
    
    function saveProgress() {
        if (config.autoSave) {
            // Update unique links
            results.allLinks = Array.from(state.seenLinks);
            results.stats.uniqueLinks = state.seenLinks.size;
            results.stats.savedAt = new Date().toISOString();
            
            const progressData = {
                allTweets: results.allTweets,
                filteredTweets: results.filteredTweets,
                allLinks: results.allLinks,
                stats: results.stats
            };
            
            const sessionData = {
                seenIds: Array.from(state.seenIds),
                seenLinks: Array.from(state.seenLinks),
                sessionStartTime: state.sessionStartTime,
                savedAt: new Date().toISOString()
            };
            
            localStorage.setItem('twitterBookmarkScraperProgress', JSON.stringify(progressData));
            localStorage.setItem('twitterScraperSession', JSON.stringify(sessionData));
            
            console.log(`💾 Saved: ${results.filteredTweets.length} tweets, ${state.seenLinks.size} unique links`);
        }
    }
    
    function createControlPanel() {
        const existing = document.getElementById('twitter-scraper-control-panel');
        if (existing) existing.remove();
        
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
            max-height: 450px;
            overflow-y: auto;
        `;
        
        panel.innerHTML = `
            <div style="margin-bottom: 12px; font-weight: bold; color: #1d9bf0;">
                🐦 Twitter Bookmark Scraper
            </div>
            
            <div style="margin-bottom: 8px; font-size: 12px; line-height: 1.6;">
                <div>📊 Scrolls: <span id="scraper-scroll-count">0</span></div>
                <div>✓ Matched: <span id="scraper-matched-count">0</span></div>
                <div>📝 Total seen: <span id="scraper-total-count">0</span></div>
                <div>🔗 Unique links: <span id="scraper-unique-links">0</span></div>
                <div>💬 Quotes found: <span id="scraper-quote-count">0</span></div>
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
                ">Pause</button>
                <button id="scraper-stop-btn" style="
                    padding: 8px 12px;
                    background: #f4245e;
                    border: none;
                    border-radius: 20px;
                    color: white;
                    font-weight: bold;
                    cursor: pointer;
                    font-size: 12px;
                ">Stop</button>
            </div>
            
            <button id="scraper-export-links" style="
                width: 100%;
                padding: 8px 12px;
                background: #794bc4;
                border: none;
                border-radius: 20px;
                color: white;
                font-weight: bold;
                cursor: pointer;
                font-size: 12px;
            ">Export Links Only</button>
        `;
        
        document.body.appendChild(panel);
        
        document.getElementById('scraper-stop-btn').addEventListener('click', () => {
            state.shouldStop = true;
        });
        
        document.getElementById('scraper-pause-btn').addEventListener('click', (e) => {
            state.isPaused = !state.isPaused;
            e.target.textContent = state.isPaused ? 'Resume' : 'Pause';
            document.getElementById('scraper-status').textContent = state.isPaused ? 'Paused' : 'Running';
        });
        
        document.getElementById('scraper-export-links').addEventListener('click', () => {
            exportLinksOnly();
        });
    }
    
    function updateControlPanel() {
        const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        
        if (document.getElementById('scraper-scroll-count')) {
            document.getElementById('scraper-scroll-count').textContent = state.scrollCount;
            document.getElementById('scraper-matched-count').textContent = results.filteredTweets.length;
            document.getElementById('scraper-total-count').textContent = results.allTweets.length;
            document.getElementById('scraper-unique-links').textContent = state.seenLinks.size;
            document.getElementById('scraper-quote-count').textContent = state.quotesDetected;
            document.getElementById('scraper-time').textContent = `${minutes}m ${seconds}s`;
        }
    }
    
    function getRandomDelay(base) {
        if (!config.randomizeDelays) return base;
        return base + (Math.random() * base * 0.6 - base * 0.3);
    }
    
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    function checkForRateLimit() {
        const errorMessages = document.querySelectorAll('[role="alert"]');
        for (const msg of errorMessages) {
            if (msg.innerText.toLowerCase().includes('rate')) {
                return true;
            }
        }
        return false;
    }
    
    function extractTweets() {
        const tweets = [];
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        
        articles.forEach((article) => {
            try {
                const timeLink = article.querySelector('time')?.closest('a');
                const tweetId = timeLink ? timeLink.href.split('/').pop() : null;
                
                if (!tweetId) return;
                if (state.seenIds.has(tweetId)) return;
                
                const textElement = article.querySelector('[data-testid="tweetText"]');
                const text = textElement ? textElement.innerText : '';
                
                let links = extractLinksFromText(text);
                
                const anchors = article.querySelectorAll('a');
                for (const anchor of anchors) {
                    const href = anchor.href;
                    if (href && config.targetDomains.some(d => href.includes(d))) {
                        if (!links.includes(href)) {
                            links.push(href);
                        }
                    }
                }
                
                const quotedData = extractQuotedTweetData(article);
                
                if (quotedData.found) {
                    state.quotesDetected++;
                }
                
                // Track all links globally
                [...links, ...quotedData.links].forEach(link => {
                    if (link) state.seenLinks.add(link);
                });
                
                const tweetUrl = timeLink ? timeLink.href : '';
                
                const tweetData = {
                    id: tweetId,
                    author: article.querySelector('[data-testid="User-Name"]')?.innerText.split('\n')[0] || '',
                    text: text,
                    links: links,
                    quoted_author: quotedData.author,
                    quoted_text: quotedData.text,
                    quoted_links: quotedData.links,
                    has_quote: quotedData.found,
                    url: tweetUrl,
                    scraped_at: new Date().toISOString()
                };
                
                tweets.push(tweetData);
            } catch (e) {
                console.error('Extract error:', e);
                state.errorCount++;
            }
        });
        
        return tweets;
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
                    console.warn(`⚠️  Rate limit detected`);
                    state.currentDelay = Math.min(state.currentDelay * 1.5, config.maxScrollDelay);
                    await sleep(config.delayAfter429);
                }
                
                const newTweets = extractTweets();
                const beforeCount = results.allTweets.length;
                
                for (const tweet of newTweets) {
                    if (!state.seenIds.has(tweet.id)) {
                        state.seenIds.add(tweet.id);
                        results.allTweets.push(tweet);
                        
                        if (matchesFilter(tweet)) {
                            results.filteredTweets.push(tweet);
                            
                            let logMsg = `✓ ${tweet.id}`;
                            if (tweet.has_quote) logMsg += ' [QUOTE]';
                            if (tweet.links.length > 0) logMsg += ` [${tweet.links.length} LINKS]`;
                            console.log(logMsg);
                        } else if (tweet.has_quote) {
                            state.quotesFiltered++;
                        }
                    }
                }
                
                if (results.allTweets.length === beforeCount) {
                    noNewTweetsCount++;
                    if (noNewTweetsCount >= 5) {
                        console.log('No new tweets for 5 scrolls, done');
                        break;
                    }
                } else {
                    noNewTweetsCount = 0;
                }
                
                state.scrollCount++;
                updateControlPanel();
                
                console.log(`Scroll ${state.scrollCount}: ${results.allTweets.length} total, ${results.filteredTweets.length} matched, ${state.seenLinks.size} unique links`);
                
                if (config.autoSave && state.scrollCount % config.saveEvery === 0) {
                    saveProgress();
                }
                
                window.scrollTo({
                    top: document.body.scrollHeight,
                    behavior: 'smooth'
                });
                
                await sleep(getRandomDelay(state.currentDelay));
                state.currentDelay = Math.min(state.currentDelay + config.delayIncrement, config.maxScrollDelay);
                
                if (document.querySelector('[data-testid="emptyState"]')) {
                    console.log('Reached end of bookmarks');
                    break;
                }
                
            } catch (error) {
                console.error('Scroll error:', error);
                state.errorCount++;
                await sleep(config.delayAfter429);
            }
        }
    }
    
    function exportLinksOnly() {
        const linkData = {
            links: Array.from(state.seenLinks),
            count: state.seenLinks.size,
            scraped_at: new Date().toISOString(),
            domains: config.targetDomains
        };
        
        const blob = new Blob([JSON.stringify(linkData, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `twitter_links_only_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log(`📥 Exported ${state.seenLinks.size} unique links`);
    }
    
    function downloadResults() {
        const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
        
        const data = {
            config: config,
            stats: {
                ...results.stats,
                unique_tweets: results.allTweets.length,
                matched_filters: results.filteredTweets.length,
                unique_links: state.seenLinks.size,
                with_links: results.filteredTweets.filter(t => t.links.length > 0 || t.quoted_links.length > 0).length,
                quotes_found: state.quotesDetected,
                quotes_matched: results.stats.quotesMatched,
                quotes_filtered_out: state.quotesFiltered,
                scrolls: state.scrollCount,
                time_elapsed: elapsed
            },
            tweets: results.filteredTweets,
            all_links: Array.from(state.seenLinks),
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
    
    // Main execution
    try {
        if (!window.location.href.includes('/bookmarks')) {
            if (confirm('Navigate to bookmarks?')) {
                window.location.href = 'https://twitter.com/i/bookmarks';
            }
            return;
        }
        
        loadPreviousSession(); // Enhanced loading with options
        createControlPanel();
        
        console.log('Starting scraper - Press ESC to stop');
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') state.shouldStop = true;
        });
        
        await scrollAndCollect();
        saveProgress();
        
        const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
        
        console.log('\n=== COMPLETE ===');
        console.log(`Time: ${Math.floor(elapsed/60)}m ${elapsed%60}s`);
        console.log(`Tweets processed: ${results.allTweets.length}`);
        console.log(`Matched filters: ${results.filteredTweets.length}`);
        console.log(`Unique file sharing links: ${state.seenLinks.size}`);
        console.log(`Quotes found: ${state.quotesDetected}`);
        
        if (results.filteredTweets.length > 0) {
            downloadResults();
            console.log('✅ Full results downloaded');
        }
        
    } catch (error) {
        console.error('Fatal error:', error);
        saveProgress();
    }
})();