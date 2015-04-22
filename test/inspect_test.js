suite('scheduler (inspect)', function() {
  var Promise     = require('promise');
  var assert      = require('assert');
  var debug       = require('debug')('scheduler:test:scheduler_test');
  var slugid      = require('slugid');
  var _           = require('lodash');
  var helper      = require('./helper');
  var subject     = helper.setup({title: "inspect task-graph"});

  // Create datetime for created and deadline as 25 minutes later
  var created = new Date();
  var deadline = new Date();
  deadline.setMinutes(deadline.getMinutes() + 25);

  // Hold reference to taskIds
  var taskGraphId = null;
  var taskIdA = null;
  var taskIdB = null;

  // Task graph that'll post in this test
  var makeTaskGraph = function() {
    // Find task ids for A and B
    taskGraphId = slugid.v4();
    taskIdA = slugid.v4();
    taskIdB = slugid.v4();
    return {
      "scopes": [
        "queue:define-task:dummy-test-provisioner/dummy-test-worker-type"
      ],
      "routes":           [],
      "tasks": [
        {
          "taskId":             taskIdA,
          "requires":           [],
          "reruns":             0,
          "task": {
            "provisionerId":    "dummy-test-provisioner",
            "workerType":       "dummy-test-worker-type",
            "schedulerId":      "dummy-test-scheduler",
            "taskGroupId":      taskGraphId,
            "scopes":           [],
            "routes":           [],
            "retries":          3,
            "created":          created.toJSON(),
            "deadline":         deadline.toJSON(),
            "payload": {
              "desiredResolution":  "success"
            },
            "metadata": {
              "name":           "A: Print `'Hello World'` Once",
              "description":    "This task will prìnt `'Hello World'` **once**!",
              "owner":          "jojensen@mozilla.com",
              "source":         "https://github.com/taskcluster/task-graph-scheduler"
            },
            "tags": {
              "objective":      "Test task-graph scheduler"
            }
          }
        },
        {
          "taskId":             taskIdB,
          "requires":           [taskIdA],
          "reruns":             0,
          "task": {
            "provisionerId":    "dummy-test-provisioner",
            "workerType":       "dummy-test-worker-type",
            "schedulerId":      "dummy-test-scheduler",
            "taskGroupId":      taskGraphId,
            "scopes":           [],
            "routes":           [],
            "retries":          3,
            "created":          created.toJSON(),
            "deadline":         deadline.toJSON(),
            "payload": {
              "desiredResolution":  "success"
            },
            "metadata": {
              "name":           "B: Print `'Hello World'` Again",
              "description":    "This task will prìnt `'Hello World'` **again**! " +
                                "and wait for " + taskIdA + ".",
              "owner":          "jojensen@mozilla.com",
              "source":         "https://github.com/taskcluster/task-graph-scheduler"
            },
            "tags": {
              "objective":      "Test task-graph scheduler"
            }
          }
        }
      ],
      "metadata": {
        "name":         "Validation Test TaskGraph",
        "description":  "Task-graph description in markdown",
        "owner":        "root@localhost.local",
        "source":       "http://github.com/taskcluster/task-graph-scheduler"
      },
      "tags": {
        "MyTestTag": "Hello World"
      }
    }
  };

  test("Schedule a task-graph, run task and inspect", function() {
    // Make task graph
    var taskGraph = makeTaskGraph();

    // Listen for taskGraph to become running
    var binding = subject.schedulerEvents.taskGraphRunning({
      taskGraphId:    taskGraphId
    });
    var taskGraphRunning = subject.listenFor(binding);

    // Listen for taskA to become pending
    var taskAPending = subject.listenFor(subject.queueEvents.taskPending({
      taskId:   taskIdA
    }));

    // Listen for taskB to become pending
    var taskBCanBeScheduled = false;
    var taskBPending = subject.listenFor(subject.queueEvents.taskPending({
      taskId:   taskIdB
    }));
    taskBPending.message = taskBPending.message.then(function(message) {
      // Check that we're not scheduling taskB too soon
      assert(taskBCanBeScheduled, "taskB was scheduled too soon!!!");
    });

    // Start listening
    return Promise.all([
      taskGraphRunning.ready,
      taskAPending.ready,
      taskBPending.ready
    ]).then(function() {
      // Submit taskgraph to scheduler
      debug("### Posting task-graph");
      return subject.scheduler.createTaskGraph(taskGraphId, taskGraph);
    }).then(function(result) {
      assert(result.status.taskGraphId === taskGraphId,
             "Didn't get taskGraphId");

      debug("### Waiting task-graph running and taskA pending");
      // Wait for messages that we are expecting
      return Promise.all([
        taskGraphRunning.message,
        taskAPending.message
      ]);
    }).then(function() {
      return subject.scheduler.inspect(taskGraphId);
    }).then(function(result) {
      assert(result.status.taskGraphId == taskGraphId,  "got taskGraphId");
      assert(result.tags.MyTestTag == "Hello World",    "Got tag");
      assert(result.status.state == 'running',          "got right state");
      assert(result.tasks.length == 2,                  "got tasks");
      result.tasks.forEach(function(task) {
        if (task.taskId === taskIdA) {
          assert(task.state === 'scheduled', "expected taskA to be scheduled");
        }
        if (task.taskId === taskIdB) {
          assert(task.state === 'unscheduled',
                 "expected taskB to be unscheduled");
        }
      });
    }).then(function() {
      // Claim taskA
      debug("### Claim task A");
      return subject.queue.claimTask(taskIdA, 0, {
        workerGroup:  'dummy-test-workergroup',
        workerId:     'dummy-test-worker-id'
      });
    }).then(function() {
      return helper.sleep(500);
    }).then(function() {
      taskBCanBeScheduled = true;
      debug("### Report task A completed");
      return subject.queue.reportCompleted(taskIdA, 0);
    }).then(function() {
      debug("### Waiting for taskB to become pending");
      return taskBPending.message;
    }).then(function() {
      // Even when we have the pending message, it's not a given that the
      // handler have managed to save the task state in the task-graph.
      return helper.sleep(2000);
    }).then(function() {
      return subject.scheduler.status(taskGraphId);
    }).then(function(result) {
      assert(result.status.taskGraphId == taskGraphId,  "got taskGraphId");
      assert(result.status.state == 'running',          "got right state");
    }).then(function() {
      return subject.scheduler.info(taskGraphId);
    }).then(function(result) {
      assert(result.status.taskGraphId == taskGraphId,  "got taskGraphId");
      assert(result.tags.MyTestTag == "Hello World",    "Got tag");
      assert(result.status.state == 'running',          "got right state");
    }).then(function() {
      return subject.scheduler.inspect(taskGraphId);
    }).then(function(result) {
      assert(result.status.taskGraphId == taskGraphId,  "got taskGraphId");
      assert(result.tags.MyTestTag == "Hello World",    "Got tag");
      assert(result.status.state == 'running',          "got right state");
      assert(result.tasks.length == 2,                  "got tasks");
      result.tasks.forEach(function(task) {
        if (task.taskId === taskIdA) {
          debug("taskA: %j", task);
          assert(task.state === 'completed', "expected taskA to be completed");
        }
        if (task.taskId === taskIdB) {
          debug("taskB: %j", task);
          assert(task.state === 'scheduled', "expected taskB to be scheduled");
        }
      });
      return subject.scheduler.inspectTask(taskGraphId, taskIdA);
    }).then(function(task) {
      assert(task.taskId === taskIdA, "Expected taskIdA");
      assert(task.state === 'completed', "expected taskA to be completed");
    });
  });
});
