suite('scheduler (rerun)', function() {
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

  test("Rerun in task-graph (finishes)", function() {
    // Make task graph
    var taskGraph = makeTaskGraph();

    // Listen for taskGraph to become running
    var binding = subject.schedulerEvents.taskGraphRunning({
      taskGraphId:    taskGraphId
    });
    var taskGraphRunning = subject.listenFor(binding);

    // Listen for taskA to become pending
    var taskPending = subject.listenFor(subject.queueEvents.taskPending({
      taskId:   taskId
    }));

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

    // Wait till we're listening
    return Promise.all([
      taskGraphRunning.ready,
      taskPending.ready,
      taskGraphFinished.ready
    ]).then(function() {
      // Submit taskgraph to scheduler
      debug("### Posting task-graph");
      return subject.scheduler.createTaskGraph(
        taskGraphId,
        taskGraph
      );
    }).then(function(result) {
      assert(result.status.taskGraphId === taskGraphId,
             "Didn't get taskGraphId");

      debug("### Waiting task-graph running and task pending");
      // Wait for messages that we are expecting
      return Promise.all([taskGraphRunning.message, taskPending.message]);
    }).then(function() {
      // Claim task
      debug("### Claim task");
      return subject.queue.claimTask(taskId, 0, {
        workerGroup:  'dummy-test-workergroup',
        workerId:     'dummy-test-worker-id'
      });
    }).then(function() {
      return helper.sleep(500);
    }).then(function() {
      // Listen for task to become pending again
      taskPending = subject.listenFor(subject.queueEvents.taskPending({
        taskId:   taskId
      }));
      return taskPending.ready.then(function() {
        debug("### Report task failed");
        return subject.queue.reportFailed(taskId, 0).then(function() {
          debug("### Wait for task to become pending again");
          return taskPending.message;
        });
      });
    }).then(function() {
      // Claim task
      debug("### Claim task (again)");
      return subject.queue.claimTask(taskId, 1, {
        workerGroup:  'dummy-test-workergroup',
        workerId:     'dummy-test-worker-id'
      });
    }).then(function() {
      return helper.sleep(500);
    }).then(function() {
      taskGraphCanFinishNow = true;
      debug("### Report task completed (successfully)");
      return subject.queue.reportCompleted(taskId, 1);
    }).then(function() {
      debug("### Waiting for task-graph to be finished");
      return taskGraphFinished.message;
    });
  });


  test("Rerun in task-graph (blocks)", function() {
    // Make task graph
    var taskGraph = makeTaskGraph();

    // Listen for taskGraph to become running
    var binding = subject.schedulerEvents.taskGraphRunning({
      taskGraphId:    taskGraphId
    });
    var taskGraphRunning = subject.listenFor(binding);

    // Listen for taskA to become pending
    var taskPending = subject.listenFor(subject.queueEvents.taskPending({
      taskId:   taskId
    }));

    // Listen for taskGraph to be blocked
    var taskGraphCanBlockNow = false;
    var binding = subject.schedulerEvents.taskGraphBlocked({
      taskGraphId:    taskGraphId
    });
    var taskGraphBlocked = subject.listenFor(binding);
    taskGraphBlocked.message = taskGraphBlocked.message.then(function() {
      // Check that we're not completed too soon
      assert(taskGraphCanBlockNow, "taskGraph blocked too soon!!!");
    });

    // Wait till we're listening
    return Promise.all([
      taskGraphRunning.ready,
      taskPending.ready,
      taskGraphBlocked.ready
    ]).then(function() {
      // Submit taskgraph to scheduler
      debug("### Posting task-graph");
      return subject.scheduler.createTaskGraph(
        taskGraphId,
        taskGraph
      );
    }).then(function(result) {
      assert(result.status.taskGraphId === taskGraphId,
             "Didn't get taskGraphId");

      debug("### Waiting task-graph running and task pending");
      // Wait for messages that we are expecting
      return Promise.all([taskGraphRunning.message, taskPending.message]);
    }).then(function() {
      // Claim task
      debug("### Claim task");
      return subject.queue.claimTask(taskId, 0, {
        workerGroup:  'dummy-test-workergroup',
        workerId:     'dummy-test-worker-id'
      });
    }).then(function() {
      return helper.sleep(500);
    }).then(function() {
      // Listen for task to become pending again
      taskPending = subject.listenFor(subject.queueEvents.taskPending({
        taskId:   taskId
      }));
      return taskPending.ready.then(function() {
        debug("### Report task failed");
        return subject.queue.reportFailed(taskId, 0).then(function() {
          debug("### Wait for task to become pending again");
          return taskPending.message;
        });
      });
    }).then(function() {
      // Claim task
      debug("### Claim task (again)");
      return subject.queue.claimTask(taskId, 1, {
        workerGroup:  'dummy-test-workergroup',
        workerId:     'dummy-test-worker-id'
      });
    }).then(function() {
      return helper.sleep(500);
    }).then(function() {
      taskGraphCanBlockNow = true;
      debug("### Report task failed");
      return subject.queue.reportFailed(taskId, 1);
    }).then(function() {
      debug("### Waiting for task-graph to be blocked");
      return taskGraphBlocked.message;
    });
  });
});
