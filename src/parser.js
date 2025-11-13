// src/parser.js
const fs = require("fs").promises;
const path = require("path");
const TextProcessor = require("./textProcessor");
const Extractors = require("./extractors");
const UrlAssociator = require("./urlAssociator");
const WikiDataClient = require("./wikidataClient");
const CollectionSplitter = require("./collectionSplitter");

class MediaParser {
    constructor(configPath = "../config/parser.config.json") {
        this.config = require(configPath);
        this.textProcessor = new TextProcessor(this.config);
        this.extractors = new Extractors(this.config);
        this.urlAssociator = new UrlAssociator(this.config);

        this.wikidata = null;
        if (this.config.wikidata?.enabled) {
            this.wikidata = new WikiDataClient(this.config.wikidata.cache_dir);
        }
    }

    async parseFile(inputPath, outputPath) {
        try {
            if (this.wikidata) await this.wikidata.init();

            const rawData = await fs.readFile(inputPath, "utf8");
            const data = JSON.parse(rawData);

            if (!data.tweets || !Array.isArray(data.tweets)) {
                throw new Error("invalid input: expected tweets array");
            }

            const processedTweets = [];
            for (let i = 0; i < data.tweets.length; i++) {
                if ((i + 1) % 10 === 0) console.log(`  processing tweet ${i + 1}/${data.tweets.length}...`);
                const processed = await this.parseTweet(data.tweets[i]);
                processedTweets.push(processed);
            }

            if (this.wikidata) await this.wikidata.shutdown();

            const stats = this.generateStats(processedTweets);
            const output = { ...data, tweets: processedTweets, parser_stats: stats };

            const outputDir = path.dirname(outputPath);
            await fs.mkdir(outputDir, { recursive: true });
            await fs.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");

            console.log(`\n✅ parsing complete!`);
            console.log(`   - tweets processed: ${stats.tweets_processed}`);
            console.log(`   - media found: ${stats.total_media_items} items in ${stats.tweets_with_media} tweets`);
            if (this.wikidata) console.log(`   - wikidata enhanced: ${stats.wikidata_enhanced} items`);
            console.log(`   - output saved to: ${outputPath}`);

            return output;
        } catch (error) {
            console.error("❌ parsing failed:", error.message, error.stack);
            throw error;
        }
    }

    async parseTweet(tweet) {
        const unifiedText = this.textProcessor.unifyText(
            tweet.text,
            tweet.quoted_text
        );

        if (!this.mightContainMedia(tweet, unifiedText)) {
            return {
                ...tweet,
                parsed_media: {
                    media_items: [],
                    unassociated_urls: [],
                    skipped_reason: "no_media_indicators",
                },
            };
        }

        const normalizedText = this.textProcessor.normalize(unifiedText);
        const allUrls = this.extractUrls(tweet, normalizedText);
        const blocks = this.textProcessor.splitIntoBlocks(normalizedText);

        const mediaItems = [];
        const usedUrls = new Set();

        const splitter = new CollectionSplitter();
        for (const block of blocks) {
            const split = splitter.splitIfCollection(block);

            if (split.single) {
                const mediaItem = await this.parseIndividualBlock(block, allUrls, usedUrls);
                if (mediaItem && mediaItem.title) mediaItems.push(mediaItem);
            } else {
                // This block represents a collection => 1 row
                const collectionEntity = await this.buildCollectionEntity(
                    split.collectionInfo, block, allUrls, usedUrls
                );
                if (collectionEntity) mediaItems.push(collectionEntity);
            }
        }

        const unassociatedUrls = allUrls.filter((url) => !usedUrls.has(url));

        return {
            ...tweet,
            parsed_media: { media_items: mediaItems, unassociated_urls: unassociatedUrls },
        };
    }

