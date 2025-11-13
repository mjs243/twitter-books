// src/collectionSplitter.js
const COLLECTION_KEYWORDS = ["collection", "complete", "all", "seasons"];
const MULTI_RANGE_RE     = /\b\d{4}\s*-\s*\d{2,4}\b/;      // 1989-2009

class CollectionSplitter {
  /**
   * Returns:
   *   { single: true }                                         → keep 1 record
   *   { single: false, collectionInfo: {...} }                 → treat as collection
   *
   * collectionInfo:
   *   { franchise, items, isCollection }                       // share the URLs
   */
  splitIfCollection(blockText) {
    const lines = blockText.split('\n').map(l => l.trim()).filter(l => l);

    // First line inspections
    const first = lines[0] || '';
    const firstLow = first.toLowerCase();
    const hasKeyword   = COLLECTION_KEYWORDS.some(kw => firstLow.includes(kw));
    const hasDateSpan  = MULTI_RANGE_RE.test(first);

    // Build items from `(THING year)` pairs
    const titleYearRE = /^\s*([^(]+?)\s*\((\d{4}(?:\s*[-–]\s*\d{2,4})?)\)/i;
    const items = [];
    const detectedPairs = [];

    for (const ln of lines) {
      const m = ln.match(titleYearRE);
      if (m) {
        items.push({ title: m[1].trim(), year: m[2]?.split('-')[0] });
        detectedPairs.push(m);
      }
    }

    const multiPairs = detectedPairs.length > 1;

    // FINAL DECISION
    if ((hasKeyword || hasDateSpan || multiPairs) && detectedPairs.length > 0) {
      const franchise = first.replace(/\s*\(.*/, '').trim();
      return {
        single: false,
        collectionInfo: {
          franchise,
          items,
          isCollection: true,
        },
      };
    }
    return { single: true };
  }
}

module.exports = CollectionSplitter;