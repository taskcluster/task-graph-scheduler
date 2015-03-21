suite('scheduler (createTaskGraph is idempotent)', function() {
  var Promise     = require('promise');
  var assert      = require('assert');
  var debug       = require('debug')('scheduler:test:rerun_test');
  var slugid      = require('slugid');
  var _           = require('lodash');
  var helper      = require('./helper');
  var subject     = helper.setup({title: "rerun"});

  // Create datetime for created and deadline as 25 minutes later
  var created = new Date();
  var deadline = new Date();
  deadline.setMinutes(deadline.getMinutes() + 25);

  // Hold reference to taskId
  var taskGraphId = null;
  var taskId = null;

  // Task graph that'll post in this test
  var makeTaskGraph = function() {
    // Find task id
    taskGraphId = slugid.v4();
    taskId = slugid.v4();
    return {
      "scopes": [
        "queue:define-task:dummy-test-provisioner/dummy-test-worker-type"
      ],
      "routes":           [],
      "tasks": [
        {
          "taskId":             taskId,
          "requires":           [],
          "reruns":             1,
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

  test("TaskGraph creation is idempotent", function() {
    // Make task graph
    var taskGraph = makeTaskGraph();

    debug("### Posting task-graph");
    return subject.scheduler.createTaskGraph(
      taskGraphId,
      taskGraph
    ).then(function() {
      debug("### Posting task-graph (again)");
      return subject.scheduler.createTaskGraph(
        taskGraphId,
        taskGraph
      );
    });
  });
});
