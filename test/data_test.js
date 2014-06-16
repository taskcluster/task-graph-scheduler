var slugid    = require('slugid');
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
      routing:            "",
      details: {
        metadata: {
          name:         "Validation Test TaskGraph",
          owner:        "root@localhost.local",
          source:       "http://github.com/taskcluster/task-graph-scheduler"
        },
        tags: {
          "MyTestTag":  "Hello World"
        }
      }
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


exports.TestTasks = function(test){
  test.expect(7);

  // Generate taskGraphId and taskId
  var taskGraphId = slugid.v4();
  var taskId      = slugid.v4();

  // Ensure that the task table is created
  var table_created = data.ensureTable(data.Task);

  // Create a test task
  var task_created = table_created.then(function() {
    return data.Task.create({
      taskGraphId:      taskGraphId,
      taskId:           taskId,
      version:          '0.2.0',
      label:            'mytask',
      rerunsAllowed:    2,
      rerunsLeft:       2,
      deadline:         new Date(),
      requires:         [],
      requiresLeft:     [],
      dependents:       [],
      resolution:       null
    });
  });

  // Check task creation
  var task1 = null;
  var task_creation_checked = task_created.then(function(task) {
    task1 = task;
    test.ok(task != null, "Created a task");
    test.ok(task.taskId == taskId, "Check taskId");
  });

  // Reload task
  var task_reloaded = task_creation_checked.then(function() {
    return data.Task.load(taskGraphId, taskId);
  });

  // Check reloading was okay
  var task2 = null;
  var task_reloaded_check = task_reloaded.then(function(task) {
    task2 = task;
    test.ok(task2 != null, "Created a task");
    test.ok(task2.taskId == taskId, "Check taskId");
  });

  // Load task parition
  var loaded_partition = task_reloaded_check.then(function() {
    return data.Task.loadPartition(taskGraphId);
  });

  // Check the partition was loaded correctly
  var checked_partition = loaded_partition.then(function(tasks) {
    test.ok(tasks.length == 1, "Got one task");
    test.ok(tasks[0].taskGraphId == taskGraphId, "Got right taskId");
    test.ok(tasks[0].taskId == taskId, "Got right taskId");
  });

  // Check that we didn't get any errors
  checked_partition.catch(function(err) {
    debug("Failed with error: ", err);
    test.ok(false);
  }).then(function() {
    test.done();
  });
};

