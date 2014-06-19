
/*
createTaskGraph:
 - Find taskGraphId (by generation)

 - store unpatched_parameters

 - prepateTasks(...)

 - Create taskGraph (in table) using parameterized input
 - Publish message about task-graph

 - Create tasks (table)   -> output Task instances
 - Schedule initial tasks    (input is Task instances)

Append to task-graph:
 - merge parameters with stored parameters
 - prepateTasks(...)

 - update taskGraph requires
 - Create tasks (table)   -> output Task instances
 - Schedule initial tasks    (input is Task instances)
 - for all existing tasks that are resolved:
     scheduleDependentTasks from handler.js
*/

var assert      = require('assert');
var _           = require('lodash');
var Promise     = require('promise');
var debug       = require('debug')('scheduler:helpers');
var taskcluster = require('taskcluster-client');
var jsonsubs    = require('../utils/jsonsubs');
var request     = require('superagent-promise');

/**
 * Prepare tasks from input for addition to a task-graph. This can be either an
 * existing task-graph or a new task-graph.
 *
 * This helper will do the following:
 *  - Execute queue.defineTasks
 *  - Parameterize input
 *  - Validate input against schema
 *  - Validate semantics of input
 *  - Upload tasks to taskPurUrls from queue
 *  - Update `dependents` for existing tasks
 *  - Construct JSON for `Task.create()`
 *
 * options:
 * {
 *   taskGraphId:        // taskGraphId for the task-graph
 *   params:             // Parameters for the task-graph
 *   schedulerId:        // SchedulerId
 *   existingTasks:      // Existing tasks in the task-graph
 *   queue:              // Instance of taskcluster.Queue
 *   routing:            // task-graph routing key (if not taken from input)
 *   schema:             // Schema to validate parameterized input against
 *   validator:          // base.validator instance
 * }
 *
 * Returns a promise for:
 *  A) A object on the following format:
 *    {
 *      input:    // Parameterized input
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
    params:         {},
    existingTasks:  []
  });

  // Validate options
  assert(options.taskGraphId, "A taskGraphId is required!");
  assert(options.schedulerId, "A schedulerId is required!");
  assert(options.queue instanceof taskcluster.Queue,
         "Instance of taskcluster.Queue is required!");
  assert(options.schema, "A schema for the input is required!");

  // Find task labels
  var taskLabels = (input.tasks || []).map(function(taskNode) {
    return taskNode.label;
  });

  // Define tasks and get taskIds
  var tasksDefined = options.queue.defineTasks({
    tasksRequested:     taskLabels.length
  });

  // Parameterize tasks
  var labelToInfo = {};
  var inputParameterized = tasksDefined.then(function(defineTaskResult) {
    // Shim for new task result format
    defineTaskResult.tasks = _.map(defineTaskResult.tasks, function(v, k) {
      return {taskId: k, taskPutUrl: v.taskPutUrl};
    });

    // Check that we got the right number
    assert(defineTaskResult.tasks.length === taskLabels.length,
           "didn't get the expect number of taskPutUrls!");

    // Create mapping from label to task definition info
    for(var i = 0; i < taskLabels.length; i++) {
      labelToInfo[taskLabels[i]] = defineTaskResult.tasks[i];
    }

    // Create taskId:<label>  => <taskId> parameters
    var taskIdParams = _.map(labelToInfo, function(info, label) {
      return {
        key: 'taskId:' + label,
        val: info.taskId
      };
    }).concat(options.existingTasks.map(function(task) {
      return {
        key:  'taskId:' + task.label,
        val:  task.taskId
      };
    })).reduce(function(obj, entry) {
      obj[entry.key] = entry.val;
      return obj;
    }, {});

    // Parameterize input
    input = jsonsubs(input, _.defaults(options.params || {}, taskIdParams, {
      taskGraphId:  options.taskGraphId
    }));

    // Routing prefix for task.routing
    var routingPrefix = [
      options.schedulerId,
      options.taskGraphId,
      options.routing || input.routing || ''
    ].join('.') + '.';

    // Prefix routing keys
    (input.tasks || []).forEach(function(taskNode) {
      var routing = (taskNode.task || {}).routing || '';
      (taskNode.task || {}).routing = routingPrefix + routing;
    });

    // Add taskGraphId to task metadata
    (input.tasks || []).forEach(function(taskNode) {
      ((taskNode.task || {}).metadata || {}).taskGraphId = options.taskGraphId;
    });
  });

  // Validate schema, semantics and construct return value
  return inputParameterized.then(function() {
    // Validate against schema
    var errors = options.validator.check(input, options.schema);
    if (errors) {
      debug("Request payload didn't follow schema %s", options.schema);
      return {
        message: "Request payload must follow the schema: " + options.schema,
        error:              errors,
        parameterizedInput: input
      };
    }

    // Validate that labels wasn't modified by parameterization
    var taskLabelsAfterParameterization = input.tasks.map(function(taskNode) {
      return taskNode.label;
    });
    if(!_.isEqual(taskLabels, taskLabelsAfterParameterization)) {
      return {
        message:            "Parameterized task-labels are not permitted",
        error: {
          taskLabels:                       taskLabels,
          taskLabelsAfterParameterization:  taskLabelsAfterParameterization
        },
        parameterizedInput: input
      };
    }

    // Construct list of all taskLabels
    var allTaskLabels = input.tasks.map(function(taskNode) {
      return taskNode.label;
    }).concat(options.existingTasks.map(function(task) {
      return task.label;
    }));

    // Check that all taskLabels are unique
    if(!_.isEqual(allTaskLabels, _.uniq(allTaskLabels))) {
      return {
        message:            "Task labels must be unique, within the task-graph",
        error: {
          taskLabels:       allTaskLabels,
          uniqueLabels:     _.uniq(allTaskLabels)
        },
        parameterizedInput: input
      }
    }

    // Validate semantics
    var errors = [];
    input.tasks.forEach(function(taskNode) {
      // Check for duplicates in requires
      if (!_.isEqual(taskNode.requires, _.uniq(taskNode.requires))) {
        errors.push({
          message:  "Requires for " + taskNode.label +
                    " contains duplicates, this is not allowed",
          error:    taskNode.requires,
        });
      }

      // Check for references of undefined task labels
      taskNode.requires.forEach(function(label) {
        if (!_.contains(allTaskLabels, label)) {
          errors.push({
            message:  "Requires for " + taskNode.label + " references " +
                      "undefined label: " + label,
            error:    label
          })
        }
      });
    });

    // Report errors found
    if (errors.length > 0) {
      return {
        message:              "Errors found in task nodes",
        error:                errors,
        parameterizedInput:   input
      }
    }

    // Utility to convert label to taskId
    var labelToTaskId = function(label) {
      // Look in tasks being prepared
      if (labelToInfo[label]) {
        return labelToInfo[label].taskId;
      }
      // Look in existing tasks
      var task = _.find(options.existingTasks, function(task) {
        return task.label === label;
      });

      if (!task) {
        debug("print: %j", labelToInfo);
        debug("Failed to find taskId of %s", label);
      }

      return task.taskId;
    };

    // Construct task JSON for Task.create()
    var tasks = input.tasks.map(function(taskNode) {
      // Find dependent tasks
      var label = taskNode.label;
      var dependents = input.tasks.filter(function(taskNode) {
        return _.contains(taskNode.requires, label);
      }).map(function(taskNode) {
        return taskNode.label;
      }).map(labelToTaskId);

      // Construct JSON for Task.create()
      return {
        taskGraphId:      options.taskGraphId,
        taskId:           labelToInfo[taskNode.label].taskId,
        version:          '0.2.0',
        label:            label,
        rerunsAllowed:    taskNode.reruns,
        rerunsLeft:       taskNode.reruns,
        deadline:         new Date(taskNode.task.deadline),
        requires:         taskNode.requires.map(labelToTaskId),
        requiresLeft:     taskNode.requires.map(labelToTaskId),
        dependents:       dependents,
        resolution:       null
      };
    });

    // Upload all tasks and return result from prepareTasks
    return Promise.all(input.tasks.map(function(taskNode) {
      return request
              .put(labelToInfo[taskNode.label].taskPutUrl)
              .send(taskNode.task)
              .end()
              .then(function(res) {
                if (!res.ok) {
                  debug("Failed to upload taskId: %s to PUT URL, Error: %s",
                        labelToInfo[taskNode.label].taskId, res.text);
                  throw new Error("Failed to upload task to put URLs");
                }
              });
    })).then(function() {
      // Find existing tasks that have new dependents and modify their
      // dependents property to include these
      return Promise.all(options.existingTasks.filter(function(task) {
        // Find existing tasks for which we have dependencies
        return _.some(input.tasks, function(taskNode) {
          return _.contains(taskNode.requires, task.label);
        });
      }).map(function(task) {
        // Modify task, so that it has the new dependents in it's list of
        // dependents
        return task.modify(function() {
          // Find new dependent tasks
          var newDependents = input.tasks.filter(function(taskNode) {
            return _.contains(taskNode.requires, task.label);
          }).map(function(taskNode) {
            return labelToInfo[taskNode].taskId;
          });

          // Add new dependent tasks to dependents
          this.dependents = this.dependents.concat(newDependents);
        });
      }));
    }).then(function() {
      return {
        input:    input,
        tasks:    tasks
      };
    });
  });
};

