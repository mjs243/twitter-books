// patient twitter bookmark scraper - handles rate limiting
(async function() {
    console.log('Starting Patient Twitter Bookmark Scraper...');
    
    // configuration
    const config = {
        targetDomains: ['transfer.it', 'gofile.io', 'hubcloud.fit', 'drive.google.com', 'mega.nz', 'boxd.it'],
        includePatterns: ['documentary', 'film', 'cinema', '35mm', 'imax', '1080p', 'remux', 'hd', 'uhd', '4k', 'gb'],
        
        // timing configuration (in ms)
        minScrollDelay: 3000,      // minimum 3 seconds
        maxScrollDelay: 15000,      // maximum 15 seconds
        delayAfter429: 60000,       // wait 1 minute after rate limit
        delayIncrement: 1000,       // increase delay by 1s after each scroll
        batchPauseEvery: 5,         // pause after every 5 scrolls
        batchPauseTime: 30000,      // pause for 30 seconds
        maxScrolls: 500,            // max scrolls (can handle ~5000+ tweets)
        
        // behavior
        simulateReading: true,      // simulate reading tweets
        randomizeDelays: true,      // add randomness to delays
        autoSave: true,             // save progress periodically
        saveEvery: 10,              // save every 10 scrolls
        continueOnError: true       // continue after errors
    };
    
    // state
    const state = {
        currentDelay: config.minScrollDelay,
        scrollCount: 0,
        errorCount: 0,
        rateLimitCount: 0,
        lastSaveScroll: 0,
        startTime: Date.now()
    };
    
    // regex patterns
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
            errors: []
        }
    };
    
    // load previous progress if exists
    function loadProgress() {
        const saved = localStorage.getItem('twitterBookmarkScraperProgress');
        if (saved) {
            const data = JSON.parse(saved);
            const resume = confirm(`Found previous scraping session with ${data.filteredTweets.length} tweets. Resume?`);
            if (resume) {
                results.allTweets = data.allTweets || [];
                results.filteredTweets = data.filteredTweets || [];
                results.stats = data.stats || results.stats;
                console.log(`Resumed with ${results.filteredTweets.length} filtered tweets`);
            } else {
                localStorage.removeItem('twitterBookmarkScraperProgress');
            }
        }
    }
    
    // save progress
    function saveProgress() {
        if (config.autoSave) {
            localStorage.setItem('twitterBookmarkScraperProgress', JSON.stringify(results));
            console.log(`Progress saved: ${results.filteredTweets.length} filtered tweets`);
        }
    }
    
    // get random delay
    function getRandomDelay(base) {
        if (!config.randomizeDelays) return base;
        const variation = base * 0.3; // 30% variation
        return base + (Math.random() * variation * 2 - variation);
    }
    
    // simulate human-like reading
    async function simulateReading() {
        if (!config.simulateReading) return;
        
        // randomly scroll up a bit sometimes
        if (Math.random() < 0.1) {
            const scrollUp = Math.random() * 300 + 100;
            window.scrollBy(0, -scrollUp);
            await sleep(getRandomDelay(1000));
            window.scrollBy(0, scrollUp);
        }
        
        // random micro movements
        if (Math.random() < 0.2) {
            window.scrollBy(0, Math.random() * 50 - 25);
        }
    }
    
    // sleep function
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // check for rate limit
    function checkForRateLimit() {
        // check for rate limit indicators in network responses or UI
        const errorMessages = document.querySelectorAll('[role="alert"]');
        for (const msg of errorMessages) {
            if (msg.innerText.toLowerCase().includes('rate') || 
                msg.innerText.toLowerCase().includes('try again')) {
                return true;
            }
        }
        
        // check if tweets aren't loading
        const spinner = document.querySelector('[role="progressbar"]');
        if (spinner && state.scrollCount > 5) {
            // if spinner is present after initial load, might be rate limited
            return true;
        }
        
        return false;
    }
    
    // extract tweet data from dom
    function extractTweets() {
        const tweets = [];
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        
        articles.forEach(article => {
            try {
                // get tweet id
                const timeLink = article.querySelector('time')?.closest('a');
                const tweetId = timeLink ? timeLink.href.split('/').pop() : null;
                
                // skip if already processed
                if (results.allTweets.some(t => t.id === tweetId)) return;
                
                // get main text
                const textElement = article.querySelector('[data-testid="tweetText"]');
                const text = textElement ? textElement.innerText : '';
                
                // get all links
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
                const author = authorElement ? authorElement.innerText.split('\n')[0] : '';
                
                // get tweet url
                const tweetUrl = timeLink ? timeLink.href : '';
                
                tweets.push({
                    id: tweetId,
                    author: author,
                    text: text,
                    links: links,
                    quoted_text: quotedText,
                    quoted_links: quotedLinks,
                    has_quote: quotedArticle !== null,
                    url: tweetUrl,
                    scraped_at: new Date().toISOString()
                });
            } catch (e) {
                console.error('Error extracting tweet:', e);
                state.errorCount++;
            }
        });
        
        return tweets;
    }
    
    // check if tweet matches filters
    function matchesFilter(tweet) {
        const allText = (tweet.text + ' ' + tweet.quoted_text).toLowerCase();
        const allLinks = [...tweet.links, ...tweet.quoted_links];
        
        // check for year
        if (yearPattern.test(allText)) {
            results.stats.withYears++;
            return true;
        }
        
        // check for movie
        if (moviePattern.test(allText)) {
            results.stats.withMovies++;
            return true;
        }
        
        // check for custom patterns
        for (const pattern of config.includePatterns) {
            if (allText.includes(pattern.toLowerCase())) {
                return true;
            }
        }
        
        // check for target domains
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
    
    // scroll and collect tweets
    async function scrollAndCollect() {
        let noNewTweetsCount = 0;
        
        while (state.scrollCount < config.maxScrolls) {
            try {
                // check for rate limit
                if (checkForRateLimit()) {
                    state.rateLimitCount++;
                    console.warn(`⚠️ Rate limit detected (#${state.rateLimitCount}), pausing for 1 minute...`);
                    results.stats.errors.push({
                        type: 'rate_limit',
                        scroll: state.scrollCount,
                        time: new Date().toISOString()
                    });
                    
                    // increase delay for future scrolls
                    state.currentDelay = Math.min(state.currentDelay * 1.5, config.maxScrollDelay);
                    
                    await sleep(config.delayAfter429);
                }
                
                // extract current tweets
                const newTweets = extractTweets();
                const beforeCount = results.allTweets.length;
                
                // add new tweets
                for (const tweet of newTweets) {
                    if (!results.allTweets.some(t => t.id === tweet.id)) {
                        results.allTweets.push(tweet);
                        
                        // check filter
                        if (matchesFilter(tweet)) {
                            results.filteredTweets.push(tweet);
                            console.log(`✓ Matched tweet ${tweet.id} - Total: ${results.filteredTweets.length}`);
                        }
                    }
                }
                
                // check if we got new tweets
                if (results.allTweets.length === beforeCount) {
                    noNewTweetsCount++;
                    if (noNewTweetsCount >= 5) {
                        console.log('No new tweets found after 5 attempts, stopping...');
                        break;
                    }
                    console.log(`No new tweets (attempt ${noNewTweetsCount}/5)`);
                } else {
                    noNewTweetsCount = 0;
                }
                
                // simulate reading
                await simulateReading();
                
                // scroll
                const scrollDistance = document.body.scrollHeight - window.innerHeight - window.scrollY;
                if (scrollDistance > 0) {
                    window.scrollTo({
                        top: document.body.scrollHeight,
                        behavior: 'smooth'
                    });
                }
                
                state.scrollCount++;
                
                // calculate time elapsed
                const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
                const minutes = Math.floor(elapsed / 60);
                const seconds = elapsed % 60;
                
                console.log(`Scroll ${state.scrollCount}: ${results.allTweets.length} total, ${results.filteredTweets.length} matched | Time: ${minutes}m ${seconds}s | Delay: ${Math.round(state.currentDelay/1000)}s`);
                
                // save progress periodically
                if (config.autoSave && state.scrollCount - state.lastSaveScroll >= config.saveEvery) {
                    saveProgress();
                    state.lastSaveScroll = state.scrollCount;
                }
                
                // batch pause
                if (state.scrollCount % config.batchPauseEvery === 0) {
                    console.log(`Taking a ${config.batchPauseTime/1000}s break after ${config.batchPauseEvery} scrolls...`);
                    await sleep(config.batchPauseTime);
                }
                
                // wait with current delay
                const delay = getRandomDelay(state.currentDelay);
                await sleep(delay);
                
                // gradually increase delay
                state.currentDelay = Math.min(
                    state.currentDelay + config.delayIncrement,
                    config.maxScrollDelay
                );
                
                // check for end
                if (document.querySelector('[data-testid="emptyState"]')) {
                    console.log('Reached end of bookmarks');
                    break;
                }
                
            } catch (error) {
                state.errorCount++;
                console.error('Error during scroll:', error);
                results.stats.errors.push({
                    type: 'scroll_error',
                    error: error.message,
                    scroll: state.scrollCount,
                    time: new Date().toISOString()
                });
                
                if (!config.continueOnError) {
                    throw error;
                }
                
                // wait before retrying
                await sleep(config.delayAfter429);
            }
        }
    }
    
    // download results
    function downloadResults() {
        const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
        
        const data = {
            config: config,
            stats: {
                ...results.stats,
                total: results.allTweets.length,
                matched: results.filteredTweets.length,
                scrolls: state.scrollCount,
                errors: state.errorCount,
                rateLimits: state.rateLimitCount,
                timeElapsed: elapsed
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
    
    // main execution
    try {
        // check if we're on bookmarks page
        if (!window.location.href.includes('/bookmarks')) {
            const confirmNav = confirm('Not on bookmarks page. Navigate there now?');
            if (confirmNav) {
                window.location.href = 'https://twitter.com/i/bookmarks';
                console.log('Please run the script again once the page loads');
                return;
            }
        }
        
        // load any previous progress
        loadProgress();
        
        // start scraping
        console.log('Configuration:', config);
        console.log('This will take a while to avoid rate limits. Feel free to switch tabs!');
        await scrollAndCollect();
        
        // final save
        saveProgress();
        
        // show results
        const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
        console.log('\n=== SCRAPING COMPLETE ===');
        console.log(`Time elapsed: ${Math.floor(elapsed/60)} minutes ${elapsed%60} seconds`);
        console.log(`Total bookmarks: ${results.allTweets.length}`);
        console.log(`Matched filters: ${results.filteredTweets.length}`);
        console.log(`With years: ${results.stats.withYears}`);
        console.log(`With movies: ${results.stats.withMovies}`);
        console.log(`With target domains: ${results.stats.withDomains}`);
        console.log(`Errors encountered: ${state.errorCount}`);
        console.log(`Rate limits hit: ${state.rateLimitCount}`);
        
        // download
        if (results.filteredTweets.length > 0) {
            downloadResults();
            console.log('Results downloaded!');
            
            // clear saved progress
            localStorage.removeItem('twitterBookmarkScraperProgress');
        } else {
            console.log('No tweets matched the filters');
        }
        
    } catch (error) {
        console.error('Fatal error during scraping:', error);
        // save progress even on error
        saveProgress();
        console.log('Progress saved. You can resume by running the script again.');
    }
})();
