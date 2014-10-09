var assert      = require('assert');
var _           = require('lodash');
var Promise     = require('promise');
var debug       = require('debug')('scheduler:helpers');
var taskcluster = require('taskcluster-client');

/**
 * Prepare tasks from input for addition to a task-graph. This can be either an
 * existing task-graph or a new task-graph.
 *
 * This helper will do the following:
 *  - Validate semantics of input
 *  - Validate scopes
 *  - Upload tasks to taskPurUrls from queue
 *  - Update `dependents` for existing tasks
 *  - Construct JSON for `Task.create()`
 *
 * options:
 * {
 *   taskGraphId:        // taskGraphId for the task-graph
 *   schedulerId:        // SchedulerId
 *   existingTasks:      // Existing tasks in the task-graph
 *   queue:              // Instance of taskcluster.Queue delegating scopes
 *                       // this task-graph is authorized to use
 *   schema:             // Schema for validation
 *   validator:          // base.validator instance
 * }
 *
 * Returns a promise for:
 *  A) A object on the following format:
 *    {
 *      input:    // Input with prefixed routing key
 *      tasks:    // JSON objects to use with `Task.create()`
 *    }
 *  B) An error object with a `message` and `error` for the user.
 *
 * In case of (B) the error message should be displayed to the user. The promise
 * is rejected in case of internal errors. Ie. messages that shouldn't be
 * displayed to the user.
 */
exports.prepareTasks = function(input, options) {
  // Provide default options
  options = _.defaults(options || {}, {
    existingTasks:  []
  });

  // Validate options
  assert(options.taskGraphId, "A taskGraphId is required!");
  assert(options.schedulerId, "A schedulerId is required!");
  assert(options.queue instanceof taskcluster.Queue,
         "Instance of taskcluster.Queue is required!");
  assert(options.schema, "A schema for the input is required!");
  assert(options.validator, "A validator object is required");


  // Provide defaults for schedulerId and taskGroupId, keep in mind that we're
  // using the schema provided by the queue and can't determine what defaults
  // is set in this schema. So we just want to make sure that the defaults will
  // work. If defined we don't overwrite them, but we shall validate them later
  // so a moron who provided wrong values will get an error.
  if (input && input.tasks instanceof Array) {
    input.tasks.forEach(function(taskNode) {
      // Provide schedulerId if not already present
      if (taskNode.task && taskNode.task.schedulerId === undefined) {
        taskNode.task.schedulerId = options.schedulerId;
      }
      // Provide taskGroupId if not already present
      if (taskNode.task && taskNode.task.taskGroupId === undefined) {
        taskNode.task.taskGroupId = options.taskGraphId;
      }
    });
  }

  // Validate input
  var schemaErrors = options.validator.check(input, options.schema);
  if (schemaErrors) {
    return Promise.resolve({
      'message':  "Request payload must follow the schema: " + options.schema,
      'error':    schemaErrors
    });
  }

  // Construct list of a all taskIds
  var allTaskIds = input.tasks.map(function(taskNode) {
    return taskNode.taskId;
  }).concat(options.existingTasks.map(function(task) {
    return task.taskId;
  }));

  // Validate semantics
  var errors = [];
  input.tasks.forEach(function(taskNode) {
    // Check that schedulerId is task-graph-scheduler
    if (taskNode.task.schedulerId !== options.schedulerId) {
      errors.push({
        message:  "schedulerId must match schedulerId for this scheduler",
        error: {
          thisSchedulerId:  options.schedulerId,
          GivenSchedulerId: taskNode.task.schedulerId,
          taskId:           taskNode.taskId
        }
      });
    }

    // Check that taskGroupId is set to taskGraphId
    if (taskNode.task.taskGroupId !== options.taskGraphId) {
      errors.push({
        message:  "taskGroupId must be set to taskGraphId for this scheduler",
        error: {
          taskGraphId:      options.taskGraphId,
          taskGroupId:      taskNode.task.taskGroupId,
          taskId:           taskNode.taskId
        }
      });
    }

    // Check for duplicates in requires
    if (!_.isEqual(taskNode.requires, _.uniq(taskNode.requires))) {
      errors.push({
        message:  "Requires for " + taskNode.taskId +
                  " contains duplicates, this is not allowed",
        error:    taskNode.requires,
      });
    }

    // Check for references of undefined task labels
    taskNode.requires.forEach(function(taskId) {
      if (!_.contains(allTaskIds, taskId)) {
        errors.push({
          message:  "Requires for " + taskNode.taskId + " references " +
                    "undefined taskId: " + taskId,
          error:    taskId
        });
      }
    });
  });

  // Report errors found
  if (errors.length > 0) {
    return Promise.resolve({
      message:              "Errors found in task nodes",
      error:                errors
    });
  }

  // Construct task JSON for Task.create()
  var tasks = input.tasks.map(function(taskNode) {
    // Get taskId
    var taskId = taskNode.taskId;
    // Find dependent tasks
    var dependents = input.tasks.filter(function(taskNode) {
      return _.contains(taskNode.requires, taskId);
    }).map(function(taskNode) {
      return taskNode.taskId;
    });

    // Decide if this is a leaf node
    var isLeaf = (taskNode.requires.length === 0);

    // Construct JSON for Task.create()
    return {
      taskGraphId:      options.taskGraphId,
      taskId:           taskId,
      version:          1,
      rerunsAllowed:    taskNode.reruns,
      rerunsLeft:       taskNode.reruns,
      deadline:         new Date(taskNode.task.deadline),
      requires:         _.cloneDeep(taskNode.requires),
      requiresLeft:     _.cloneDeep(taskNode.requires),
      dependents:       dependents,
      state:            isLeaf ? 'scheduled' : 'unscheduled',
      details:          {
        name:           taskNode.task.metadata.name,
        satisfied:      false
      }
    };
  });

  // Upload all tasks and return result from prepareTasks
  var queueErrors = [];
  return Promise.all(input.tasks.map(function(taskNode) {
    return options.queue.defineTask(
      taskNode.taskId,
      taskNode.task
    ).catch(function(err) {
      // Handle authentication as these happen when the task-graph wasn't given
      // enough scopes and hence we couldn't defineTask. It's 400 error.
      if (err.statusCode === 401) {
        return queueErrors.push({
          message:  err.message,
          error:    err.body
        });
      }
      throw err;
    });
  })).then(function() {
    // Report errors from defining tasks on the queue, like things like missing
    // authentication scopes whatever...
    if(queueErrors.length > 0) {
      return {
        message:            "You didn't give the task-graph scopes" +
                            "allowing it define tasks on the queue.",
        error:              queueErrors
      };
    }

    // Find existing tasks that have new dependents and modify their
    // dependents property to include these
    return Promise.all(options.existingTasks.filter(function(task) {
      // Find existing tasks for which we have dependencies
      return _.some(input.tasks, function(taskNode) {
        return _.contains(taskNode.requires, task.taskId);
      });
    }).map(function(task) {
      // Modify task, so that it has the new dependents in it's list of
      // dependents
      return task.modify(function() {
        // Find new dependent tasks
        var newDependents = input.tasks.filter(function(taskNode) {
          return _.contains(taskNode.requires, task.taskId);
        }).map(function(taskNode) {
          return taskNode.taskId;
        });

        // Add new dependent tasks to dependents
        this.dependents = this.dependents.concat(newDependents);
      });
    })).then(function() {
      return {
        input:    input,
        tasks:    tasks
      };
    });
  });
};

