var base        = require('taskcluster-base');
var assert      = require('assert');
var Promise     = require('promise');

/** Entity type for representation of a task-graph */
var TaskGraph = base.Entity.configure({
  version:            1,
  partitionKey:       base.Entity.StringKey('taskGraphId'),
  rowKey:             base.Entity.ConstantKey('task-graph'),
  properties: {
    taskGraphId:      base.Entity.types.SlugId,
    requires:         base.Entity.types.SlugIdArray,
    requiresLeft:     base.Entity.types.SlugIdArray,
    state:            base.Entity.types.String,
    routes:           base.Entity.types.JSON,
    scopes:           base.Entity.types.JSON,
    details:          base.Entity.types.JSON
  },
  context:            ['schedulerId']
});

/** Get task-graph status structure */
TaskGraph.prototype.status = function() {
  return {
    taskGraphId:    this.taskGraphId,
    schedulerId:    this.schedulerId,
    state:          this.state
  };
};

/**
 * Overwrite Entity.setup to support the additional configuration key
 * `schedulerId`, so that this can be configured dynamically.
 */
TaskGraph.setup = function(setup) {
  assert(options.schedulerId, "schedulerId must be given!");

  // Configure class as Entity.configure would
  var Class = base.Entity.setup.call(this, options);

  // Add property schedulerId
  Class.prototype.schedulerId = options.schedulerId;

  // Return configured class
  return Class;
};

// Export TaskGraph
exports.TaskGraph = TaskGraph;

/** Entity type of representation of a task within a task-graph */
var Task = base.Entity.configure({
  version:            1,
  partitionKey:       base.Entity.StringKey('taskGraphId'),
  rowKey:             base.Entity.StringKey('taskId'),
  properties: {
    taskGraphId:      base.Entity.types.SlugId,
    taskId:           base.Entity.types.SlugId,
    rerunsAllowed:    base.Entity.types.Number,
    rerunsLeft:       base.Entity.types.Number,
    deadline:         base.Entity.types.Date,
    requires:         base.Entity.types.SlugIdArray,
    requiresLeft:     base.Entity.types.SlugIdArray,
    dependents:       base.Entity.types.SlugIdArray,
    state:            base.Entity.types.String,
    details:          base.Entity.types.JSON
  }
});





/** Configure a task Entity subclass */
var Task = base.Entity.configure({
  mapping: [
    {
      key:                  'PartitionKey',
      property:             'taskGraphId',
      type:                 'string'
    }, {
      key:                  'RowKey',
      property:             'taskId',
      type:                 'string'
    },
    {key: 'version',        type: 'number'  },
    {key: 'rerunsAllowed',  type: 'number'  },
    {key: 'rerunsLeft',     type: 'number'  },
    {key: 'deadline',       type: 'date'    },
    {key: 'requires',       type: 'json'    },
    {key: 'requiresLeft',   type: 'json'    },
    {key: 'dependents',     type: 'json'    },
    {key: 'state',          type: 'string'  },
    {key: 'details',        type: 'json'    }
  ]
});

/** Create a task */
Task.create = function(properties) {
  return base.Entity.create.call(this, properties);
};

/** Load task from taskGraphId and taskId */
Task.load = function(taskGraphId, taskId) {
  return base.Entity.load.call(this, taskGraphId, taskId);
};

/** Load all tasks for a given task-graph */
Task.loadGraphTasks = function(taskGraphId) {
  var Class = this;
  assert(Class,     "Entity.create must be bound to an Entity subclass");
  var client    = Class.prototype._azClient;
  var tableName = Class.prototype._azTableName;
  var mapping   = Class.prototype.__mapping;
  assert(client,    "Azure credentials not configured");
  assert(tableName, "Azure tableName not configured");
  assert(mapping,   "Property mapping not configured");

  // Serialize RowKey
  partitionKey = mapping.PartitionKey.serialize(taskGraphId);

  return new Promise(function(accept, reject) {
    var entities = [];
    var fetchNext = function(continuationTokens) {
      client.queryEntities(tableName, {
        query:        azureTable.Query.create()
                        .where('PartitionKey', '==', partitionKey)
                        .and('RowKey', '!=', ROW_KEY_CONST),
        forceEtags:   true,
        continuation: continuationTokens
      }, function(err, data, continuationTokens) {
        // Reject if we hit an error
        if (err) {
          return reject(err);
        }
        // Create wrapper for each entity fetched
        entities.push.apply(entities, data.map(function(entity) {
          return new Class(entity);
        }));

        // If there are no continuation tokens then we accept data fetched
        if (!continuationTokens) {
          return accept(entities);
        }
        // Fetch next set based on continuation tokens
        fetchNext(continuationTokens);
      });
    }
    fetchNext(undefined);
  });
};

// Export Task
exports.Task = Task;