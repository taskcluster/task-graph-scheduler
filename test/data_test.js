suite('data', function() {
  var assert  = require('assert');
  var slugid  = require('slugid');
  var _       = require('lodash');
  var Promise = require('promise');
  var data    = require('../scheduler/data');
  var base    = require('taskcluster-base');
  var debug   = require('debug')('scheduler:test:data_test');

  // Load test configuration
  var cfg = base.config({
    defaults:     require('../config/defaults'),
    profile:      require('../config/testing'),
    envs: [
      'azureTable_accountUrl',
      'azureTable_accountName',
      'azureTable_accountKey'
    ],
    filename:               'task-graph-scheduler'
  });

  // Check that we have configuration or abort
  if (!cfg.get('scheduler:taskGraphTableName') || !cfg.get('azureTable')) {
    console.log("\nWARNING:");
    console.log("Skipping 'enity' tests, missing config file: " +
                "task-graph-scheduler.conf.json");
    return;
  }

  // Configure Task and TaskGraph entities
  var Task = data.Task.configure({
    schedulerId:      cfg.get('scheduler:schedulerId'),
    tableName:        cfg.get('scheduler:taskGraphTableName'),
    credentials:      cfg.get('azureTable')
  });
  var TaskGraph = data.TaskGraph.configure({
    schedulerId:      cfg.get('scheduler:schedulerId'),
    tableName:        cfg.get('scheduler:taskGraphTableName'),
    credentials:      cfg.get('azureTable')
  });

  // Test that Task.loadGraphTasks works, every thing else is testing base
  test('Task.loadGraphTasks', function() {
    var taskGraphId = slugid.v4();

    return Promise.all(
      Task.createTable(),
      TaskGraph.createTable()
    ).then(function() {
      // Create taskGraph
      var tgCreated = TaskGraph.create({
        taskGraphId:        taskGraphId,
        version:            '0.2.0',
        requires:           [],
        requiresLeft:       [],
        state:              'finished',
        routing:            '',
        details: {
          metadata:         {},
          tags:             {},
          params:           {}
        }
      });

      // Create task A
      var taCreated = Task.create({
        taskGraphId:      taskGraphId,
        taskId:           slugid.v4(),
        version:          '0.2.0',
        label:            'taskA',
        rerunsAllowed:    1,
        rerunsLeft:       1,
        deadline:         new Date(),
        requires:         [],
        requiresLeft:     [],
        dependents:       [],
        resolution:       null
      });

      // Create task B
      var tbCreated = Task.create({
        taskGraphId:      taskGraphId,
        taskId:           slugid.v4(),
        version:          '0.2.0',
        label:            'taskB',
        rerunsAllowed:    1,
        rerunsLeft:       1,
        deadline:         new Date(),
        requires:         [],
        requiresLeft:     [],
        dependents:       [],
        resolution:       null
      });

      // When all is created, test that we load only two (taskA and taskB) using
      // loadGraphTasks
      return Promise.all(
        tgCreated,
        taCreated,
        tbCreated
      ).then(function() {
        return Task.loadGraphTasks(taskGraphId);
      }).then(function(tasks) {
        assert(tasks.length === 2, "Expected two tasks in the task-graph");
        assert(tasks[0].label !== tasks[1].label, "Matching labels, how?");
        assert(tasks[0].label === 'taskA' || tasks[0].label === 'taskB',
               "Expected taskA or taskB");
        assert(tasks[1].label === 'taskA' || tasks[1].label === 'taskB',
               "Expected taskA or taskB");
      }).catch(function(err) {
        debug("Error: %s, %j", err, err);
        throw err;
      });
    });
  });
});