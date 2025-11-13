// src/textProcessor.js
class TextProcessor {
    constructor(config) {
        this.config = config;
    }

    unifyText(mainText, quotedText) {
        let unified = mainText || '';
        if (quotedText) {
            unified += '\n---QUOTED TWEET---\n' + quotedText;
        }
        return unified;
    }

    normalize(text) {
        // lowercase for matching
        let normalized = text.toLowerCase();

        // fix URLs split by line breaks FIRST
        normalized = normalized.replace(/(https?:\/\/)\s*\n\s*/gi, '$1');

        // clean fancy unicode quotes
        normalized = normalized
            .replace(/[""]/g, '"')
            .replace(/['']/g, "'");

        // normalize whitespace (but preserve structure)
        normalized = normalized.replace(/\r\n/g, '\n');
        normalized = normalized.replace(/[ \t]+/g, ' ');

        return normalized;
    }

    splitIntoBlocks(text) {
        // try each delimiter in order
        for (const delimiter of this.config.block_delimiters) {
            const blocks = text.split(delimiter)
                .map(b => b.trim())
                .filter(b => b.length > 0);

            // if we got meaningful blocks, use them
            if (blocks.length > 1) {
                return blocks;
            }
        }

        // fallback: treat entire text as one block
        return [text];
    }
}

module.exports = TextProcessor;