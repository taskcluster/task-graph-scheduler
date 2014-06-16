module.exports = {
  scheduler: {
    schedulerId:                  'test-scheduler',

    taskGraphTableName:           'TestTaskGraphs',

    publishMetaData:              'false',

    exchangePrefix:               'scheduler/v1/',

    listenerQueueName:            undefined,
  },

  server: {
    publicUrl:                      'http://localhost:3030',
    port:                           3030
  },

  // Use local AMQP installation
  amqp: {
    url:                          'amqp://guest:guest@localhost:5672'
  },

  aws: {
    region:                       'us-west-2'
  }
};