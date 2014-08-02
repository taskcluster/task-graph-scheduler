module.exports = {
  scheduler: {
    schedulerId:                  'dummy-test-scheduler',

    taskGraphTableName:           'DummyTestTaskGraphs',

    publishMetaData:              'false',

    exchangePrefix:               'dummy-test-scheduler/scheduler/v1/',

    listenerQueueName:            undefined,
  },

  taskcluster: {
    authBaseUrl:                  'http://localhost:1210/v1',
    credentials: {
      clientId:                   undefined,
      accessToken:                undefined
    }
  },

  server: {
    publicUrl:                    'http://localhost:1209',
    port:                         1209
  },

  amqp: {
    url:                          undefined
  },

  aws: {
    region:                       'us-west-2'
  }
};