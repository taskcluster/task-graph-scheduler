#!/bin/bash -ve
# USAGE: Run this file using `npm test` (must run from repository root)

# Run tests
mocha                               \
  test/data_test.js                 \
  test/validate_test.js             \
  test/scheduler_test.js            \
  test/inspect_test.js              \
  test/rerun_test.js                \
  test/extend_test.js               \
  ;
