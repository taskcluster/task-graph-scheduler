#!/bin/bash -ve
# USAGE: Run this file using `npm test` (must run from repository root)

mocha                               \
  test/validate_test.js             \
  test/data_test.js                 \
  test/jsonsubs_test.js             \
  test/rerun_test.js                \
  test/scheduler_test.js            \
  ;
