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

  // Hold reference to taskGraphId
  var taskGraphId = null;
  var taskIdA;
  var taskIdB;
  var taskIdC;

  // Task graph that'll post in this test
  var makeTaskGraph = function() {
    // Find task id
    taskGraphId = slugid.v4();
    taskIdA = slugid.v4();
    taskIdB = slugid.v4();
    taskIdC = slugid.v4();
    return {
      "scopes": [
        "queue:define-task:dummy-test-provisioner/dummy-test-worker-type"
      ],
      "routes":           [],
      "tasks": [
        {
          "taskId":             taskIdA,
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
        }, {
          "taskId":             taskIdB,
          "requires":           [taskIdA],
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
        }, {
          "taskId":             taskIdC,
          "requires":           [taskIdA, taskIdB],
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

  test("extendTaskGraph idempotent", function() {
    // Make task graph
    var taskGraph = makeTaskGraph();

    // Remove taskB and taskC for submission as extension
    var taskB = taskGraph.tasks.pop();
    var taskC = taskGraph.tasks.pop();

    var taskAPending = subject.listenFor(subject.queueEvents.taskPending({
      taskId:   taskIdA
    }));
    var taskBPending = subject.listenFor(subject.queueEvents.taskPending({
      taskId:   taskIdB
    }));
    var taskCPending = subject.listenFor(subject.queueEvents.taskPending({
      taskId:   taskIdC
    }));
    var binding = subject.schedulerEvents.taskGraphFinished({
      taskGraphId:    taskGraphId
    });
    var taskGraphCanFinishNow = false;
    var taskGraphFinished = subject.listenFor(binding);
    taskGraphFinished.message = taskGraphFinished.message.then(function() {
      // Check that we're not completed too soon
      assert(taskGraphCanFinishNow, "taskGraph finished too soon!!!");
    });

    return Promise.all([
      taskAPending.ready,
      taskBPending.ready,
      taskCPending.ready,
      taskGraphFinished.ready
    ]).then(function() {
      debug("### Posting task-graph");
      return subject.scheduler.createTaskGraph(
        taskGraphId,
        taskGraph
      );
    }).then(function() {
      debug("### Posting task-graph (again)");
      return subject.scheduler.createTaskGraph(
        taskGraphId,
        taskGraph
      );
    }).then(function() {
      debug("### Extend task-graph");
      return subject.scheduler.extendTaskGraph(taskGraphId, {
        tasks: [taskB, taskC]
      });
    }).then(function() {
      debug("### Extend task-graph (again)");
      return subject.scheduler.extendTaskGraph(taskGraphId, {
        tasks: [taskB, taskC]
      });
    }).then(function() {
      debug("Wait for TaskA to be pending, claim and reportCompleted");
      return taskAPending.message.then(function() {
        return subject.queue.claimTask(taskIdA, 0, {
          workerGroup:  'dummy-test-workergroup',
          workerId:     'dummy-test-worker-id'
        });
      }).then(function() {
        return subject.queue.reportCompleted(taskIdA, 0);
      });
    }).then(function() {
      debug("Wait for TaskB to be pending, claim and reportCompleted");
      return taskBPending.message.then(function() {
        return subject.queue.claimTask(taskIdB, 0, {
          workerGroup:  'dummy-test-workergroup',
          workerId:     'dummy-test-worker-id'
        });
      }).then(function() {
        return subject.queue.reportCompleted(taskIdB, 0);
      });
    }).then(function() {
      debug("Wait for TaskC to be pending, claim and reportCompleted");
      return taskCPending.message.then(function() {
        return subject.queue.claimTask(taskIdC, 0, {
          workerGroup:  'dummy-test-workergroup',
          workerId:     'dummy-test-worker-id'
        });
      }).then(function() {
        taskGraphCanFinishNow = true;
        return subject.queue.reportCompleted(taskIdC, 0);
      });
    }).then(function() {
      debug("Wait for taskGraph to be finished");
      return taskGraphFinished.message;
    });
  });
});
