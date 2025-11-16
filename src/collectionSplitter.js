// src/collectionSplitter.js

// words that strongly suggest a bundle, not a single item
const COLLECTION_KEYWORDS = ['collection', 'complete', 'anthology', 'series', 'cartoon collection'];
const YEAR_RANGE_RE = /\b(19|20)\d{2}\s*[-–]\s*\d{2,4}\b/;
const TITLE_YEAR_RE = /^\s*([^(]+?)\s*\((\d{4}(?:\s*[-–]\s*\d{2,4})?)\)/i;

class CollectionSplitter {
  /**
   * Decide if this block looks like a collection and, if so,
   * return a franchise name + list of contained titles.
   */
  split(blockText) {
    const lines = blockText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (!lines.length) {
      return { isCollection: false };
    }

    const first = lines[0];
    const firstLower = first.toLowerCase();

    // collect all "Title (year...)" in block
    const items = [];
    for (const line of lines) {
      const m = line.match(TITLE_YEAR_RE);
      if (m) {
        const rawTitle = m[1].trim();
        const yearStr = m[2].trim();
        const yearOnly = yearStr.split(/[-–]/)[0].trim();
        items.push({ title: rawTitle, year: yearOnly });
      }
    }

    const multipleTitlePairs = items.length > 1;
    const hasKeyword = COLLECTION_KEYWORDS.some((kw) =>
      firstLower.includes(kw)
    );
    const hasYearRange = YEAR_RANGE_RE.test(first);

    // Heuristic: collection if:
    // - multiple title/year pairs, OR
    // - first line has collection keyword AND some title/year pairs
    if (!multipleTitlePairs && !(hasKeyword && items.length > 0) && !hasYearRange) {
      return { isCollection: false };
    }

    const franchise = first.replace(/\s*\(.*/, '').trim() || items[0]?.title;

    if (!franchise) {
      return { isCollection: false };
    }

    return {
      isCollection: true,
      franchise,
      items,
    };
  }
}

module.exports = CollectionSplitter;