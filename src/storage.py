import json
import csv
from pathlib import Path
from datetime import datetime
from typing import List, Dict
import aiofiles

class BookmarkStorage:
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    async def save_json(self, data: List[Dict], filename: str = None):
        """save bookmarks as json"""
        filename = filename or f'bookmarks_{self.timestamp}.json'
        filepath = self.base_dir / filename
        
        async with aiofiles.open(filepath, 'w') as f:
            await f.write(json.dumps(data, indent=2, ensure_ascii=False))
        
        return filepath
    
    def save_csv(self, data: List[Dict], filename: str = None):
        """save bookmarks as csv"""
        filename = filename or f'bookmarks_{self.timestamp}.csv'
        filepath = self.base_dir / filename
        
        if not data:
            return None
        
        # flatten nested data
        flat_data = []
        for tweet in data:
            flat_tweet = {
                'id': tweet.get('id'),
                'author': tweet.get('author'),
                'text': tweet.get('text'),
                'links': '|'.join(tweet.get('links', [])),
                'has_quote': tweet.get('has_quote'),
                'quoted_text': tweet.get('quoted_text'),
                'quoted_links': '|'.join(tweet.get('quoted_links', []))
            }
            flat_data.append(flat_tweet)
        
        with open(filepath, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=flat_data[0].keys())
            writer.writeheader()
            writer.writerows(flat_data)
        
        return filepath
    
    async def save_categorized(self, categorized: Dict):
        """save categorized tweets"""
        # save year mentions
        if categorized['year_mentions']:
            await self.save_json(categorized['year_mentions'], 
                               f'filtered/year_mentions_{self.timestamp}.json')
        
        # save movie mentions
        if categorized['movie_mentions']:
            await self.save_json(categorized['movie_mentions'], 
                               f'filtered/movie_mentions_{self.timestamp}.json')
        
        # save both
        if categorized['both_year_and_movie']:
            await self.save_json(categorized['both_year_and_movie'], 
                               f'filtered/year_and_movie_{self.timestamp}.json')
        
        # save by domain
        for domain, tweets in categorized['domain_matches'].items():
            if tweets:
                filename = f'filtered/{domain.replace(".", "_")}_{self.timestamp}.json'
                await self.save_json(tweets, filename)