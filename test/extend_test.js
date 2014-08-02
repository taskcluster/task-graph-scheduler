suite('scheduler (extend)', function() {
  var Promise     = require('promise');
  var assert      = require('assert');
  var debug       = require('debug')('scheduler:test:scheduler_test');
  var helper      = require('./helper');
  var slugid      = require('slugid');
  var _           = require('lodash');
  var helper      = require('./helper');
  var subject     = helper.setup({title: "extend task-graph"});

  // Create datetime for created and deadline as 25 minutes later
  var created = new Date();
  var deadline = new Date();
  deadline.setMinutes(deadline.getMinutes() + 25);

  // Hold reference to taskIds
  var taskIdA = null;
  var taskIdB = null;

  // Task graph that'll post in this test
  var makeTaskGraph = function() {
    // Find task ids for A and B
    taskIdA = slugid.v4();
    taskIdB = slugid.v4();
    return {
      "scopes": [
        "queue:post:define-task:dummy-test-provisioner/dummy-test-worker-type"
      ],
      "routing":                "",
      "tasks": [
        {
          "taskId":             taskIdA,
          "requires":           [],
          "reruns":             0,
          "task": {
            "provisionerId":    "dummy-test-provisioner",
            "workerType":       "dummy-test-worker-type",
            "scopes":           [],
            "routing":          "",
            "retries":          3,
            "priority":         5,
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
            "scopes":           [],
            "routing":          "",
            "retries":          3,
            "priority":         5,
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
    this.timeout(120 * 1000);

    // Make task graph
    var taskGraph = makeTaskGraph();

    // Remove taskB for submission as extension
    var taskB = taskGraph.tasks.pop();

    // Submit taskgraph to scheduler
    var taskGraphId = slugid.v4();
    debug("### Posting task-graph");
    return subject.scheduler.createTaskGraph(
      taskGraphId,
      taskGraph
    ).then(function() {
      return subject.scheduler.inspectTaskGraph(taskGraphId);
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
      return subject.scheduler.inspectTaskGraph(taskGraphId);
    }).then(function(result) {
      assert(result.status.taskGraphId == taskGraphId,  "got taskGraphId");
      assert(result.tags.MyTestTag == "Hello World",    "Got tag");
      assert(result.status.state == 'running',          "got right state");
      assert(result.tasks.length == 2,                  "got tasks");
    });
  });
});
