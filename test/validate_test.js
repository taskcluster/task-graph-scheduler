var base        = require('taskcluster-base');
var path        = require('path');

suite('validate', function() {
  // Run test cases using schemas testing utility from taskcluster-base
  base.testing.schemas({
    validator: {
      folder:       path.join(__dirname, '..', 'schemas'),
      constants:    require('../schemas/constants'),
      preload: [
        'http://schemas.taskcluster.net/queue/v1/task.json'
      ]
    },
    basePath:       path.join(__dirname, 'validate_test'),
    schemaPrefix:   'http://schemas.taskcluster.net/',
    cases: [
      {
        schema:   'scheduler/v1/task-graph.json#',
        path:     'task-graph-example.json',
        success:  true,
      }, {
        schema:   'scheduler/v1/task-graph.json#',
        path:     'invalid-task-graph-example.json',
        success:  false,
      }
    ]
  });
});
