var Promise     = require('promise');
var _           = require('lodash');
var debug       = require('debug')('routes:api:v1');
var assert      = require('assert');
var base        = require('taskcluster-base');
var helpers     = require('../../scheduler/helpers');
var taskcluster = require('taskcluster-client');

// Common schema prefix
var SCHEMA_PREFIX_CONST = 'http://schemas.taskcluster.net/scheduler/v1/';

/**
 * API end-point for version v1/
 *
 * In this API implementation we shall assume the following context:
 * {
 *   Task:          // Instance of Task from data.js
 *   TaskGraph:     // Instance of TaskGraph from data.js
 *   publisher:     // Publisher from base.Exchanges
 *   queue:         // Instance of taskcluster.Queue with scheduler credentials
 *   credentials:   // Credentials for taskcluster.Queue
 *   queueBaseUrl:  // BaseUrl for taskcluster-queue
 *   schedulerId:   // schedulerId from configuration
 *   validator:     // JSON validator created with base.validator
 * }
 */
var api = new base.API({
  title:        "Task-Graph Scheduler API Documentation",
  description: [
    "The task-graph scheduler, typically available at",
    "`scheduler.taskcluster.net`, is responsible for accepting task-graphs and",
    "scheduling tasks for evaluation by the queue as their dependencies are",
    "satisfied.",
    "",
    "This document describes API end-points offered by the task-graph",
    "scheduler. These end-points targets the following audience:",
    " * Post-commit hooks, that wants to submit task-graphs for testing,",
    " * End-users, who wants to execute a set of dependent tasks, and",
    " * Tools, that wants to inspect the state of a task-graph."
  ].join('\n')
});

// Export api
module.exports = api;

