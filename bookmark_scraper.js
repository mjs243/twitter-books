// twitter bookmark scraper - run this in browser console
(async function() {
    console.log('Starting Twitter Bookmark Scraper...');
    
    // configuration
    const config = {
        targetDomains: ['transfer.it', 'gofile.io', 'hubcloud.fit', 'drive.google.com', 'mega.nz', 'boxd.it'],
        includePatterns: ['documentary', 'film', 'cinema', '35mm', 'imax', '1080p', 'remux', 'hd', 'uhd', '4k', 'gb'],
        scrollDelay: 2000,
        maxScrolls: 100
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
            withDomains: 0
        }
    };
    
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
        let scrollCount = 0;
        let noNewTweetsCount = 0;
        
        while (scrollCount < config.maxScrolls) {
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
                if (noNewTweetsCount >= 3) {
                    console.log('No new tweets found, stopping...');
                    break;
                }
            } else {
                noNewTweetsCount = 0;
            }
            
            // scroll
            window.scrollTo(0, document.body.scrollHeight);
            console.log(`Scroll ${++scrollCount}: ${results.allTweets.length} total, ${results.filteredTweets.length} matched`);
            
            // wait
            await new Promise(resolve => setTimeout(resolve, config.scrollDelay));
            
            // check for end
            if (document.querySelector('[data-testid="emptyState"]')) {
                console.log('Reached end of bookmarks');
                break;
            }
        }
    }
    
    // download results
    function downloadResults() {
        const data = {
            config: config,
            stats: {
                ...results.stats,
                total: results.allTweets.length,
                matched: results.filteredTweets.length
            },
            tweets: results.filteredTweets,
            scraped_at: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `twitter_bookmarks_${new Date().toISOString().slice(0,10)}.json`;
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
        
        // start scraping
        console.log('Configuration:', config);
        await scrollAndCollect();
        
        // show results
        console.log('\n=== SCRAPING COMPLETE ===');
        console.log(`Total bookmarks: ${results.allTweets.length}`);
        console.log(`Matched filters: ${results.filteredTweets.length}`);
        console.log(`With years: ${results.stats.withYears}`);
        console.log(`With movies: ${results.stats.withMovies}`);
        console.log(`With target domains: ${results.stats.withDomains}`);
        
        // download
        if (results.filteredTweets.length > 0) {
            downloadResults();
            console.log('Results downloaded!');
            
            // also log to console for inspection
            console.log('\nFiltered tweets:', results.filteredTweets);
        } else {
            console.log('No tweets matched the filters');
        }
        
    } catch (error) {
        console.error('Error during scraping:', error);
    }
})();
