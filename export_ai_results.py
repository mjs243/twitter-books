import json
import csv
from pathlib import Path

def export_to_csv(processed_json: str, output_csv: str = None):
    """export ai-processed bookmarks to csv"""
    
    with open(processed_json, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    tweets = data.get('tweets', [])
    
    if not output_csv:
        output_csv = processed_json.replace('.json', '.csv')
    
    with open(output_csv, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=[
            'id', 'author', 'text', 'urls', 'ai_titles', 'ai_quality', 
            'ai_type', 'ai_summary', 'tweet_url'
        ])
        writer.writeheader()
        
        for tweet in tweets:
            extraction = tweet.get('ai_extraction', {})
            
            writer.writerow({
                'id': tweet.get('id'),
                'author': tweet.get('author'),
                'text': tweet.get('text', '')[:100],
                'urls': '|'.join(tweet.get('links', []))[:200],
                'ai_titles': '|'.join(extraction.get('titles', [])),
                'ai_quality': '|'.join(extraction.get('quality', [])),
                'ai_type': '|'.join(extraction.get('type', [])),
                'ai_summary': extraction.get('summary', ''),
                'tweet_url': tweet.get('url', '')
            })
    
    print(f"✓ CSV exported to: {output_csv}")

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python export_ai_results.py <processed_json_file>")
        sys.exit(1)
    
    export_to_csv(sys.argv[1])
