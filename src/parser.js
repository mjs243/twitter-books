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

function collectUrlsFromTweet(tweet, unifiedForUrls) {
  const pieces = [
    ...(tweet.links || []),
    ...(tweet.quoted_links || []),
    unifiedForUrls || '',
  ];

  // join and repair multi-line URLs
  const raw = pieces.join('\n');
  const repairedText = repairBrokenUrlsInText(raw);

  const urls = new Set();
  const matches = repairedText.match(URL_RE) || [];

  for (let url of matches) {
    url = url.replace(/[.,;:!?]+$/, '');
    urls.add(url);
  }

  return Array.from(urls);
}

function repairBrokenUrlsInText(text) {
  const lines = text.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    // case 1: line is just "https://" or "http://"
    if (/^https?:\/\/$/i.test(trimmed)) {
      let url = trimmed;
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j].trim();
        if (!next) {
          j += 1;
          continue;
        }
        // stop if next line is a new label or another protocol
        if (/^(https?:\/\/|\w+:)/i.test(next)) break;
        url += next;
        j += 1;
        // stop if it clearly looks done (… or space)
        if (/[.…\s]/.test(next)) break;
      }
      out.push(url);
      i = j - 1;
      continue;
    }

    // case 2: "https://domain/.../" then id on next line
    if (/https?:\/\/\S+\/$/i.test(trimmed) && i + 1 < lines.length) {
      const next = lines[i + 1].trim();
      if (/^[A-Za-z0-9/?&=_.-]+(\?.*)?$/.test(next)) {
        out.push(trimmed + next);
        i += 1;
        continue;
      }
    }

    // case 3: "https://vkvideo.ru/playlist/-2299" + "37903_23"
    if (/https?:\/\/\S+$/i.test(trimmed) && i + 1 < lines.length) {
      const next = lines[i + 1].trim();
      if (
        /^[A-Za-z0-9_/?&=.-]+$/.test(next) &&
        !/^https?:\/\//i.test(next)
      ) {
        out.push(trimmed + next);
        i += 1;
        continue;
      }
    }

    out.push(line);
  }

  return out.join('\n');
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
  // either "Title" or Title (1990)
  const re =
    /[“”"]([^“”"]+)[“”"]|([A-Z][A-Za-z0-9 :\-’']+?)\s*\((\d{4})\)/g;

  let m;
  while ((m = re.exec(unifiedText)) !== null) {
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

    this.mediaTypesForWikidata = new Set([
      'film',
      'tv series',
      'tv film',
      'documentary',
      'game',
    ]);
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
    const mainText = tweet.text || '';
    const quotedText = tweet.quoted_text || '';

    // use both for URLs, but only mainText for titles
    const unifiedForUrls = [mainText, quotedText].filter(Boolean).join('\n');

    const allUrls = collectUrlsFromTweet(tweet, unifiedForUrls);
    const watchItems = extractWatchItems(unifiedForUrls);

    // if literally nothing looks like media, bail early
    if (
      !allUrls.length &&
      !watchItems.length &&
      !this.hasMediaIndicators(mainText)
    ) {
      return {
        ...tweet,
        parsed_media: {
          media_items: [],
          media_interest_items: [],
          unassociated_urls: [],
          skipped_reason: 'no_media_indicators',
        },
      };
    }

    const normalizedMain = this.textProcessor.normalize(mainText);
    const blocks = this.textProcessor.splitIntoBlocks(normalizedMain);

    const parsedItems = [];
    const usedUrls = new Set();

    // 1. parse main text blocks into items / collections
    for (const block of blocks) {
      const split = this.collectionSplitter.split(block);

      if (!split.isCollection) {
        const item = await this.parseSingleBlock(block, allUrls, usedUrls);
        if (item) parsedItems.push(item);
      } else {
        const collection = this.buildCollectionFromSplit(
          split,
          allUrls,
          usedUrls
        );
        if (collection) parsedItems.push(collection);
      }
    }

    // 2. classify items into downloads vs interest
    const hasAnyUrl = allUrls.length > 0;
    const mediaItems = [];
    const mediaInterestItems = [];

    // watch items always go to interest
    for (const w of watchItems) {
      mediaInterestItems.push(w);
    }

    for (const item of parsedItems) {
      const hasUrls =
        Array.isArray(item.associated_urls) &&
        item.associated_urls.length > 0;

      if (!hasAnyUrl) {
        // tweet has no URLs at all → this is all media-of-interest
        mediaInterestItems.push(item);
        continue;
      }

      if (item.isWatch) {
        mediaInterestItems.push(item);
      } else if (item.isCollection || hasUrls) {
        mediaItems.push(item);
      } else {
        // noisy descriptive line with no URL in a tweet that *does* have URLs → drop
      }
    }

    this.finalizeUrlAssignments(mediaItems, allUrls);

    // recompute used URLs after finalization
    const usedNow = new Set();
    for (const item of mediaItems) {
      (item.associated_urls || []).forEach((u) => usedNow.add(u));
    }

    const unassociated = allUrls.filter((u) => !usedNow.has(u));

    return {
      ...tweet,
      parsed_media: {
        media_items: mediaItems,
        media_interest_items: mediaInterestItems,
        unassociated_urls: unassociated,
      },
    };
  }

  async parseSingleBlock(block, allUrls, usedUrls) {
    const titleData = this.extractors.extractTitle(block);
    if (!titleData) return null;

    const year = titleData.year || this.extractors.extractYear(block);
    const type = this.extractors.extractType(block);
    const quality = this.extractors.extractQuality(block);
    const seasonInfo = this.extractors.extractSeasonInfo(block);

    const associated = this.urlAssociator.associate(block, allUrls, usedUrls);

    // quick filter: titles that are clearly junk
    const titleLower = titleData.title.toLowerCase();
    const badTitleStarts = [
      'download links',
      'download link',
      'in this folder you\'ll find',
      'bonus',
      'movies',
      'anime',
      'manga',
      'series',
      'complete series',
      'full color',
      'one hundred',
      'quoted tweet',
    ];
    if (
      badTitleStarts.some((p) => titleLower.startsWith(p)) &&
      associated.length === 0
    ) {
      return null;
    }

    let item = {
      title: titleData.title,
      year: year || null,
      type: type,
      quality,
      season_episode_info: seasonInfo,
      associated_urls: associated,
      wikidata_enhanced: false,
    };

    // call wikidata only if this actually looks like media
    const looksLikeMedia =
      (year && year.length === 4) ||
      (type && this.mediaTypesForWikidata.has(type));

    if (this.wikidata && looksLikeMedia) {
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

    // assign *all remaining* URLs to this collection
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
      quality: [],
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

  finalizeUrlAssignments(mediaItems, allUrls) {
    if (!allUrls.length || !mediaItems.length) return;

    const used = new Set();
    for (const item of mediaItems) {
      (item.associated_urls || []).forEach((u) => used.add(u));
    }

    const unusedUrls = allUrls.filter((u) => !used.has(u));

    if (!unusedUrls.length) return;

    // "primary" items are collections or items that already have URLs
    const primary = mediaItems.filter(
      (i) =>
        i.isCollection ||
        (Array.isArray(i.associated_urls) && i.associated_urls.length > 0)
    );

    if (primary.length === 1) {
      // single collection / single main item → give it ALL remaining URLs
      const target = primary[0];
      if (!Array.isArray(target.associated_urls)) {
        target.associated_urls = [];
      }
      for (const url of unusedUrls) {
        target.associated_urls.push(url);
        used.add(url);
      }
      return;
    }

    // multiple primary items:
    // assign remaining URLs in order to items that currently have none
    const noUrlItems = mediaItems.filter(
      (i) => !i.associated_urls || i.associated_urls.length === 0
    );

    let idx = 0;
    for (const item of noUrlItems) {
      if (idx >= unusedUrls.length) break;
      item.associated_urls = [unusedUrls[idx]];
      used.add(unusedUrls[idx]);
      idx += 1;
    }
  }
}

module.exports = MediaParser;