    async parseBlock(block, allUrls, usedUrls) {
        const titleData = this.extractors.extractTitle(block);
        if (!titleData) return null;

        let mediaItem = {
            title: titleData.title,
            year: titleData.year || this.extractors.extractYear(block),
            type: this.extractors.extractType(block),
            quality: this.extractors.extractQuality(block),
            season_episode_info: this.extractors.extractSeasonInfo(block),
            associated_urls: this.urlAssociator.associate(block, allUrls, usedUrls),
            wikidata_enhanced: false,
        };

        if (this.wikidata) {
            console.log(`  → searching wikidata for: "${mediaItem.title}" (${mediaItem.year || "no year"})`);
            try {
                const result = await this.wikidata.searchMedia(mediaItem.title, mediaItem.year);
                if (result && result.confidence >= this.config.wikidata.min_confidence) {
                    mediaItem = {
                        ...mediaItem,
                        title: result.title,
                        year: mediaItem.year || result.year,
                        type: mediaItem.type || result.type,
                        wikidata_id: result.wikidata_id,
                        imdb_id: result.imdb_id,
                        steam_id: result.steam_id,
                        wikidata_confidence: result.confidence,
                        wikidata_enhanced: true,
                    };
                    console.log(`    ✓ enhanced to: "${mediaItem.title}" (conf: ${result.confidence})`);
                } else if (result) {
                    console.log(`    ⚠ confidence too low: ${result.confidence} < ${this.config.wikidata.min_confidence}`);
                } else {
                    console.log(`    ✗ no wikidata match found`);
                }
            } catch (error) {
                console.warn(`    ✗ wikidata error: ${error.message}`);
            }
        }
        return mediaItem;
    }

    async buildCollectionEntity(collection, blockText, allUrls, usedUrls) {
        const quality = this.extractors.extractQuality(blockText);
        const urls = this.urlAssociator.associate(blockText, allUrls, usedUrls);

        return {
            title: collection.franchise,
            year: collection.items[0]?.year ?? null,
            type: "collection",
            quality,
            season_episode_info: null,
            isCollection: true,
            items_included: collection.items,
            associated_urls: urls,
            wikidata_enhanced: false,
        };
    }

    async parseIndividualBlock(block, allUrls, usedUrls) {
        const titleData = this.extractors.extractTitle(block);
        if (!titleData) return null;

        let mediaItem = {
            title: titleData.title,
            year: titleData.year || this.extractors.extractYear(block),
            type: this.extractors.extractType(block),
            quality: this.extractors.extractQuality(block),
            season_episode_info: this.extractors.extractSeasonInfo(block),
            associated_urls: this.urlAssociator.associate(block, allUrls, usedUrls),
            wikidata_enhanced: false,
        };

        if (this.wikidata) {
            const result = await this.wikidata.searchMedia(mediaItem.title, mediaItem.year);
            if (result && result.confidence >= this.config.wikidata.min_confidence) {
                mediaItem = { ...mediaItem, ...result, wikidata_enhanced: true };
            }
        }
        return mediaItem;
    }

    mightContainMedia(tweet, unifiedText) {
        const lowerText = unifiedText.toLowerCase();
        const hasYear = /\b(19|20)\d{2}\b/.test(lowerText);
        const hasQuality = this.config.quality_keywords.some((kw) => lowerText.includes(kw));
        const hasType = Object.values(this.config.type_keywords).flat().some((kw) => lowerText.includes(kw));

        const allLinksText = [
            ...(tweet.links || []),
            ...(tweet.quoted_links || []),
            unifiedText,
        ].join(" ");
        const hasDomain = this.config.url_domains.some((d) => allLinksText.includes(d));

        return hasDomain || hasYear || hasQuality || hasType;
    }

    extractUrls(tweet, unifiedText) {
        const urls = new Set();
        const fixLineBreaks = (text) => text.replace(/(https?:\/\/)\s*\n+\s*/gi, "$1");
        const cleanedText = fixLineBreaks(unifiedText);

        const allLinks = [...(tweet.links || []), ...(tweet.quoted_links || [])];
        allLinks.forEach((url) => urls.add(fixLineBreaks(url).trim()));

        const urlPattern = new RegExp(this.config.regex_patterns.url, "gi");
        const matches = cleanedText.match(urlPattern) || [];
        matches.forEach((url) => urls.add(url.replace(/[.,;!?]+$/, "")));

        return Array.from(urls);
    }

    generateStats(tweets) {
        let tweets_with_media = 0;
        let total_media_items = 0;
        let wikidata_enhanced = 0;

        for (const tweet of tweets) {
            const items = tweet.parsed_media?.media_items;
            if (items?.length > 0) {
                tweets_with_media++;
                total_media_items += items.length;
                wikidata_enhanced += items.filter((i) => i.wikidata_enhanced).length;
            }
        }

        return {
            tweets_processed: tweets.length,
            tweets_with_media,
            total_media_items,
            wikidata_enhanced,
            parsed_at: new Date().toISOString(),
        };
    }
}

module.exports = MediaParser;