var Promise     = require('promise');
var Task        = require('./data').Task;
var TaskGraph   = require('./data').TaskGraph;
var debug       = require('debug')('scheduler:handlers');

/*
  Task completed successfully (B):
    - Scan through dependent tasks updating their requires
        (if dependent is missing ignore, it)
      - If setting requires = [] schedule the task
      - If setting requires = [] for task-graph entry:
        - Post message that task-graph is finished
    - Ack completed message
  Task completed unsuccessfully (C):
    - If reruns != 0:
      - Schedule a rerun with the queue
      - Decrement reruns
      - Ack completed message
    - Else, do the "Task failed" operation
  Task failed (D):
    - Set 'task-graph' entry state to blocked
    - Post message that task-graph is now blocked
    - Ack message

*/



/**
 * Handle notifications of failed messages
 * `events.setup()` will take care of subscribing to a queue, bind to exchanges
 * and invoke this method with messages. This method should return a promise
 * of success, if the promise fails the message will be rejected and requeued.
 */
exports.failed = function(message) {};

/**
 * Handle notifications of completed messages
 * `events.setup()` will take care of subscribing to a queue, bind to exchanges
 * and invoke this method with messages. This method should return a promise
 * of success, if the promise fails the message will be rejected and requeued.
 */
exports.completed = function(message) {};


// Task completed successfully
var taskSuccess = function (taskGraphId, taskId, message) {

  var task_loaded = Task.load(taskGraphId, taskId);

  // Task loaded
  task_loaded.then(function(task) {
    return Promise.all(task.dependents.map(function(depTaskId) {
      var dep_task_loaded = Task.load(taskGraphId, depTaskId);

      return dep_task_loaded.then(function(depTask) {
        return depTask.modify(function() {
          if (!_.contains(this.requires, taskId)) {
            return;
          }
          this.requires = _.without(this.requires, taskId);
          if (this.requires.length == 0) {
            return scheduleTask(depTask.taskId);
          }
        });
      });
    })).then(function() {
      task.modify(function() {
        this.resolution = {
          resultUrl:  message.resultUrl,
          logsUrl:    message.logsUrl,
          success:    true
        };
      });
    });
  })

};

/*








*/