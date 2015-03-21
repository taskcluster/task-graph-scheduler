suite('scheduler (extend)', function() {
  var Promise     = require('promise');
  var assert      = require('assert');
  var debug       = require('debug')('scheduler:test:scheduler_test');
  var slugid      = require('slugid');
  var _           = require('lodash');
  var helper      = require('./helper');
  var subject     = helper.setup({title: "extend task-graph"});

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
      "routes":                 [],
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
              "name":           "Print `'Hello World'` Once",
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
              "name":           "Print `'Hello World'` Again",
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

  test("Schedule a task-graph and extend task-graph", function() {
    // Make task graph
    var taskGraph = makeTaskGraph();

    // Remove taskB for submission as extension
    var taskB = taskGraph.tasks.pop();

    // Submit taskgraph to scheduler
    debug("### Posting task-graph");
    return subject.scheduler.createTaskGraph(
      taskGraphId,
      taskGraph
    ).then(function() {
      return subject.scheduler.inspect(taskGraphId);
    }).then(function(result) {
      assert(result.status.taskGraphId == taskGraphId,  "got taskGraphId");
      assert(result.tags.MyTestTag == "Hello World",    "Got tag");
      assert(result.status.state == 'running',          "got right state");
      assert(result.tasks.length == 1,                  "got task");

      // Extend the task-graph
      return subject.scheduler.extendTaskGraph(taskGraphId, {
        tasks: [taskB]
      });
    }).then(function() {
      return subject.scheduler.inspect(taskGraphId);
    }).then(function(result) {
      assert(result.status.taskGraphId == taskGraphId,  "got taskGraphId");
      assert(result.tags.MyTestTag == "Hello World",    "Got tag");
      assert(result.status.state == 'running',          "got right state");
      assert(result.tasks.length == 2,                  "got tasks");
    });
  });

  test("Schedule and extend task-graph (idempotent)", function() {
    // Make task graph
    var taskGraph = makeTaskGraph();

    // Remove taskB for submission as extension
    var taskB = taskGraph.tasks.pop();

    // Listen for taskB to become pending
    var taskBCanBeScheduled = false;
    var taskBPending = subject.listenFor(subject.queueEvents.taskPending({
      taskId:   taskIdB
    }));
    taskBPending.message = taskBPending.message.then(function(message) {
      // Check that we're not scheduling taskB too soon
      assert(taskBCanBeScheduled, "taskB was scheduled too soon!!!");
    });

    // Listen for taskGraph to be finished
    var taskGraphCanFinishNow = false;
    var binding = subject.schedulerEvents.taskGraphFinished({
      taskGraphId:    taskGraphId
    });
    var taskGraphFinished = subject.listenFor(binding);
    taskGraphFinished.message = taskGraphFinished.message.then(function() {
      // Check that we're not completed too soon
      assert(taskGraphCanFinishNow, "taskGraph finished too soon!!!");
    });

    // Submit taskgraph to scheduler
    debug("### Posting task-graph");
    return subject.scheduler.createTaskGraph(
      taskGraphId,
      taskGraph
    ).then(function() {
      return subject.scheduler.inspect(taskGraphId);
    }).then(function(result) {
      assert(result.status.taskGraphId == taskGraphId,  "got taskGraphId");
      assert(result.tags.MyTestTag == "Hello World",    "Got tag");
      assert(result.status.state == 'running',          "got right state");
      assert(result.tasks.length == 1,                  "got task");

      debug("Extend the task-graph");
      return subject.scheduler.extendTaskGraph(taskGraphId, {
        tasks: [taskB]
      }).then(function() {
        debug("Extend the task-graph again");
        return subject.scheduler.extendTaskGraph(taskGraphId, {
          tasks: [taskB]
        });
      });
    }).then(function() {
      return subject.scheduler.inspect(taskGraphId);
    }).then(function(result) {
      assert(result.status.taskGraphId == taskGraphId,  "got taskGraphId");
      assert(result.tags.MyTestTag == "Hello World",    "Got tag");
      assert(result.status.state == 'running',          "got right state");
      assert(result.tasks.length == 2,                  "got tasks");
    }).then(function() {
      debug("### Claim task A");
      return subject.queue.claimTask(taskIdA, 0, {
        workerGroup:  'dummy-test-workergroup',
        workerId:     'dummy-test-worker-id'
      });
    }).then(function() {
      return taskBPending.ready;
    }).then(function() {
      debug("### Report task A completed");
      taskBCanBeScheduled = true;
      return subject.queue.reportCompleted(taskIdA, 0, {
        success: true
      });
    }).then(function() {
      debug("### Waiting for taskB to become pending");
      return taskBPending.message;
    }).then(function() {
      debug("### Claim task B");
      return subject.queue.claimTask(taskIdB, 0, {
        workerGroup:  'dummy-test-workergroup',
        workerId:     'dummy-test-worker-id'
      });
    }).then(function() {
      return taskGraphFinished.ready;
    }).then(function() {
      taskGraphCanFinishNow = true;
      return subject.queue.reportCompleted(taskIdB, 0, {
        success: true
      });
    }).then(function() {
      debug("### Waiting for task-graph to be finished");
      return taskGraphFinished.message;
    }).then(function() {
      return subject.scheduler.inspect(taskGraphId);
    }).then(function(result) {
      assert(result.status.taskGraphId == taskGraphId,  "got taskGraphId");
      assert(result.tags.MyTestTag == "Hello World",    "Got tag");
      assert(result.status.state == 'finished',         "got right state");
      assert(result.tasks.length == 2,                  "got tasks");
    });
  });
});
