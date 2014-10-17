module.exports = {
  scheduler: {
    schedulerId:                  'dummy-test-scheduler',

    taskGraphTableName:           'DummyTestTaskGraphs',

    publishMetaData:              'false',

    exchangePrefix:               'dummy-test-scheduler/scheduler/v1/',

    listenerQueueName:            undefined,
  },

  taskcluster: {
    authBaseUrl:                  'http://localhost:60072/v1',
    credentials: {
      clientId:                   undefined,
      accessToken:                undefined
    }
  },

  server: {
    publicUrl:                    'http://localhost:60071',
    port:                         60071
  },

  pulse: {
    username:                       undefined,
    password:                       undefined
  },

  aws: {
    region:                       'us-west-2'
  }
};