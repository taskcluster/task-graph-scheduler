var config          = require('../config');
var LocalScheduler  = require('./localscheduler');
var debug           = require('debug')('tests:scheduler_test');
var request         = require('superagent-promise');
var Promise         = require('promise');
var nconf           = require('nconf');
var amqp            = require('amqp');
var Listener        = require('./listener');

config.load();

// Task graph that'll post in this test
var taskGraphExample = {
  "version":                "0.2.0",
  "params":                 {
    "test-worker-type":     "test-worker"
  },
  "routing":                "",
  "tasks": {
    "print-once": {
      "requires":           [],
      "reruns":             0,
      "task": {
        "version":          "0.2.0",
        "provisionerId":    "aws-provisioner",
        "workerType":       "{{test-worker-type}}",
        "routing":          "",
        "timeout":          600,
        "retries":          3,
        "priority":         5,
        "created":          "2014-03-01T22:19:32.124Z",
        "deadline":         "2060-03-01T22:19:32.124Z",
        "payload": {
          "image":          "ubuntu:latest",
          "command": [
            "/bin/bash", "-c",
            "echo 'Hello World'"
          ],
          "features": {
            "azureLivelog": true
          },
          "maxRunTime":     600
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
    "print-twice": {
      "requires":           ["print-once"],
      "reruns":             0,
      "task": {
        "version":          "0.2.0",
        "provisionerId":    "aws-provisioner",
        "workerType":       "{{test-worker-type}}",
        "routing":          "",
        "timeout":          600,
        "retries":          3,
        "priority":         5,
        "created":          "2014-03-01T22:19:32.124Z",
        "deadline":         "2060-03-01T22:19:32.124Z",
        "payload": {
          "image":          "ubuntu:latest",
          "command": [
            "/bin/bash", "-c",
            "echo 'Hello World (Again)'"
          ],
          "features": {
            "azureLivelog": true
          },
          "maxRunTime":     600
        },
        "metadata": {
          "name":           "Print `'Hello World'` Again",
          "description":    "This task will prìnt `'Hello World'` **again**! " +
                            "and wait for {{taskId:print-once}}.",
          "owner":          "jojensen@mozilla.com",
          "source":         "https://github.com/taskcluster/task-graph-scheduler"
        },
        "tags": {
          "objective":      "Test task-graph scheduler"
        }
      }
    }
  },
  "metadata": {
    "name":         "Validation Test TaskGraph",
    "description":  "Task-graph description in markdown",
    "owner":        "root@localhost.local",
    "source":       "http://github.com/taskcluster/task-graph-scheduler"
  },
  "tags": {
    "MyTestTag": "Hello World"
  }
};


/** Test that scheduler works */
exports.SchedulerTest = function(test) {
  test.expect(7);

  // Start with some super stupid event subscription setup where we listen for
  // the taskGraphId, which we'll set as soon as the task have been posted
  var taskGraphId;
  var localscheduler = new LocalScheduler();

  var listener = new Listener('scheduler/v1/task-graph-finished');
  listener.on('message', function(message) {
    debug("Got following message:", message);
    if (message.status.taskGraphId == taskGraphId) {
      test.ok(true);
      if (localscheduler) {
        localscheduler.terminate();
        localscheduler = null;
      }
      listener.destroy();
      test.done();
    }
  });

  var launched = localscheduler.launch();

  var subscribed = launched.then(function() {
    return listener.setup();
  });

  // Post something to the scheduler
  var posted = subscribed.then(function() {
    debug("Posting task-graph to scheduler");
    return request
              .post(
                'http://' + nconf.get('server:hostname') + ':' +
                nconf.get('server:port') + '/v1/task-graph/create'
              )
              .send(taskGraphExample)
              .end()
  }).then(function(res) {
    debug("Posted task to scheduler");
    if (!res.ok) {
      debug("Error submitting: ", JSON.stringify(res.body, null, 2));
      test.ok(false, "Failed to submit task-graph");
      return;
    }
    debug("Posting task-graph gave: ", res.body);
    taskGraphId = res.body.status.taskGraphId;
    test.ok(true, "Task-graph submitted");
  });

  var checked_info = posted.then(function() {
    return request
              .get(
                'http://' + nconf.get('server:hostname') + ':' +
                nconf.get('server:port') + '/v1/task-graph/' + taskGraphId +
                '/info'
              )
              .end();
  }).then(function(res) {
    test.ok(res.ok, "Fetched info without error");
    test.ok(res.body.params, "Check params isn't missing");
    test.ok(res.body.status.taskGraphId == taskGraphId, "got right taskGraphId");
    test.ok(res.body.tags.MyTestTag == "Hello World", "Got tag");
    test.ok(res.body.status.state == 'running', "got right state");
  });

  checked_info.catch(function(err) {
    debug("Error in scheduler test: ", err, err.stack);
    test.ok(false);
  });
};