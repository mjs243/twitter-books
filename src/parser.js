// src/parser.js
const fs = require('fs').promises;
const path = require('path');
const TextProcessor = require('./textProcessor');
const Extractors = require('./extractors');
const UrlAssociator = require('./urlAssociator');
const CollectionSplitter = require('./collectionSplitter');
const WikiDataClient = require('./wikidataClient');

/* ---------------- URL helpers ---------------- */

const URL_PROTO_BREAK_RE = /(https?:\/\/)\s*\n+\s*/gi;
const URL_RE = /https?:\/\/[^\s\])<>(“”"'’]+/gi;

/**
 * Repairs broken URLs across newlines and extracts all http(s) links
 * from text + quoted_text + links arrays.
 */
function collectUrlsFromTweet(tweet, unifiedText) {
  const pieces = [
    ...(tweet.links || []),
    ...(tweet.quoted_links || []),
    unifiedText,
  ];

  const raw = pieces.join(' ');
  const repaired = raw.replace(URL_PROTO_BREAK_RE, '$1');

  const urls = new Set();
  const matches = repaired.match(URL_RE) || [];
  for (let u of matches) {
    // strip trailing punctuation
    u = u.replace(/[.,;:!?]+$/, '');
    urls.add(u);
  }
  return Array.from(urls);
}

/* --------------- Watch-list helpers ----------- */

const WATCH_TRIGGERS = [
  /#nw\b/i,
  /\bnow[\s-]?watching\b/i,
  /\bjust[\s-]?watched\b/i,
  /\bwatching\b/i,
];

function extractWatchItems(unifiedText) {
  const lower = unifiedText.toLowerCase();
  if (!WATCH_TRIGGERS.some((re) => re.test(lower))) return [];

  const results = [];
  const lineRe = /[“”"]([^“”"]+)[“”"]|([A-Z][A-Za-z0-9 :\-’']+)\s*\((\d{4})\)/g;
  let m;
  while ((m = lineRe.exec(unifiedText)) !== null) {
    const title = (m[1] || m[2] || '').trim();
    const year = m[3] || null;
    if (!title) continue;

    results.push({
      title,
      year,
      type: 'media-interest',
      quality: [],
      season_episode_info: null,
      associated_urls: [],
      wikidata_enhanced: false,
      isWatch: true,
    });
  }
  return results;
}

/* --------------- Main class ------------------- */

class MediaParser {
  constructor(configPath = '../config/parser.config.json') {
    this.config = require(configPath);
    this.textProcessor = new TextProcessor(this.config);
    this.extractors = new Extractors(this.config);
    this.urlAssociator = new UrlAssociator(this.config);
    this.collectionSplitter = new CollectionSplitter();

    this.wikidata = null;
    if (this.config.wikidata?.enabled) {
      this.wikidata = new WikiDataClient(this.config.wikidata.cache_dir);
    }
  }

  async parseFile(inputPath, outputPath) {
    try {
      if (this.wikidata) await this.wikidata.init();

      const raw = await fs.readFile(inputPath, 'utf8');
      const data = JSON.parse(raw);

      if (!Array.isArray(data.tweets)) {
        throw new Error('invalid input: expected tweets array');
      }

      const processedTweets = [];
      for (let i = 0; i < data.tweets.length; i += 1) {
        if ((i + 1) % 10 === 0) {
          console.log(`  processing tweet ${i + 1}/${data.tweets.length}...`);
        }
        processedTweets.push(await this.parseTweet(data.tweets[i]));
      }

      if (this.wikidata) await this.wikidata.shutdown();

      const stats = this.buildStats(processedTweets);
      const output = {
        ...data,
        tweets: processedTweets,
        parser_stats: stats,
      };

      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');

      console.log(
        `\n✅ parsing complete: ${stats.tweets_processed} tweets, ` +
          `${stats.total_media_items} items, ` +
          `${stats.wikidata_enhanced} wikidata-enhanced`
      );

      return output;
    } catch (err) {
      console.error('❌ parsing failed:', err.message);
      throw err;
    }
  }

  async parseTweet(tweet) {
    const unifiedText = this.textProcessor.unifyText(
      tweet.text,
      tweet.quoted_text
    );

    // 1. URLs (with line-break repair)
    const allUrls = collectUrlsFromTweet(tweet, unifiedText);

    // 2. Watch-list items
    const watchItems = extractWatchItems(unifiedText);

    // 3. If nothing suggests media, bail early
    if (
      !watchItems.length &&
      !allUrls.length &&
      !this.hasMediaIndicators(unifiedText)
    ) {
      return {
        ...tweet,
        parsed_media: {
          media_items: [],
          unassociated_urls: [],
          skipped_reason: 'no_media_indicators',
        },
      };
    }

    const normalized = this.textProcessor.normalize(unifiedText);
    const blocks = this.textProcessor.splitIntoBlocks(normalized);

    const mediaItems = [...watchItems];
    const usedUrls = new Set();

    for (const block of blocks) {
      const split = this.collectionSplitter.split(block);

      if (!split.isCollection) {
        const item = await this.parseSingleBlock(block, allUrls, usedUrls);
        if (item) mediaItems.push(item);
      } else {
        const collection = this.buildCollectionFromSplit(
          split,
          allUrls,
          usedUrls
        );
        if (collection) mediaItems.push(collection);
      }
    }

    const unassociated = allUrls.filter((u) => !usedUrls.has(u));

    return {
      ...tweet,
      parsed_media: {
        media_items: mediaItems,
        unassociated_urls: unassociated,
      },
    };
  }

  async parseSingleBlock(block, allUrls, usedUrls) {
    const titleData = this.extractors.extractTitle(block);
    if (!titleData) return null;

    let item = {
      title: titleData.title,
      year: titleData.year || this.extractors.extractYear(block),
      type: this.extractors.extractType(block),
      quality: this.extractors.extractQuality(block),
      season_episode_info: this.extractors.extractSeasonInfo(block),
      associated_urls: this.urlAssociator.associate(block, allUrls, usedUrls),
      wikidata_enhanced: false,
    };

    if (this.wikidata) {
      try {
        const res = await this.wikidata.searchMedia(item.title, item.year);
        if (res && res.confidence >= this.config.wikidata.min_confidence) {
          item = {
            ...item,
            title: res.title || item.title,
            year: item.year || res.year,
            type: item.type || res.type,
            wikidata_id: res.wikidata_id,
            imdb_id: res.imdb_id,
            steam_id: res.steam_id,
            wikidata_confidence: res.confidence,
            wikidata_enhanced: true,
          };
        }
      } catch (e) {
        console.warn(`wikidata error for "${item.title}":`, e.message);
      }
    }

    return item;
  }

  buildCollectionFromSplit(split, allUrls, usedUrls) {
    if (!split || !split.franchise) return null;

    // just treat the entire set of URLs as applying to the collection
    const urlsForCollection = [];
    for (const url of allUrls) {
      if (!usedUrls.has(url)) {
        urlsForCollection.push(url);
        usedUrls.add(url);
      }
    }

    return {
      title: split.franchise,
      year: split.items?.[0]?.year || null,
      type: 'collection',
      quality: [], // could aggregate later
      season_episode_info: null,
      isCollection: true,
      items_included: split.items || [],
      associated_urls: urlsForCollection,
      wikidata_enhanced: false,
    };
  }

  hasMediaIndicators(text) {
    const lower = text.toLowerCase();

    const hasQuality = this.config.quality_keywords.some((kw) =>
      lower.includes(kw.toLowerCase())
    );
    const hasDomain = this.config.url_domains.some((d) =>
      lower.includes(d.toLowerCase())
    );
    const hasYear = /\b(19|20)\d{2}\b/.test(lower);

    return hasQuality || hasDomain || hasYear;
  }

  buildStats(tweets) {
    let totalItems = 0;
    let tweetsWithMedia = 0;
    let wikidataEnhanced = 0;

    for (const tw of tweets) {
      const items = tw.parsed_media?.media_items || [];
      if (items.length) tweetsWithMedia += 1;
      totalItems += items.length;
      wikidataEnhanced += items.filter((i) => i.wikidata_enhanced).length;
    }

    return {
      tweets_processed: tweets.length,
      tweets_with_media: tweetsWithMedia,
      total_media_items: totalItems,
      wikidata_enhanced: wikidataEnhanced,
      parsed_at: new Date().toISOString(),
    };
  }
}

module.exports = MediaParser;