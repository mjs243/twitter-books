// src/parserIndex.js
const MediaParser = require('./parser');
const path = require('path');
const fs = require('fs');

function showHelp() {
  console.log(`
Media Parser - Parse scraped tweets for media information

Usage:
  npm run parse <input.json> <output.json>
  node src/parserIndex.js <input.json> <output.json>
  
Options:
  --help, -h     Show this help message
  --config, -c   Specify custom config file (default: config/parser.config.json)
  
Examples:
  npm run parse scraped.json parsed.json
  npm run parse scraped.json parsed.json --config custom.json
  npm run test   (runs with test data)
  `);
}

async function main() {
  const args = process.argv.slice(2);
  
  // check for help flag
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    showHelp();
    process.exit(0);
  }
  
  // extract config path if provided
  let configPath = path.join(__dirname, '../config/parser.config.json');
  const configIndex = args.findIndex(arg => arg === '--config' || arg === '-c');
  if (configIndex !== -1 && args[configIndex + 1]) {
    configPath = args[configIndex + 1];
    // remove config args from array
    args.splice(configIndex, 2);
  }
  
  // validate input/output files
  if (args.length < 2) {
    console.error('❌ error: missing input or output file');
    showHelp();
    process.exit(1);
  }
  
  const [inputFile, outputFile] = args;
  
  // check if input file exists
  if (!fs.existsSync(inputFile)) {
    console.error(`❌ error: input file not found: ${inputFile}`);
    process.exit(1);
  }
  
  // ensure output directory exists
  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // initialize parser
  console.log('📄 loading config from:', configPath);
  const parser = new MediaParser(configPath);
  
  try {
    console.log('🔍 parsing tweets from:', inputFile);
    const result = await parser.parseFile(inputFile, outputFile);
    
    // show summary
    const totalMedia = result.tweets.reduce((sum, tweet) => 
      sum + (tweet.parsed_media?.media_items?.length || 0), 0
    );
    
    console.log(`✅ parsing complete!`);
    console.log(`   - tweets processed: ${result.tweets.length}`);
    console.log(`   - media items found: ${totalMedia}`);
    console.log(`   - output saved to: ${outputFile}`);
    
  } catch (error) {
    console.error('❌ parsing failed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  }
}

// run if called directly
if (require.main === module) {
  main();
}

module.exports = main;