/**
 * Schedule dependent tasks, if the resolution of task caused them to be
 * scheduled.
 */
exports.scheduleDependentTasks = function(task, queue, Task) {
  // Validate input
  assert(queue instanceof taskcluster.Queue,
         "Instance of taskcluster.Queue is required");
  assert(Task, "Instance of data.Task is required");
  assert(task.details.satisfied, "Task must have been resolved successfully");

  // Let's load, modify and schedule all dependent tasks that are ready
  return Promise.all(task.dependents.map(function(dependentTaskId) {
    // First we load the dependent task
    return Task.load(
      task.taskGraphId,
      dependentTaskId
    ).then(function(dependentTask) {
      assert(dependentTask.taskId == dependentTaskId, "Just a sanity check");
      // Then we modify the dependent task
      return dependentTask.modify(function() {
        // If the successfully completed task isn't required by the dependent
        // task then we don't need to modify or schedule it
        if (!_.contains(this.requiresLeft, task.taskId)) {
          return;
        }

        // Now we know the successful task is blocking, we remove it
        this.requiresLeft = _.without(this.requiresLeft, task.taskId);

        // If no other tasks are blocked the dependent tasks then we should
        // schedule it.
        if (this.requiresLeft.length == 0) {
          // Change the state to scheduled
          this.state = 'scheduled';

          // Note, that on the queue this is an idempotent operation, so it is
          // not a problem if we do this more than once.
          debug("scheduling %s for graph: %s",
                dependentTaskId, task.taskGraphId);
          return queue.scheduleTask(dependentTaskId).catch(function(err) {
            debug("Failed to schedule task: %s", dependentTaskId);
            throw err;
          });
        }
      });
    });
  }));
};
