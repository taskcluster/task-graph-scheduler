var slugid    = require('../utils/slugid');
var server    = require('../server');
var data      = require('../scheduler/data');
var debug     = require('debug')('test:data_test');
var Promise   = require('promise');
var _         = require('lodash');

exports.TestTaskGraph = function(test){
  test.expect(6);

  // Generate task graph id, do this top-level so we can reload and test that
  // entity exists
  var taskGraphId = slugid.v4();

  // Ensure that the taskGraph table is created
  var table_created = data.ensureTable(data.TaskGraph);

  // Create new TaskGraph
  var taskgraph_created = table_created.then(function() {
    debug("Creating TaskGraph entity");
    return data.TaskGraph.create({
      taskGraphId:        taskGraphId,
      version:            '0.2.0',
      requires:           ['task1', 'task2'],
      requiresLeft:       ['task1', 'task2'],
      params:             {},
      nameMapping: {
        SomeTaskLabel:    'SomeTaskId'
      },
      state:              'running',
      routing:            ""
    });
  });

  // Test that the created task graph instance has correct properties
  var taskGraph1 = null;
  var creation_tested = taskgraph_created.then(function(taskGraph) {
    debug("TaskGraph instance created");
    test.ok(taskGraph, "Created TaskGraph should be returned");
    test.ok(
      taskGraph.taskGraphId == taskGraphId,
      "Created taskGraph instance has different taskGraphId"
    );
    taskGraph1 = taskGraph;
  });

  // Reload the created task-graph
  var taskgraph_reloaded = creation_tested.then(function() {
    debug("Reload created TaskGraph entity");
    return data.TaskGraph.load(taskGraphId);
  });

  // Test that the reloaded task-graph has correct state and taskGraphId
  var taskGraph2 = null;
  var reloaded_taskgraph_tested = taskgraph_reloaded.then(function(taskGraph) {
    debug("TaskGraph entity reloaded");
    test.ok(
      taskGraph.taskGraphId == taskGraphId,
      "Reloaded TaskGraph id mismatch"
    );
    test.ok(taskGraph.state == 'running', "Wrong reloaded taskGraph state");
    taskGraph2 = taskGraph;
  });

  // When taskGraph1 and taskGraph2 is loaded, we modify them
  var reached_empty_list = false;
  var modify_taskgraphs = reloaded_taskgraph_tested.then(function() {
    debug("Modifying two different instances of the same taskGraphs entity");
    var modify_taskgraph1 = taskGraph1.modify(function() {
      debug("Applying modifier for taskGraph1, this.requiresLeft: ",
            this.requiresLeft);
      this.requiresLeft = _.without(this.requiresLeft, 'task1');
      if (this.requiresLeft.length == 0) {
        reached_empty_list = true;
      }
    });
    var modify_taskgraph2 = taskGraph2.modify(function() {
      debug("Applying modifier for taskGraph2, this.requiresLeft: ",
            this.requiresLeft);
      this.requiresLeft = _.without(this.requiresLeft, 'task2');
      if (this.requiresLeft.length == 0) {
        reached_empty_list = true;
      }
    });
    return Promise.all(modify_taskgraph1, modify_taskgraph2);
  });

  // Check that reached_empty_list is set, this should happen as taskGraph1
  // and taskGraph2 are modified concurrently... and both of them modifies
  // the same azure table entity
  var check_empty_list_reached = modify_taskgraphs.then(function () {
    debug("Checking reached_empty_list");
    test.ok(reached_empty_list, "We didn't reach an empty list");
  });

  // Check that tests didn't bail
  check_empty_list_reached.then(function() {
    test.ok(true, "Test didn't fail");
    test.done();
  }).catch(function(err) {
    debug("Test failed with err: %s, as JSON: %j", err, err, err.stack);
    test.ok(false, "Test failed");
    test.done();
  });
};

