// src/urlAssociator.js
class UrlAssociator {
  constructor(config) {
    this.config = config;
  }

  associate(block, allUrls, usedUrls) {
    const associatedUrls = [];
    const blockLower = block.toLowerCase();
    
    // scan block for urls
    for (const url of allUrls) {
      if (usedUrls.has(url)) continue;
      
      // check if url appears in this block (case-insensitive)
      const urlLower = url.toLowerCase();
      if (blockLower.includes(urlLower) || this.fuzzyUrlMatch(blockLower, url)) {
        associatedUrls.push(url); // use original url, not lowercase
        usedUrls.add(url);
      }
    }
    
    // if no urls found in block, try order-based fallback
    if (associatedUrls.length === 0 && allUrls.length > 0) {
      for (const url of allUrls) {
        if (!usedUrls.has(url)) {
          associatedUrls.push(url);
          usedUrls.add(url);
          break;
        }
      }
    }
    
    return associatedUrls;
  }

  fuzzyUrlMatch(text, url) {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.replace('www.', '').toLowerCase();
      
      if (text.includes(domain)) return true;
      
      // check path segments
      const pathParts = urlObj.pathname.split('/').filter(p => p.length > 3);
      for (const part of pathParts) {
        if (text.includes(part.toLowerCase())) return true;
      }
    } catch (e) {
      // invalid url
    }
    
    return false;
  }
}

module.exports = UrlAssociator;