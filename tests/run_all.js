/**
 * tests/run_all.js
 * Master E2E Test Suite Runner for LUMEN PRO
 *
 * 5-Tier Test Architecture (98 Tests Total):
 * - Tier 1: Feature Coverage (>=5 test cases per feature across R1-R4) - 33 tests
 * - Tier 2: Boundary & Corner Cases (>=5 test cases per feature across R1-R4) - 28 tests
 * - Tier 3: Cross-Feature Combinations (pairwise interactions across R1-R4) - 12 tests
 * - Tier 4: Real-World Application Scenarios (>=5 realistic live event workflows) - 5 tests
 * - Tier 5: Audio-Visual Event Controller E2E Suite (20 tests across 7 categories) - 20 tests
 *
 * Supported execution commands:
 * - node --test tests/run_all.js
 * - node tests/run_all.js
 * - npm test
 */

require('./tier1_features.test.js');
require('./tier2_boundaries.test.js');
require('./tier3_combinations.test.js');
require('./tier4_realworld.test.js');
require('./tier5_audio_event.test.js');

const { after } = require('node:test');
after(() => {
  setImmediate(() => {
    process.exit(0);
  });
});

