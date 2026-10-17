/**
 * tests/run_all.js
 * Master E2E Test Suite Runner for LUMEN PRO
 *
 * 4-Tier Test Architecture:
 * - Tier 1: Feature Coverage (>=5 test cases per feature across R1-R4)
 * - Tier 2: Boundary & Corner Cases (>=5 test cases per feature across R1-R4)
 * - Tier 3: Cross-Feature Combinations (pairwise interactions across R1-R4)
 * - Tier 4: Real-World Application Scenarios (>=5 realistic live event workflows)
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
