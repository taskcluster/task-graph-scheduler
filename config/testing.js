module.exports = {
  scheduler: {
    schedulerId:                  'test-scheduler',

    taskGraphTableName:           'TestTaskGraphs',

    publishMetaData:              'false',

    exchangePrefix:               'tests/scheduler/v1/',

    listenerQueueName:            undefined,
  },

  server: {
    publicUrl:                      'http://localhost:3030',
    port:                           3030
  },

  aws: {
    region:                       'us-west-2'
  }
};