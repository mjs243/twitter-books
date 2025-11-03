import asyncio
import logging
import sys
from pathlib import Path

# add src to path
sys.path.insert(0, str(Path(__file__).parent))

from src.scraper import TwitterBookmarkScraper
from src.storage import BookmarkStorage
from src.filters import TweetFilter
from src.config import Config

async def main():
    # check if we're in manual mode
    manual_mode = (
        not Config.USERNAME or 
        Config.USERNAME == 'your_username' or 
        not Config.PASSWORD or 
        Config.PASSWORD == 'your_password'
    )
    
    if manual_mode:
        print("\n" + "="*50)
        print("MANUAL LOGIN MODE")
        print("No credentials found in .env file")
        print("You'll need to log in manually in the browser")
        print("="*50 + "\n")
    
    # initialize scraper
    scraper = TwitterBookmarkScraper()
    
    # scrape bookmarks
    print(f"\n{'='*50}")
    print(f"Starting Twitter Bookmark Scraper")
    print(f"Target domains: {Config.TARGET_DOMAINS}")
    print(f"Also including: tweets with years, movies")
    print(f"Custom patterns: {Config.INCLUDE_PATTERNS}")
    print(f"{'='*50}\n")
    
    try:
        bookmarks = await scraper.scrape_bookmarks()
    except Exception as e:
        print(f"\nError during scraping: {e}")
        print("Please check the logs for more details")
        return
    
    if not bookmarks:
        print("No matching bookmarks found!")
        return
    
    # save results
    storage = BookmarkStorage(Config.DATA_DIR)
    
    # save all bookmarks
    json_path = await storage.save_json(bookmarks)
    csv_path = storage.save_csv(bookmarks)
    
    # categorize tweets
    filter = TweetFilter(Config.TARGET_DOMAINS, Config.INCLUDE_PATTERNS)
    categorized = filter.categorize_tweets(bookmarks)
    
    # save categorized
    (Config.DATA_DIR / 'filtered').mkdir(exist_ok=True)
    await storage.save_categorized(categorized)
    
    # get stats
    stats = filter.get_filter_stats(bookmarks)
    
    # print summary
    print(f"\n{'='*50}")
    print(f"Scraping Complete!")
    print(f"{'='*50}")
    print(f"\nResults:")
    print(f"  Total bookmarks processed: {scraper.total_processed}")
    print(f"  Matched filters: {len(bookmarks)}")
    print(f"\nMatch breakdown:")
    print(f"  With years: {stats['with_years']}")
    print(f"  With movies: {stats['with_movies']}")
    print(f"  With both: {stats['with_both']}")
    print(f"  With target domains: {stats['with_target_domains']}")
    print(f"\nCategory counts:")
    print(f"  Year mentions: {len(categorized['year_mentions'])}")
    print(f"  Movie mentions: {len(categorized['movie_mentions'])}")
    print(f"  Both year and movie: {len(categorized['both_year_and_movie'])}")
    
    if categorized['domain_matches']:
        print(f"\nBy domain:")
        for domain, tweets in categorized['domain_matches'].items():
            if tweets:
                print(f"  {domain}: {len(tweets)}")
    
    print(f"\nFiles saved:")
    print(f"  JSON: {json_path}")
    print(f"  CSV: {csv_path}")
    print(f"  Categorized in: {Config.DATA_DIR / 'filtered'}")
    print(f"{'='*50}\n")

if __name__ == "__main__":
    asyncio.run(main())