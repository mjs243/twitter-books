// src/wikidataClient.js
const https = require("https");
const fs = require("fs").promises;
const path = require("path");

class WikiDataClient {
  constructor(cacheDir = "./cache") {
    this.endpoint = "https://www.wikidata.org/w/api.php";
    this.cacheDir = cacheDir;
    this.cache = new Map();
    this.rateLimitDelay = 500;
    this.lastRequestTime = 0;
  }

  async init() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      await this.loadCache();
    } catch (error) {
      console.warn("cache initialization failed:", error.message);
    }
  }

  async loadCache() {
    try {
      const cachePath = path.join(this.cacheDir, "wikidata-cache.json");
      const data = await fs.readFile(cachePath, "utf8");
      const cacheData = JSON.parse(data);
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      let loaded = 0;
      for (const [key, entry] of Object.entries(cacheData)) {
        if (entry.timestamp > weekAgo) {
          this.cache.set(key, entry);
          loaded++;
        }
      }
      console.log(`loaded ${loaded} cached wikidata entries`);
    } catch (error) {
      // no cache yet
    }
  }

  async searchMedia(title, year = null) {
    const cacheKey = `search:${title.toLowerCase()}:${year || "any"}`;
    if (this.cache.has(cacheKey)) {
      console.log(`      → cache hit for "${title}"`);
      return this.cache.get(cacheKey).data;
    }

    await this.rateLimit();

    try {
      let searchResults = await this.performSearch(title, year);
      if (!searchResults?.search?.length && year) {
        console.log(`      → retrying without year: "${title}"`);
        searchResults = await this.performSearch(title);
      }

      if (!searchResults?.search?.length) {
        console.log(`      → no search results`);
        return null;
      }
      console.log(`      → found ${searchResults.search.length} raw results`);

      const candidates = [];
      for (const result of searchResults.search.slice(0, 3)) {
        console.log(`      → checking candidate: ${result.label} (${result.id})`);
        const details = await this.getEntityDetails(result.id);
        if (details && this.isMediaEntity(details)) {
          const formatted = this.formatEntity(details, title, year);
          console.log(`        ✓ is media: ${formatted.type}`);
          candidates.push(formatted);
        } else {
          console.log(`        ✗ not a media entity`);
        }
      }

      const best = this.selectBestMatch(candidates, title, year);
      if (best) {
        console.log(`      → selected: "${best.title}" (confidence: ${best.confidence})`);
        this.cache.set(cacheKey, { data: best, timestamp: Date.now() });
      } else {
        console.log(`      → no suitable match found`);
      }
      return best;
    } catch (error) {
      console.warn(`      ✗ wikidata error: ${error.message}`);
      return null;
    }
  }

  async performSearch(title, year = null) {
    const searchQuery = year ? `${title} ${year}` : title;
    const params = new URLSearchParams({
      action: "wbsearchentities",
      search: searchQuery,
      language: "en",
      type: "item",
      limit: 10,
      format: "json",
    });
    await this.rateLimit();
    return this.makeRequest(`?${params}`);
  }

  async getEntityDetails(entityId) {
    const params = new URLSearchParams({
      action: "wbgetentities",
      ids: entityId,
      props: "claims|labels|descriptions",
      languages: "en",
      format: "json",
    });
    await this.rateLimit();
    const result = await this.makeRequest(`?${params}`);
    return result?.entities?.[entityId];
  }

  isMediaEntity(entity) {
    const claims = entity.claims;
    if (!claims?.P31) return false;

    const mediaTypes = [
      "Q11424", "Q5398426", "Q506240", "Q336144", "Q1366112",
      "Q21191270", "Q7889", "Q16070115", "Q7058673", "Q63952888",
      "Q220898", "Q581714", "Q202866", "Q8274", // manga
    ];

    return claims.P31.some(
      (claim) =>
        mediaTypes.includes(claim?.mainsnak?.datavalue?.value?.id)
    );
  }

  formatEntity(entity, searchTitle, searchYear) {
    const claims = entity.claims;
    const title = entity.labels?.en?.value || searchTitle;
    let year = null;
    const dateProps = ["P577", "P571"]; // publication date, inception
    for (const prop of dateProps) {
      const dateValue = claims[prop]?.[0]?.mainsnak?.datavalue?.value?.time;
      if (dateValue) {
        year = dateValue.match(/(\d{4})/)?.[1];
        break;
      }
    }

    let type = "unknown";
    const instanceOf = claims.P31?.[0]?.mainsnak?.datavalue?.value?.id;
    if (instanceOf) {
      if (["Q11424", "Q581714"].includes(instanceOf)) type = "film";
      else if (["Q5398426", "Q63952888", "Q220898"].includes(instanceOf)) type = "tv series";
      else if (["Q7889", "Q16070115"].includes(instanceOf)) type = "game";
    }

    let externalId = null;
    if (claims.P345?.[0]) externalId = { imdb_id: claims.P345[0].mainsnak.datavalue.value };
    else if (claims.P1733?.[0]) externalId = { steam_id: claims.P1733[0].mainsnak.datavalue.value };

    return { title, year, type, wikidata_id: entity.id, ...externalId };
  }

  selectBestMatch(candidates, searchTitle, searchYear) {
    if (!candidates?.length) return null;
    const scored = candidates.map((c) => {
      let score = 20;
      const titleLower = c.title.toLowerCase();
      const searchLower = searchTitle.toLowerCase();
      if (titleLower === searchLower) score += 50;
      else if (titleLower.includes(searchLower) || searchLower.includes(titleLower)) score += 25;
      if (searchYear && c.year === searchYear) score += 25;
      if (c.imdb_id || c.steam_id) score += 10;
      return { ...c, confidence: score };
    });
    scored.sort((a, b) => b.confidence - a.confidence);
    return scored[0];
  }

  async rateLimit() {
    const now = Date.now();
    const timeSince = now - this.lastRequestTime;
    if (timeSince < this.rateLimitDelay) {
      await this.sleep(this.rateLimitDelay - timeSince);
    }
    this.lastRequestTime = Date.now();
  }

  makeRequest(query) {
    return new Promise((resolve, reject) => {
      const url = `${this.endpoint}${query}`;
      https.get(url, { headers: { "User-Agent": "MediaParser/1.0" } }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) { reject(e); }
        });
      }).on("error", reject);
    });
  }

  sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  async shutdown() { await this.saveCache(); }
  async saveCache() {
    try {
      const cachePath = path.join(this.cacheDir, "wikidata-cache.json");
      const data = Object.fromEntries(this.cache);
      await fs.writeFile(cachePath, JSON.stringify(data, null, 2));
    } catch (e) { console.warn("failed to save cache:", e.message); }
  }
}

module.exports = WikiDataClient;