/**
 * tests/test_helpers.js
 * Unified source loader supporting both monolithic and modular Clean Architecture renderers.
 */
const fs = require('fs');
const path = require('path');

function readCompleteHtml(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const dir = path.dirname(filePath);

  // Inline CSS files referenced via <link rel="stylesheet" href="...">
  content = content.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)">/g, (match, relHref) => {
    const cssPath = path.join(dir, relHref);
    if (fs.existsSync(cssPath)) {
      return `<style>\n${fs.readFileSync(cssPath, 'utf8')}\n</style>`;
    }
    return match;
  });

  // Inline JS files referenced via <script src="..."></script>
  content = content.replace(/<script\s+src="([^"]+)"><\/script>/g, (match, relSrc) => {
    const jsPath = path.join(dir, relSrc);
    if (fs.existsSync(jsPath)) {
      return `<script>\n${fs.readFileSync(jsPath, 'utf8')}\n</script>`;
    }
    return match;
  });

  return content;
}

module.exports = { readCompleteHtml };
