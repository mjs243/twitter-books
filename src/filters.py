import re
from urllib.parse import urlparse
from typing import List, Dict, Any

class TweetFilter:
    def __init__(self, target_domains: List[str] = None, include_patterns: List[str] = None):
        self.target_domains = target_domains or []
        self.include_patterns = include_patterns or []
        
        # compile regex patterns
        self.url_pattern = re.compile(
            r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+')
        
        # year pattern - matches 4-digit years from 1900-2099
        self.year_pattern = re.compile(r'\b(19|20)\d{2}\b')
        
        # movie pattern - case insensitive
        self.movie_pattern = re.compile(r'\bmovies?\b', re.IGNORECASE)
    
    def extract_urls(self, text: str) -> List[str]:
        """extract all urls from text"""
        if not text:
            return []
        return self.url_pattern.findall(text)
    
    def get_domain(self, url: str) -> str:
        """extract domain from url"""
        try:
            return urlparse(url).netloc.lower()
        except:
            return ''
    
    def contains_special_content(self, tweet: Dict[str, Any]) -> bool:
        """check if tweet contains year or movie mentions"""
        # collect all text
        all_text = tweet.get('text', '') + ' ' + tweet.get('quoted_text', '')
        
        # check for years
        if self.year_pattern.search(all_text):
            return True
        
        # check for movie mentions
        if self.movie_pattern.search(all_text):
            return True
        
        # check custom include patterns
        for pattern in self.include_patterns:
            if pattern.lower() in all_text.lower():
                return True
        
        return False
    
    def matches_target(self, tweet: Dict[str, Any]) -> bool:
        """check if tweet matches criteria - must have either target domain OR special content"""
        # collect all text
        all_text = []
        all_text.append(tweet.get('text', ''))
        all_text.append(tweet.get('quoted_text', ''))
        
        # check if contains special content (year/movie)
        if self.contains_special_content(tweet):
            return True
        
        # if no target domains specified and no special content, don't match
        if not self.target_domains:
            return False
        
        # extract all urls
        all_urls = []
        for text in all_text:
            all_urls.extend(self.extract_urls(text))
        
        # also check explicitly found links
        all_urls.extend(tweet.get('links', []))
        
        # check domains
        for url in all_urls:
            domain = self.get_domain(url)
            for target in self.target_domains:
                if target.lower() in domain:
                    return True
        
        return False
    
    def categorize_tweets(self, tweets: List[Dict]) -> Dict[str, List]:
        """categorize tweets by what matched them"""
        categorized = {
            'year_mentions': [],
            'movie_mentions': [],
            'both_year_and_movie': [],
            'domain_matches': {}
        }
        
        # initialize domain categories
        for domain in self.target_domains:
            categorized['domain_matches'][domain] = []
        categorized['domain_matches']['other'] = []
        
        for tweet in tweets:
            all_text = tweet.get('text', '') + ' ' + tweet.get('quoted_text', '')
            
            has_year = bool(self.year_pattern.search(all_text))
            has_movie = bool(self.movie_pattern.search(all_text))
            
            # categorize by content type
            if has_year and has_movie:
                categorized['both_year_and_movie'].append(tweet)
            elif has_year:
                categorized['year_mentions'].append(tweet)
            elif has_movie:
                categorized['movie_mentions'].append(tweet)
            
            # also check domain matches
            all_urls = self.extract_urls(all_text)
            all_urls.extend(tweet.get('links', []))
            
            matched_domain = False
            for url in all_urls:
                domain = self.get_domain(url)
                for target in self.target_domains:
                    if target.lower() in domain:
                        categorized['domain_matches'][target].append(tweet)
                        matched_domain = True
                        break
                if matched_domain:
                    break
            
            if not matched_domain and not has_year and not has_movie:
                categorized['domain_matches']['other'].append(tweet)
        
        return categorized
    
    def get_filter_stats(self, tweets: List[Dict]) -> Dict[str, int]:
        """get statistics about filtering"""
        stats = {
            'total': len(tweets),
            'with_years': 0,
            'with_movies': 0,
            'with_both': 0,
            'with_target_domains': 0,
            'matched_total': 0
        }
        
        for tweet in tweets:
            all_text = tweet.get('text', '') + ' ' + tweet.get('quoted_text', '')
            
            has_year = bool(self.year_pattern.search(all_text))
            has_movie = bool(self.movie_pattern.search(all_text))
            
            if has_year:
                stats['with_years'] += 1
            
            if has_movie:
                stats['with_movies'] += 1
            
            if has_year and has_movie:
                stats['with_both'] += 1
            
            # check domain matches
            all_urls = self.extract_urls(all_text)
            all_urls.extend(tweet.get('links', []))
            
            for url in all_urls:
                domain = self.get_domain(url)
                for target in self.target_domains:
                    if target.lower() in domain:
                        stats['with_target_domains'] += 1
                        break
                break
            
            if self.matches_target(tweet):
                stats['matched_total'] += 1
        
        return stats