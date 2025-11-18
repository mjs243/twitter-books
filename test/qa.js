// test/qa.js
const fs = require('fs');
const assert = require('assert');

// tiny helper: find tweet whose text contains a substring (case-insensitive)
function findTweetByText(data, substring) {
  const target = substring.toLowerCase();
  return data.tweets.find((t) =>
    (t.text || '').toLowerCase().includes(target)
  );
}

function runCase(name, fn, data) {
  try {
    fn(data, assert);
    console.log(`✓ ${name}`);
    return { name, passed: true };
  } catch (e) {
    console.error(`✗ ${name}`);
    console.error(`  → ${e.message}`);
    return { name, passed: false, error: e };
  }
}

function main() {
  const file = process.argv[2] || 'output/parsed-bookmarks.json';
  if (!fs.existsSync(file)) {
    console.error(`error: file not found: ${file}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  if (!Array.isArray(data.tweets)) {
    console.error('error: parsed file has no tweets[] array');
    process.exit(1);
  }

  const results = [];

  // 1) Dragon Ball: Dragon Ball has at least one URL
  results.push(
    runCase('Dragon Ball: Dragon Ball has at least one URL', (data, assert) => {
      const tw = findTweetByText(data, 'Dragon Ball (1986-1989)');
      assert(tw, 'Dragon Ball tweet not found');

      const pm = tw.parsed_media;
      assert(pm, 'parsed_media missing');

      const items = pm.media_items || [];
      assert(items.length >= 1, 'expected at least 1 media_item');

      const main = items.find((i) =>
        (i.title || '').toLowerCase().includes('dragon ball')
      );
      assert(main, 'expected a Dragon Ball media item');

      assert(
        Array.isArray(main.associated_urls) &&
          main.associated_urls.length >= 1,
        'Dragon Ball should have at least 1 associated URL'
      );
    }, data)
  );

  // 2) "A collection – 29 films (218 GB)" → 1 item, 3 URLs, none unassociated
  results.push(
    runCase('Chungking: 29-film collection has all 3 URLs', (data, assert) => {
      const tw = findTweetByText(data, '29 films (218 gb)');
      assert(tw, 'Chungking collection tweet not found');

      const pm = tw.parsed_media;
      const items = pm.media_items || [];
      assert.strictEqual(items.length, 1, 'expected exactly 1 media item');

      const item = items[0];
      assert(
        /collection/i.test(item.title),
        'expected title to contain "collection"'
      );

      assert(
        Array.isArray(item.associated_urls) &&
          item.associated_urls.length === 3,
        `expected 3 URLs on collection, got ${item.associated_urls.length}`
      );
      assert.strictEqual(
        (pm.unassociated_urls || []).length,
        0,
        'expected no unassociated URLs for Chungking collection'
      );
    }, data)
  );

  // 3) Rosemberg: drive + vk should both be attached to single item
  results.push(
    runCase('Rosemberg: drive + vk both associated', (data, assert) => {
      const tw = findTweetByText(
        data,
        'Luiz Rosemberg Filho - Complete Filmography'
      );
      assert(tw, 'Rosemberg tweet not found');

      const pm = tw.parsed_media;
      const items = pm.media_items || [];
      assert(items.length >= 1, 'expected at least 1 media item');

      const item = items[0];
      assert(
        /rosemberg/i.test(item.title),
        'expected title to mention Rosemberg'
      );

      const urls = item.associated_urls || [];
      assert(
        urls.some((u) => u.includes('drive.google.com')),
        'expected a drive.google.com URL'
      );
      assert(
        urls.some((u) => u.includes('vkvideo.ru')),
        'expected a vkvideo.ru URL'
      );

      assert.strictEqual(
        (pm.unassociated_urls || []).length,
        0,
        'expected no unassociated URLs for Rosemberg'
      );
    }, data)
  );

  // 4) The Man from London: at least one film item with a URL
  results.push(
    runCase('The Man from London: film has URL', (data, assert) => {
      const tw = findTweetByText(data, 'THE MAN FROM LONDON');
      assert(tw, 'Man from London tweet not found');

      const pm = tw.parsed_media;
      const items = pm.media_items || [];
      const film = items.find((i) =>
        (i.title || '').toLowerCase().includes('man from london')
      );
      assert(film, 'expected a Man from London media item');

      assert(
        Array.isArray(film.associated_urls) &&
          film.associated_urls.length >= 1,
        'Man from London film should have at least one URL'
      );
    }, data)
  );

  // 5) Gantz collection: main collection got the transfer.it link
  results.push(
    runCase('Gantz: collection has transfer.it URL', (data, assert) => {
      const tw = findTweetByText(data, 'Gantz Collection');
      assert(tw, 'Gantz collection tweet not found');

      const pm = tw.parsed_media;
      const items = pm.media_items || [];
      const col = items.find((i) =>
        /gantz collection/i.test(i.title || '')
      );
      assert(col, 'expected a "Gantz Collection" item');

      const urls = col.associated_urls || [];
      assert(
        urls.some((u) => u.includes('transfer.it')),
        'expected Gantz collection to have a transfer.it URL'
      );
    }, data)
  );

  // 6) Favorite first watches of October → pure interest; no download URLs
  results.push(
    runCase('Favorite first watches: treated as interest', (data, assert) => {
      const tw = findTweetByText(
        data,
        'Favorite first watches of October'
      );
      assert(tw, 'favorite first watches tweet not found');

      const pm = tw.parsed_media;
      const mediaItems = pm.media_items || [];
      const interestItems = pm.media_interest_items || [];

      // no downloads expected
      assert(
        mediaItems.every(
          (i) => !i.associated_urls || i.associated_urls.length === 0
        ),
        'did not expect any download URLs for first-watches tweet'
      );

      assert(
        interestItems.length >= 1,
        'expected at least one media_interest_item'
      );

      // ideally we have a collection of the 4 films
      const collection = interestItems.find(
        (i) =>
          i.isCollection &&
          Array.isArray(i.items_included) &&
          i.items_included.length >= 4
      );
      assert(
        collection,
        'expected a collection representing the October watches'
      );
    }, data)
  );

  // 7) The Witches (1990) behind-the-scenes → interest, no downloads
  results.push(
    runCase('The Witches (1990): interest, no URLs', (data, assert) => {
      const tw = findTweetByText(data, 'The Witches (1990)');
      assert(tw, 'The Witches tweet not found');

      const pm = tw.parsed_media;
      assert.strictEqual(
        (pm.media_items || []).length,
        0,
        'expected 0 media_items for Witches'
      );
      assert(
        (pm.media_interest_items || []).some(
          (i) =>
            i.title &&
            i.title.toLowerCase().includes('the witches') &&
            i.year === '1990'
        ),
        'expected an interest item for The Witches (1990)'
      );
    }, data)
  );

  // 8) Dark Knight Trilogy → collection with URL
  results.push(
    runCase('Dark Knight Trilogy: collection with URL', (data, assert) => {
      const tw = findTweetByText(
        data,
        'The Dark Knight Trilogy (2005-2012)'
      );
      assert(tw, 'Dark Knight trilogy tweet not found');

      const pm = tw.parsed_media;
      const items = pm.media_items || [];

      const collection = items.find(
        (i) =>
          i.isCollection &&
          (i.title || '').toLowerCase().includes('dark knight trilogy')
      );
      assert(collection, 'expected a Dark Knight Trilogy collection item');

      assert(
        Array.isArray(collection.associated_urls) &&
          collection.associated_urls.length >= 1,
        'collection should have at least one URL'
      );
    }, data)
  );

  // 9) Ballerina (2025) → one film with URL
  results.push(
    runCase('Ballerina (2025): one film with URL', (data, assert) => {
      const tw = findTweetByText(data, 'Ballerina (2025)');
      assert(tw, 'Ballerina tweet not found');

      const pm = tw.parsed_media;
      const items = pm.media_items || [];
      const ballerina = items.find(
        (i) =>
          (i.title || '').toLowerCase().includes('ballerina') &&
          i.year === '2025'
      );
      assert(ballerina, 'expected Ballerina (2025) item');

      assert(
        Array.isArray(ballerina.associated_urls) &&
          ballerina.associated_urls.length >= 1,
        'Ballerina should have at least one URL'
      );

      // sanity: no junk-only titles like "4K UHD Remux (72.84GB)"
      const junk = items.find((i) =>
        (i.title || '').toLowerCase().startsWith('4k ')
      );
      assert(!junk, 'did not expect a "4k ..." only title as separate item');
    }, data)
  );

  // 10) Peter Jackson’s King Kong game → game with URL
  results.push(
    runCase('King Kong game: identified as game with URL', (data, assert) => {
      const tw = findTweetByText(
        data,
        "PETER JACKSON'S KING KONG: THE OFFICIAL GAME"
      );
      assert(tw, 'King Kong tweet not found');

      const pm = tw.parsed_media;
      const items = pm.media_items || [];
      const game = items.find((i) =>
        (i.title || '')
          .toLowerCase()
          .includes("peter jackson's king kong")
      );
      assert(game, 'expected King Kong game item');

      assert(
        Array.isArray(game.associated_urls) &&
          game.associated_urls.length >= 1,
        'King Kong game should have at least one URL'
      );

      assert.strictEqual(
        game.type,
        'game',
        `expected King Kong type "game", got ${game.type}`
      );
    }, data)
  );

  // summary
  const failed = results.filter((r) => !r.passed);
  console.log('\nQA summary:');
  console.log(`  total cases:   ${results.length}`);
  console.log(`  passed:        ${results.length - failed.length}`);
  console.log(`  failed:        ${failed.length}`);

  if (failed.length) process.exit(1);
}

main();