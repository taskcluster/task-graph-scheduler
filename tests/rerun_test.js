var config          = require('../config');
var LocalScheduler  = require('./localscheduler');
var debug           = require('debug')('tests:scheduler_test');
var request         = require('superagent');
var Promise         = require('promise');
var nconf           = require('nconf');
var amqp            = require('amqp');
var Listener        = require('./listener');

config.load();

// Task graph that'll post in this test
var taskGraphExample = {
  "version":                "0.2.0",
  "routing":                "",
  "tasks": {
    "print-once": {
      "requires":           [],
      "reruns":             2,
      "task": {
        "version":          "0.2.0",
        "provisionerId":    "aws-provisioner",
        "workerType":       "ami-cc5c30fc",
        "routing":          "",
        "retries":          3,
        "priority":         5,
        "created":          "2014-03-01T22:19:32.124Z",
        "deadline":         "2060-03-01T22:19:32.124Z",
        "payload": {
          "image":          "ubuntu",
          "command": [
            "/bin/bash", "-c",
            "exit 1"
          ],
          "features": {
            "azureLivelog": true
          }
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
        "workerType":       "ami-cc5c30fc",
        "routing":          "",
        "retries":          3,
        "priority":         5,
        "created":          "2014-03-01T22:19:32.124Z",
        "deadline":         "2060-03-01T22:19:32.124Z",
        "payload": {
          "image":          "ubuntu",
          "command": [
            "/bin/bash", "-c",
            "echo 'Hello World (Again)'"
          ],
          "features": {
            "azureLivelog": true
          }
        },
        "metadata": {
          "name":           "Print `'Hello World'` Again",
          "description":    "This task will prìnt `'Hello World'` **again**!",
          "owner":          "jojensen@mozilla.com",
          "source":         "https://github.com/taskcluster/task-graph-scheduler"
        },
        "tags": {
          "objective":      "Test task-graph scheduler"
        }
      }
    }
  }
};


/** Test that scheduler works */
exports.SchedulerTest = function(test) {
  test.expect(2);

  // Start with some super stupid event subscription setup where we listen for
  // the taskGraphId, which we'll set as soon as the task have been posted
  var taskGraphId;
  var localscheduler = new LocalScheduler();
  localscheduler.launch();
  debug("Started localscheduler");

  var listener = new Listener('scheduler/v1/task-graph-blocked');
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

  var subscribed = listener.setup();

  // Post something to the scheduler
  subscribed.then(function() {
    debug("Giving localscheduler 3s to start");
    setTimeout(function() {
      debug("Posting task-graph to scheduler");
      request
        .post(
          'http://' + nconf.get('server:hostname') + ':' +
          nconf.get('server:port') + '/v1/task-graph/create'
        )
        .send(taskGraphExample)
        .end(function(res) {
          debug("Posted task to scheduler");
          if (!res.ok) {
            debug("Error submitting: ", res.body);
            test.ok(false, "Failed to submit task-graph");
            return;
          }
          debug("Posting task-graph gave: ", res.body);
          taskGraphId = res.body.status.taskGraphId;
          test.ok(true, "Task-graph submitted");
        });
      debug("Task posted");
    }, 3000);
  }).catch(function(err) {
    debug("Error in scheduler test: ", err, err.stack);
    test.ok(false);
  });
};