/** Create task-graph */
api.declare({
  method:         'put',
  route:          '/task-graph/:taskGraphId',
  name:           'createTaskGraph',
  scopes:         ['scheduler:create-task-graph'],
  skipInputValidation:  true,
  input:          SCHEMA_PREFIX_CONST + 'task-graph.json#',
  output:         SCHEMA_PREFIX_CONST + 'task-graph-status-response.json#',
  title:          "Create new task-graph",
  description: [
    "Create a new task-graph, the `status` of the resulting JSON is a",
    "task-graph status structure, you can find the `taskGraphId` in this",
    "structure.",
    "",
    "**Referencing required tasks**, it is possible to reference other tasks",
    "in the task-graph that must be completed successfully before a task is",
    "scheduled. You just specify the `taskId` in the list of `required` tasks.",
    "See the example below, where the second task requires the first task.",
    "```js",
    "{",
    "  ...",
    "  tasks: [",
    "    {",
    "      taskId:     \"XgvL0qtSR92cIWpcwdGKCA\",",
    "      requires:   [],",
    "      ...",
    "    },",
    "    {",
    "      taskId:     \"73GsfK62QNKAk2Hg1EEZTQ\",",
    "      requires:   [\"XgvL0qtSR92cIWpcwdGKCA\"],",
    "      task: {",
    "        payload: {",
    "          env: {",
    "            DEPENDS_ON:  \"XgvL0qtSR92cIWpcwdGKCA\"",
    "          }",
    "          ...",
    "        }",
    "        ...",
    "      },",
    "      ...",
    "    }",
    "  ]",
    "}",
    "```",
    "",
    "**The `schedulerId` property**, defaults to the `schedulerId` of this",
    "scheduler in production that is `\"task-graph-scheduler\"`. This",
    "property must be either undefined or set to `\"task-graph-scheduler\"`,",
    "otherwise the task-graph will be rejected.",
    "",
    "**The `taskGroupId` property**, defaults to the `taskGraphId` of the",
    "task-graph submitted, and if provided much be the `taskGraphId` of",
    "the task-graph. Otherwise the task-graph will be rejected.",
    "",
    "**Task-graph scopes**, a task-graph is assigned a set of scopes, just",
    "like tasks. Tasks within a task-graph cannot have scopes beyond those",
    "the task-graph has. The task-graph scheduler will execute all requests",
    "on behalf of a task-graph using the set of scopes assigned to the",
    "task-graph. Thus, if you are submitting tasks to `my-worker-type` under",
    "`my-provisioner` it's important that your task-graph has the scope",
    "required to define tasks for this `provisionerId` and `workerType`.",
    "See the queue for details on permissions required. Note, the task-graph",
    "does not require permissions to schedule the tasks. This is done with",
    "scopes provided by the task-graph scheduler.",
    "",
    "**Task-graph specific routing-keys**, using the `taskGraph.routes`",
    "property you may define task-graph specific routing-keys. If a task-graph",
    "has a task-graph specific routing-key: `<route>`, then the poster will",
    "be required to posses the scope `scheduler:route:<route>`. And when the",
    "an AMQP message about the task-graph is published the message will be",
    "CC'ed with the routing-key: `route.<route>`. This is useful if you want",
    "another component to listen for completed tasks you have posted."
  ].join('\n')
}, function(req, res) {
  var ctx         = this;
  var input       = req.body;
  var taskGraphId = req.params.taskGraphId;

  // Find scopes required for task-graph specific routes
  var routeScopes = (((input || {}).routes) || []).map(function(route) {
    return 'scheduler:route:' + route;
  });

  // Find scopes, don't validate schema will be validated later
  var scopes = (input || {}).scopes;
  if (!(scopes instanceof Array) || !scopes.every(function(scope) {
    return typeof(scope) === 'string';
  })) {
    scopes = [];
  }

  // Validate that the requester satisfies all the scopes assigned to the
  // task-graph and required by task-graph specific routes
  if(!req.satisfies([scopes]) ||
     !req.satisfies([routeScopes])) {
    return;
  }

  // Create queue API client delegating scopes this task-graph is authorized
  // to use
  var queue = new taskcluster.Queue({
    baseUrl:          ctx.queueBaseUrl,
    credentials:      ctx.credentials,
    authorizedScopes: scopes
  });

  // Prepare tasks
  return helpers.prepareTasks(input, {
    taskGraphId:      taskGraphId,
    schedulerId:      ctx.schedulerId,
    existingTasks:    [],
    queue:            queue,
    schema:           SCHEMA_PREFIX_CONST + 'task-graph.json#',
    validator:        ctx.validator
  }).then(function(result) {
    if (result.error || !result.tasks) {
      return res.status(400).json(result);
    }

    // Find leaf tasks, these are the ones the task-graph will wait for before
    // declaring it self finished. Note that all other tasks will have finished
    // before the leaf tasks finish.
    var requires = result.tasks.filter(function(task) {
      return task.dependents.length == 0;
    }).map(function(task) {
      return task.taskId;
    });

    // Create taskGraph entity
    debug("Create TaskGraph entity for %s with %s required tasks",
          taskGraphId, requires.length);
    return ctx.TaskGraph.create({
      taskGraphId:        taskGraphId,
      version:            1,
      requires:           requires,
      requiresLeft:       _.cloneDeep(requires),
      state:              'running',
      routes:             result.input.routes,
      scopes:             result.input.scopes,
      details: {
        metadata:         result.input.metadata,
        tags:             result.input.tags
      }
    }).catch(function(err) {
      if (err.code !== 'EntityAlreadyExists') {
        throw err;
      }
      // Compare if it already exists
      debug("Loading %s to compare with existing", taskGraphId);
      return ctx.TaskGraph.load(taskGraphId).then(function(taskGraph) {
        if (taskGraph.version !== 1 ||
          !_.isEqual(taskGraph.requires, requires) ||
          taskGraph.state !== 'running' ||
          !_.isEqual(taskGraph.routes, result.input.routes) ||
          !_.isEqual(taskGraph.scopes, result.input.scopes) ||
          !_.isEqual(taskGraph.details, {
            metadata:         result.input.metadata,
            tags:             result.input.tags
          })) {
          var err = new Error("Conflict with existing taskgraph");
          err.code = 'TaskGraphIdConflict';
          throw err;
        }
        return taskGraph;
      });
    }).then(function(taskGraph) {
      // Create all task entities
      return Promise.all(result.tasks.map(function(task) {
        debug("Creating entity for taskId: %s", task.taskId);
        return ctx.Task.create(task).catch(function(err) {
          if (err.code !== 'EntityAlreadyExists') {
            throw err;
          }
          return ctx.Task.load(taskGraphId, task.taskId).then(function(task2) {
            if (task2.version !== 1 ||
              task2.rerunsAllowed !== task.rerunsAllowed ||
              task2.deadline.getTime() !== task.deadline.getTime() ||
              !_.isEqual(task2.requires, task.requires) ||
              !_.isEqual(task2.dependents, task.dependents)) {
              var err = new Error("Conflict with existing task in taskGraph");
              err.code = 'TaskIdConflict';
              throw err;
            }
            return task2;
          });
        });
      })).then(function(tasks) {
        // Schedule initial tasks...
        return Promise.all(tasks.filter(function(task) {
          return task.requires.length === 0;
        }).map(function(task) {
          return ctx.queue.scheduleTask(task.taskId);
        }));
      }).then(function() {
        debug("Publishing event about taskGraphId: %s", taskGraphId);
        return ctx.publisher.taskGraphRunning({
          status:               taskGraph.status()
        }, taskGraph.routes);
      }).then(function() {
        return res.reply({
          status:               taskGraph.status()
        });
      });
    }).catch(function(err) {
      if (err && err.code === 'TaskGraphIdConflict') {
        return res.status(409).json({
          message:  "Different TaskGraph with given taskGraphId already " +
                    "exists, if this your attempt at an idempotent operation " +
                    "then you've failed!"
        });
      }
      if (err && err.code === 'TaskIdConflict') {
        return res.status(409).json({
          message:  "Different TaskId with given TaskId already " +
                    "exists, if this your attempt at an idempotent operation " +
                    "then you've failed!"
        });
      }
      throw err;
    });
  });
});


