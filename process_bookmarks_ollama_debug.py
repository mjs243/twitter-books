import json
import requests
import re
from pathlib import Path
from typing import Dict, List, Any, Optional
import sys
import time
from datetime import datetime

class BookmarkAIProcessor:
    def __init__(self, model: str = "mistral", ollama_url: str = "http://localhost:11434", 
                 timeout: int = 180, debug: bool = False, show_reasoning: bool = False):
        self.model = model
        self.ollama_url = ollama_url
        self.api_endpoint = f"{ollama_url}/api/generate"
        self.tags_endpoint = f"{ollama_url}/api/tags"
        self.timeout = timeout
        self.max_retries = 3
        self.debug = debug
        self.show_reasoning = show_reasoning
        
        self.check_connection()
        self.check_model_loaded()
    
    def check_connection(self):
        """verify ollama is running"""
        try:
            print(f"Checking connection to Ollama at {self.ollama_url}...")
            response = requests.get(self.tags_endpoint, timeout=5)
            
            if response.status_code == 200:
                print(f"✓ Connected to Ollama")
            else:
                print(f"✗ Ollama returned status {response.status_code}")
                sys.exit(1)
        except requests.exceptions.ConnectionError:
            print(f"✗ Cannot connect to Ollama at {self.ollama_url}")
            print("Make sure Ollama is running: ollama serve")
            sys.exit(1)
        except requests.exceptions.Timeout:
            print(f"✗ Timeout connecting to Ollama")
            sys.exit(1)
        except Exception as e:
            print(f"✗ Error: {e}")
            sys.exit(1)
    
    def check_model_loaded(self):
        """check if model is available"""
        try:
            print(f"Checking if model '{self.model}' is loaded...")
            response = requests.get(self.tags_endpoint, timeout=5)
            data = response.json()
            
            models = [m['name'].split(':')[0] for m in data.get('models', [])]
            
            if self.model in models:
                print(f"✓ Model '{self.model}' is available\n")
            else:
                print(f"✗ Model '{self.model}' not found")
                print(f"Available models: {', '.join(models)}")
                print(f"To download: ollama pull {self.model}")
                sys.exit(1)
        except Exception as e:
            print(f"Warning: Could not verify model: {e}\n")
    
    def extract_from_tweet(self, tweet: Dict[str, str], attempt: int = 1) -> Dict[str, Any]:
        """use local AI to extract movie/tv info from tweet"""
        
        # combine all text - be explicit about sources
        full_text = f"""AUTHOR (SKIP THIS): {tweet.get('author', 'Unknown')}

MAIN TWEET TEXT:
{tweet.get('text', '')}

QUOTED TWEET TEXT:
{tweet.get('quoted_text', '')}

URLS IN TWEET:
{', '.join(tweet.get('links', []) + tweet.get('quoted_links', [])) if (tweet.get('links') or tweet.get('quoted_links')) else 'None'}"""
        
        # improved prompt with examples and chain of thought
        if self.show_reasoning:
            prompt = f"""Extract information from this tweet. Show your reasoning step by step.

{full_text}

INSTRUCTIONS:
1. IGNORE the author name - it's NOT a movie/TV title
2. Look for ACTUAL titles in the MAIN TWEET TEXT section
3. Extract ONLY from the text content, not metadata

EXAMPLES:
- If text says "Game of Thrones S01 1080p" → Title: Game of Thrones
- If text says "Director John Smith's Collection" → NO title (it's a person)
- If text says "Breaking Bad Complete Series" → Title: Breaking Bad

NOW EXTRACT from the tweet above.

First, identify what this tweet is about:
[Your reasoning]

Then provide:
TITLE: [the actual movie/TV show title, NOT the author]
URL: [file sharing URL if present]
QUALITY: [video quality like 1080p, 4K, etc]
TYPE: [Movie/TV Series/Documentary/etc]
SUMMARY: [one sentence description]

If a field is not found or not applicable, skip it."""
        else:
            prompt = f"""Extract structured information from this tweet.

{full_text}

CRITICAL: Ignore the author name - extract ONLY movie/TV titles from the MAIN TWEET TEXT section.

Extract and provide (skip if not found):
TITLE: [movie/TV show name ONLY - not author]
URL: [file sharing URL]
QUALITY: [video quality/format]
TYPE: [Movie/TV/Documentary/etc]
SUMMARY: [one line description]"""
        
        try:
            if self.debug:
                print(f"\n{'='*60}")
                print(f"DEBUG: Tweet ID {tweet.get('id')}")
                print(f"Author: {tweet.get('author')}")
                print(f"Text preview: {tweet.get('text')[:100]}...")
                print(f"{'='*60}")
            
            print(f"  Extracting... (attempt {attempt}/{self.max_retries})", end='', flush=True)
            
            start = time.time()
            response = requests.post(
                self.api_endpoint,
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "stream": False,
                    "temperature": 0.2,  # lower for more consistent extraction
                    "num_predict": 150
                },
                timeout=self.timeout
            )
            elapsed = time.time() - start
            
            if response.status_code != 200:
                print(f" ✗ Error {response.status_code}")
                if attempt < self.max_retries:
                    print(f"  Retrying...")
                    time.sleep(5)
                    return self.extract_from_tweet(tweet, attempt + 1)
                return {"error": f"API error {response.status_code}"}
            
            result = response.json()
            raw_response = result['response']
            
            if self.debug or self.show_reasoning:
                print(f"\nRAW MODEL RESPONSE:\n{raw_response}\n")
            
            extracted = self._parse_extraction(raw_response, tweet.get('author', ''))
            
            if self.debug:
                print(f"PARSED RESULT: {extracted}\n")
            
            print(f" ✓ ({elapsed:.1f}s)")
            return extracted
            
        except requests.exceptions.Timeout:
            print(f" ✗ Timeout ({self.timeout}s)")
            if attempt < self.max_retries:
                print(f"  Retrying...")
                time.sleep(5)
                return self.extract_from_tweet(tweet, attempt + 1)
            return {"error": "timeout"}
        except Exception as e:
            print(f" ✗ Error: {e}")
            return {"error": str(e)}
    
    def _parse_extraction(self, response: str, author_name: str = "") -> Dict[str, Any]:
        """parse AI response with validation to avoid false positives"""
        extracted = {
            "titles": [],
            "urls": [],
            "quality": [],
            "type": [],
            "summary": "",
            "raw_response": response
        }
        
        # common false positives to filter
        false_positives = {
            'collection', 'post', 'tweet', 'video', 'file', 'link', 'content',
            'archive', 'folder', 'directory', 'drive', 'share', 'upload',
            'document', 'library', 'backup', 'storage', 'media', 'resource'
        }
        
        for line in response.split('\n'):
            line = line.strip()
            if not line:
                continue
            
            if line.startswith('TITLE:'):
                title = line.replace('TITLE:', '').strip()
                
                # validation: filter out author names and false positives
                if (title and 
                    len(title) > 2 and 
                    title.lower() != 'none' and
                    title.lower() != author_name.lower() and
                    not any(fp in title.lower() for fp in false_positives) and
                    not self._looks_like_person_name(title)):
                    
                    extracted["titles"].append(title)
                elif self.debug:
                    print(f"  FILTERED TITLE: '{title}' (reason: likely false positive)")
            
            elif line.startswith('URL:'):
                url = line.replace('URL:', '').strip()
                if (url and 
                    ('http' in url or any(domain in url for domain in 
                     ['gofile', 'transfer', 'mega', 'drive.google', 'dropbox', 'cloud'])) and
                    url.lower() != 'none' and
                    len(url) > 10):
                    
                    extracted["urls"].append(url)
                elif self.debug:
                    print(f"  FILTERED URL: '{url}'")
            
            elif line.startswith('QUALITY:'):
                qual = line.replace('QUALITY:', '').strip()
                # validate quality is reasonable
                if (qual and 
                    qual.lower() != 'none' and
                    any(q in qual.lower() for q in ['p', 'k', 'remux', 'webrip', 'dvdrip', 'bdrip', 'vhs'])):
                    
                    extracted["quality"].append(qual)
            
            elif line.startswith('TYPE:'):
                typ = line.replace('TYPE:', '').strip()
                valid_types = ['movie', 'tv', 'documentary', 'series', 'film', 'show', 'miniseries', 'special']
                
                if (typ and 
                    typ.lower() != 'none' and
                    any(vt in typ.lower() for vt in valid_types)):
                    
                    extracted["type"].append(typ)
            
            elif line.startswith('SUMMARY:'):
                summary = line.replace('SUMMARY:', '').strip()
                if summary and summary.lower() != 'none' and len(summary) > 5:
                    extracted["summary"] = summary
        
        return extracted
    
    def _looks_like_person_name(self, text: str) -> bool:
        """heuristic to detect if text looks like a person name rather than title"""
        # common patterns for person names
        patterns = [
            r"^[A-Z][a-z]+\s+[A-Z][a-z]+$",  # First Last
            r"^[A-Z]\.\s+[A-Z][a-z]+$",      # Initial Last
            r"'s\s+",                          # Possessive (like "John's Collection")
            r"^(Dr|Mr|Mrs|Ms|Prof|Sir)\s+",   # Titles
        ]
        
        for pattern in patterns:
            if re.match(pattern, text):
                return True
        
        return False
    
    def process_bookmarks(self, json_file: str, output_file: str = None, limit: int = None):
        """process bookmark json file with AI"""
        
        with open(json_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        tweets = data.get('tweets', [])
        print(f"\nProcessing {len(tweets)} tweets with {self.model}...")
        print(f"Debug mode: {self.debug}")
        print(f"Show reasoning: {self.show_reasoning}\n")
        
        processed_tweets = []
        errors = []
        start_time = time.time()
        
        for idx, tweet in enumerate(tweets):
            if limit and idx >= limit:
                print(f"\nReached limit of {limit} tweets")
                break
            
            try:
                print(f"[{idx+1}/{min(len(tweets), limit or len(tweets))}] {tweet.get('id')}", end=' ')
                
                extraction = self.extract_from_tweet(tweet)
                
                if extraction.get("error"):
                    errors.append({
                        'tweet_id': tweet.get('id'),
                        'error': extraction['error']
                    })
                    print(f"⚠️  {extraction['error']}")
                    continue
                
                processed_tweet = {
                    **tweet,
                    "ai_extraction": extraction
                }
                
                processed_tweets.append(processed_tweet)
                
                # show results
                if extraction.get("titles"):
                    print(f"→ {extraction['titles'][0]}", end='')
                if extraction.get("urls"):
                    print(f" | URLs: {len(extraction['urls'])}", end='')
                print()
                
            except KeyboardInterrupt:
                print("\n\nInterrupted by user")
                break
            except Exception as e:
                print(f"✗ Error: {e}")
                errors.append({
                    'tweet_id': tweet.get('id'),
                    'error': str(e)
                })
        
        elapsed = time.time() - start_time
        
        if not output_file:
            stem = Path(json_file).stem
            output_file = f"{stem}_processed_{self.model}.json"
        
        output_data = {
            "model": self.model,
            "original_file": json_file,
            "debug_mode": self.debug,
            "processed_count": len(processed_tweets),
            "failed_count": len(errors),
            "time_elapsed": elapsed,
            "tweets": processed_tweets,
            "errors": errors,
            "summary": self._create_summary(processed_tweets)
        }
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)
        
        print(f"\n{'='*60}")
        print(f"✓ Processing complete!")
        print(f"  Processed: {len(processed_tweets)}")
        print(f"  Failed: {len(errors)}")
        print(f"  Time: {elapsed/60:.1f} minutes")
        print(f"  Output: {output_file}")
        print(f"{'='*60}\n")
        
        return processed_tweets
    
    def _create_summary(self, processed_tweets: List[Dict]) -> Dict[str, Any]:
        """create summary statistics"""
        all_titles = set()
        all_urls = set()
        all_qualities = set()
        all_types = set()
        
        for tweet in processed_tweets:
            extraction = tweet.get("ai_extraction", {})
            all_titles.update(extraction.get("titles", []))
            all_urls.update(extraction.get("urls", []))
            all_qualities.update(extraction.get("quality", []))
            all_types.update(extraction.get("type", []))
        
        return {
            "unique_titles": len(all_titles),
            "unique_urls": len(all_urls),
            "quality_formats": sorted(list(all_qualities)),
            "types": sorted(list(all_types)),
            "sample_titles": sorted(list(all_titles))[:10]
        }

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Process bookmarks with local AI')
    parser.add_argument('json_file', help='Path to bookmark JSON file')
    parser.add_argument('--model', default='mistral', help='Ollama model')
    parser.add_argument('--output', help='Output file path')
    parser.add_argument('--limit', type=int, help='Limit number of tweets')
    parser.add_argument('--timeout', type=int, default=180, help='Timeout in seconds')
    parser.add_argument('--url', default='http://localhost:11434', help='Ollama URL')
    parser.add_argument('--debug', action='store_true', help='Show debug info and raw responses')
    parser.add_argument('--reasoning', action='store_true', help='Show model reasoning (slower but more accurate)')
    
    args = parser.parse_args()
    
    processor = BookmarkAIProcessor(
        model=args.model, 
        ollama_url=args.url, 
        timeout=args.timeout,
        debug=args.debug,
        show_reasoning=args.reasoning
    )
    
    processor.process_bookmarks(args.json_file, args.output, args.limit)

if __name__ == "__main__":
    main()
