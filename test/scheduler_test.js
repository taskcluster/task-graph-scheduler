suite('scheduler (extra)', function() {
  var base        = require('taskcluster-base');
  var taskcluster = require('taskcluster-client');
  var request     = require('superagent-promise');
  var path        = require('path');
  var Promise     = require('promise');
  var assert      = require('assert');
  var exchanges   = require('../scheduler/exchanges');

  // Configure server
  var server = new base.testing.LocalApp({
    command:      path.join(__dirname, '..', 'bin', 'server.js'),
    args:         ['testing'],
    name:         'server.js',
    baseUrlPath:  '/v1'
  });

  // Configure handlers
  var handlers = new base.testing.LocalApp({
    command:      path.join(__dirname, '..', 'bin', 'handlers.js'),
    args:         ['testing'],
    name:         'handlers.js',
    baseUrlPath:  '/v1'
  });

  // Setup server
  var baseUrl = null;
  setup(function() {
    return Promise.all(
      handlers.launch(),
      server.launch().then(function(baseUrl_) {
        baseUrl = baseUrl_;
      })
    );
  });

  // Shutdown server
  teardown(function() {
    return Promise.all(server.terminate(), handlers.terminate());
  });

  // Load test configuration
  var cfg = base.config({
    defaults:     require('../config/defaults'),
    profile:      require('../config/testing'),
    envs: [
      'amqp_url'
    ],
    filename:               'task-graph-scheduler'
  });

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


  test('scheduler, status, info and inspect', function() {
    this.timeout('8m');

    // Create listener
    var listener = new taskcluster.Listener({
      connectionString:   cfg.get('amqp:url')
    });

    // Create SchedulerEvents class from reference
    var SchedulerEvents = taskcluster.createClient(exchanges.reference({
      exchangePrefix:        cfg.get('scheduler:exchangePrefix')
    }));
    var schedulerEvents = new SchedulerEvents();

    // Bind to exchange
    listener.bind(schedulerEvents.taskGraphFinished({
      schedulerId:      cfg.get('scheduler:schedulerId')
    }));

    var taskGraphId = null;
    var done = new Promise(function(accept, reject) {
      listener.on('message', function(message) {
        if(message.payload.status.taskGraphId === taskGraphId) {
          setTimeout(function() {
            listener.close().then(accept());
          }, 250);
          return listener.pause();
        }
      });
    });

    return listener.connect().then(function() {
      return request
        .post(baseUrl + '/task-graph/create')
        .send(taskGraphExample)
        .end()
        .then(function(res) {
          assert(res.ok, "Failed to submit task-graph");
          taskGraphId = res.body.status.taskGraphId;
        });
    }).then(function() {
      return request
        .get(baseUrl + '/task-graph/' + taskGraphId + '/status')
        .end()
        .then(function(res) {
          assert(res.ok, "Fetched info without error");
          assert(res.body.status.taskGraphId == taskGraphId,
                 "got right taskGraphId");
          assert(res.body.status.state == 'running', "got right state");
        });
    }).then(function() {
      return request
        .get(baseUrl + '/task-graph/' + taskGraphId + '/info')
        .end()
        .then(function(res) {
          assert(res.ok, "Fetched info without error");
          assert(res.body.status.taskGraphId == taskGraphId,
                 "got right taskGraphId");
          assert(res.body.tags.MyTestTag == "Hello World", "Got tag");
          assert(res.body.status.state == 'running', "got right state");
        });
    }).then(function() {
      return request
        .get(baseUrl + '/task-graph/' + taskGraphId + '/inspect')
        .end()
        .then(function(res) {
          assert(res.ok, "Fetched info without error");
          assert(res.body.params, "Check params isn't missing");
          assert(res.body.status.taskGraphId == taskGraphId,
                 "got right taskGraphId");
          assert(res.body.tags.MyTestTag == "Hello World", "Got tag");
          assert(res.body.status.state == 'running', "got right state");
          assert(res.body.tasks['print-twice'].requires.length == 1,
                 "got requires right");
        });
    }).then(function() {
      return done;
    });
  });
});