/** Post a task-graph decision to extend a task-graph */
api.declare({
    method:       'post',
  route:          '/task-graph/:taskGraphId/extend',
  name:           'extendTaskGraph',
  scopes:         ['scheduler:extend-task-graph:<taskGraphId>'],
  deferAuth:      true,
  input:          SCHEMA_PREFIX_CONST + 'extend-task-graph-request.json#',
  output:         SCHEMA_PREFIX_CONST + 'task-graph-status-response.json#',
  title:          "Extend existing task-graph",
  description: [
    "Add a set of tasks to an existing task-graph. The request format is very",
    "similar to the request format for creating task-graphs. But `routes`",
    "key, `scopes`, `metadata` and `tags` cannot be modified.",
    "",
    "**Referencing required tasks**, just as when task-graphs are created,",
    "each task has a list of required tasks. It is possible to reference",
    "all `taskId`s within the task-graph.",
    "",
    "**Safety,** it is only _safe_ to call this API end-point while the",
    "task-graph being modified is still running. If the task-graph is",
    "_finished_ or _blocked_, this method will leave the task-graph in this",
    "state. Hence, it is only truly _safe_ to call this API end-point from",
    "within a task in the task-graph being modified."
  ].join('\n')
}, function(req, res) {
  var ctx = this;
  var input       = req.body;
  var taskGraphId = req.params.taskGraphId;

  // Authenticate request by providing parameters
  if(!req.satisfies({
    taskGraphId:    taskGraphId,
  })) {
    return;
  }

  // Load task graph and tasks
  var taskGraph       = null;
  var existingTasks   = null;
  var existingTaskIds = null;
  var queue           = null;
  var gotTaskGraph = Promise.all([
    ctx.TaskGraph.load(taskGraphId),
    ctx.Task.loadGraphTasks(taskGraphId)
  ]).then(function(values) {
    taskGraph       = values.shift();
    existingTasks   = values.shift();
    existingTaskIds = existingTasks.map(function(task) {
      return task.taskId;
    });
    // Create queue API client delegating scopes this task-graph is authorized
    // to use
    queue = new taskcluster.Queue({
      baseUrl:          ctx.queueBaseUrl,
      credentials:      ctx.credentials,
      authorizedScopes: taskGraph.scopes
    });
  });

  // Prepare tasks
  return gotTaskGraph.then(function() {
    return helpers.prepareTasks(input, {
      taskGraphId:      taskGraphId,
      schedulerId:      ctx.schedulerId,
      existingTasks:    existingTasks,
      queue:            queue,
      schema:           SCHEMA_PREFIX_CONST + 'extend-task-graph-request.json#',
      validator:        ctx.validator
    }).then(function(result) {
      if (result.error || !result.tasks) {
        return res.json(400, result);
      }

      // Find new leaf tasks that the task-graph should depend on
      var newRequires = result.tasks.filter(function(task) {
        return task.dependents.length == 0;
      }).map(function(task) {
        return task.taskId;
      });

      // Find old tasks that should be required by the task-graph
      var OldRequires = existingTasks.filter(function(task) {
        return task.dependents.length === 0;
      }).map(function(task) {
        return task.taskId;
      });

      // Update task-graph with new tasks that it should wait for
      return taskGraph.modify(function() {
        // Update requires, removing tasks that have dependents and adding new
        // required tasks
        this.requires = _.union(_.intersection(
          this.requires,
          OldRequires
        ), newRequires);

        // Update requiresLeft the same way
        this.requiresLeft = _.union(_.intersection(
          this.requiresLeft,
          OldRequires
        ), newRequires);
      }).then(function() {
        return Promise.all(result.tasks.map(function(task) {
          return ctx.Task.create(task).catch(function(err) {
            if (err.code !== 'EntityAlreadyExists') {
              throw err;
            }
            return ctx.Task.load(taskGraphId, task.taskId).then(function(t2) {
              if (t2.version !== 1 ||
                t2.rerunsAllowed !== task.rerunsAllowed ||
                t2.deadline.getTime() !== task.deadline.getTime() ||
                !_.isEqual(t2.requires, task.requires) ||
                !_.isEqual(t2.dependents, task.dependents)) {
                debug("[TASK-EXTEND-ERROR] new-task: %j != %j   <-- old-task", {
                  rerunsAllowed:  task.rerunsAllowed,
                  deadline:       task.deadline.getTime(),
                  requires:       task.requires,
                  dependents:     task.dependents
                }, {
                  rerunsAllowed:  t2.rerunsAllowed,
                  deadline:       t2.deadline.getTime(),
                  requires:       t2.requires,
                  dependents:     t2.dependents
                });
                var err = new Error("Conflict with existing task in taskGraph");
                err.code = 'TaskIdConflict';
                throw err;
              }
              return t2;
            });
          });
        })).then(function(tasks) {
          // Schedule initial tasks...
          return Promise.all(tasks.filter(function(task) {
            return task.requires.length === 0;
          }).map(function(task) {
            return ctx.queue.scheduleTask(task.taskId);
          }));
        }).then(function() {
          // Load all tasks, so we can ensure that tasks are scheduled, if one
          // of the required tasks was resolved...
          return ctx.Task.loadGraphTasks(taskGraphId);
        }).then(function(tasks) {
          // Find existing that is resolved successfully
          return Promise.all(tasks.filter(function(task) {
            return task.details.satisfied &&
                   _.contains(existingTaskIds, task.taskId);
          }).map(function(task) {
            return helpers.scheduleDependentTasks(task, ctx.queue, ctx.Task);
          }));
        }).then(function() {
          debug("Publishing event about taskGraphId: %s", taskGraphId);
          return ctx.publisher.taskGraphExtended({
            status:               taskGraph.status()
          }, taskGraph.routes);
        }).then(function() {
          return res.reply({
            status:               taskGraph.status()
          });
       });
      });
    });
  }).catch(function(err) {
    if (err && err.code === 'TaskIdConflict') {
      return res.status(409).json({
        message:  "Different TaskId with given TaskId already " +
                  "exists, if this your attempt at an idempotent operation " +
                  "then you've failed!"
      });
    }
    throw err;
  });
});


