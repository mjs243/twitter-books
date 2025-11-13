// src/extractors.js
class Extractors {
  constructor(config) {
    this.config = config;
    this.patterns = this.compilePatterns();
  }

  compilePatterns() {
    return {
      title_with_year: new RegExp(
        this.config.regex_patterns.title_with_year,
        "i"
      ),
      quoted_title: new RegExp(
        this.config.regex_patterns.quoted_title,
        "i"
      ),
      year: new RegExp(this.config.regex_patterns.year, "i"),
      season_episode: new RegExp(
        this.config.regex_patterns.season_episode,
        "i"
      ),
      url: new RegExp(this.config.regex_patterns.url, "gi"),
      resolution: new RegExp(this.config.regex_patterns.resolution, "i"),
    };
  }

  extractTitle(block) {
    const yearMatch = block.match(this.patterns.title_with_year);
    if (yearMatch) {
      const title = this.cleanTitle(yearMatch[1]);
      if (title) {
        return {
          title: this.properCase(title),
          year: yearMatch[2],
        };
      }
    }

    const quotedMatch = block.match(this.patterns.quoted_title);
    if (quotedMatch) {
      const title = this.cleanTitle(quotedMatch[1]);
      if (title) {
        return {
          title: this.properCase(title),
          year: null,
        };
      }
    }

    const lines = block.split("\n").map((l) => l.trim()).filter((l) => l);
    for (const line of lines) {
      if (this.looksLikeTitle(line)) {
        const title = this.extractTitleFromLine(line);
        if (title) {
          return {
            title: this.properCase(title),
            year: null,
          };
        }
      }
    }

    return null;
  }

  extractTitleFromLine(line) {
    let title = line;
    title = title.replace(/\s*\(\d{4}(?:-\d{2,4})?\)\s*$/, "").trim();

    if (title.includes(":") && !title.startsWith("http")) {
      const parts = title.split(":");
      if (
        parts[0].length > 3 &&
        !parts[0].match(/^(season|episode|part)\s*\d+$/i)
      ) {
        title = parts[0].trim();
      }
    }

    return this.cleanTitle(title);
  }

  looksLikeTitle(line) {
    if (!line || line.startsWith("http")) return false;

    const lower = line.toLowerCase();

    // filter out descriptive lines
    const junkPatterns = [
      /^\d+\s+(episodes|volumes|seasons)/,
      /^two special episodes/,
      /^\(there are lots of/,
      /^complete series/,
      /bonus materials are included/,
      /extract and enjoy/,
    ];
    if (junkPatterns.some((p) => p.test(lower))) {
      return false;
    }

    // must have letters
    if (!/[a-z]/i.test(line)) return false;

    const letterCount = (line.match(/[a-z]/gi) || []).length;
    if (letterCount < line.length * 0.4) return false;

    return true;
  }

  cleanTitle(text) {
    if (!text) return null;
    let cleaned = text.trim();
    cleaned = cleaned.replace(/[:\-,]+$/, "").trim();

    const lower = cleaned.toLowerCase();
    for (const stopword of this.config.title_stopwords) {
      if (lower === stopword) return null;
    }

    if (cleaned.length < 2) return null;

    return cleaned;
  }

  properCase(text) {
    if (/[A-Z].*[a-z]/.test(text)) {
      return text;
    }
    return text.replace(
      /\w\S*/g,
      (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
  }

  extractYear(block) {
    const match = block.match(this.patterns.year);
    return match ? match[1] : null;
  }

  extractQuality(block) {
    const qualities = [];
    const lower = block.toLowerCase();
    const seen = new Set();
    for (const keyword of this.config.quality_keywords) {
      const kwLower = keyword.toLowerCase();
      if (lower.includes(kwLower) && !seen.has(kwLower)) {
        qualities.push(keyword);
        seen.add(kwLower);
      }
    }
    return qualities;
  }

  extractType(block) {
    const lower = block.toLowerCase();
    for (const [type, keywords] of Object.entries(
      this.config.type_keywords
    )) {
      for (const keyword of keywords) {
        if (lower.includes(keyword.toLowerCase())) {
          return type.replace("_", " ");
        }
      }
    }
    return null;
  }

  extractSeasonInfo(block) {
    const match = block.match(this.patterns.season_episode);
    return match ? match[0] : null;
  }
}

module.exports = Extractors;