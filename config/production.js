module.exports = {
  scheduler: {
    schedulerId:                  'task-graph-scheduler',

    taskGraphTableName:           'TaskGraphs',

    exchangePrefix:               'scheduler/v1/',

    listenerQueueName:            'task-graph-scheduler/event-queue'
  },

  server: {
    publicUrl:                      'https://scheduler.taskcluster.net',

    port:                           80
  }
};