/** Get task-graph status */
api.declare({
  method:     'get',
  route:      '/task-graph/:taskGraphId/status',
  name:       'status',
  input:      undefined,
  output:     SCHEMA_PREFIX_CONST + 'task-graph-status-response.json',
  title:      "Task Graph Status",
  description: [
    "Get task-graph status, this will return the _task-graph status",
    "structure_. which can be used to check if a task-graph is `running`,",
    "`blocked` or `finished`.",
    "",
    "**Note**, that `finished` implies successfully completion."
  ].join('\n')
}, function(req, res) {
  // Find task-graph id
  var taskGraphId = req.params.taskGraphId;

  // Load task-graph and build a status
  return this.TaskGraph.load(taskGraphId).then(function(taskGraph) {
    res.reply({
      status:               taskGraph.status()
    });
  });
});

/** Get task-graph metadata and tags */
api.declare({
  method:     'get',
  route:      '/task-graph/:taskGraphId/info',
  name:       'info',
  input:      undefined,
  output:     SCHEMA_PREFIX_CONST + 'task-graph-info-response.json',
  title:      "Task Graph Information",
  description: [
    "Get task-graph information, this includes the _task-graph status",
    "structure_, along with `metadata` and `tags`, but not information",
    "about all tasks.",
    "",
    "If you want more detailed information use the `inspectTaskGraph`",
    "end-point instead."
  ].join('\n')
}, function(req, res) {
  // Find task-graph id
  var taskGraphId = req.params.taskGraphId;

  // Load task-graph and build a status
  return this.TaskGraph.load(taskGraphId).then(function(taskGraph) {
    res.reply({
      status:               taskGraph.status(),
      metadata:             taskGraph.details.metadata,
      tags:                 taskGraph.details.tags
    });
  });
});


/** Get inspect task-graph */
api.declare({
  method:     'get',
  route:      '/task-graph/:taskGraphId/inspect',
  name:       'inspect',
  input:      undefined,
  output:     SCHEMA_PREFIX_CONST + 'inspect-task-graph-response.json',
  title:      "Inspect Task Graph",
  description: [
    "Inspect a task-graph, this returns all the information the task-graph",
    "scheduler knows about the task-graph and the state of its tasks.",
    "",
    "**Warning**, some of these fields are borderline internal to the",
    "task-graph scheduler and we may choose to change or make them internal",
    "later. Also note that note all of the information is formalized yet.",
    "The JSON schema will be updated to reflect formalized values, we think",
    "it's safe to consider the values stable.",
    "",
    "Take these considerations into account when using the API end-point,",
    "as we do not promise it will remain fully backward compatible in",
    "the future.",
  ].join('\n')
}, function(req, res) {
  // Find task-graph id
  var taskGraphId = req.params.taskGraphId;

  // Load task-graph and all tasks
  return Promise.all([
      this.TaskGraph.load(taskGraphId),
      this.Task.loadGraphTasks(taskGraphId)
  ]).then(function(values) {
    var taskGraph = values.shift();
    var tasks     = values.shift();

    var taskData = tasks.map(function(task) {
      return {
        taskId:       task.taskId,
        name:         task.details.name,
        requires:     task.requires,
        requiresLeft: task.requiresLeft,
        reruns:       task.rerunsAllowed,
        rerunsLeft:   task.rerunsLeft,
        state:        task.state,
        satisfied:    task.details.satisfied,
        dependents:   task.dependents
      };
    });

    res.reply({
      status:   taskGraph.status(),
      tasks:    taskData,
      metadata: taskGraph.details.metadata,
      tags:     taskGraph.details.tags,
      scopes:   taskGraph.scopes
    });
  });
});


/** Get inspect a task from a task-graph */
api.declare({
  method:     'get',
  route:      '/task-graph/:taskGraphId/inspect/:taskId',
  name:       'inspectTask',
  input:      undefined,
  output:     SCHEMA_PREFIX_CONST + 'inspect-task-graph-task-response.json',
  title:      "Inspect Task from a Task-Graph",
  description: [
    "Inspect a task from a task-graph, this returns all the information the",
    "task-graph scheduler knows about the specific task.",
    "",
    "**Warning**, some of these fields are borderline internal to the",
    "task-graph scheduler and we may choose to change or make them internal",
    "later. Also note that note all of the information is formalized yet.",
    "The JSON schema will be updated to reflect formalized values, we think",
    "it's safe to consider the values stable.",
    "",
    "Take these considerations into account when using the API end-point,",
    "as we do not promise it will remain fully backward compatible in",
    "the future.",
  ].join('\n')
}, function(req, res) {
  // Find task-graph id
  var taskGraphId = req.params.taskGraphId;
  var taskId      = req.params.taskId;

  return this.Task.load(taskGraphId, taskId).then(function(task) {
    return res.reply({
      taskId:       task.taskId,
      name:         task.details.name,
      requires:     task.requires,
      requiresLeft: task.requiresLeft,
      reruns:       task.rerunsAllowed,
      rerunsLeft:   task.rerunsLeft,
      state:        task.state,
      satisfied:    task.details.satisfied,
      dependents:   task.dependents
    });
  });
});






/** Check that the server is a alive */
api.declare({
  method:   'get',
  route:    '/ping',
  name:     'ping',
  title:    "Ping Server",
  description: [
    "Documented later...",
    "",
    "**Warning** this api end-point is **not stable**."
  ].join('\n')
}, function(req, res) {
  res.status(200).json({
    alive:    true,
    uptime:   process.uptime()
  });
});
