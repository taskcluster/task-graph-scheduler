var config          = require('../config');
var debug           = require('debug')('tests:listener');
var request         = require('superagent');
var Promise         = require('promise');
var nconf           = require('nconf');
var amqp            = require('amqp');
var util            = require('util');
var EventEmitter    = require('events').EventEmitter;

config.load();

/** Listen to an exchange emits the 'message' event on messages */
var Listener = function(exchange) {
  // Construct superclass
  EventEmitter.call(this);

  this.exchange = exchange;
};

// Inherit from EventEmitter
util.inherits(Listener, EventEmitter);

/** Setup listener return a promise of success */
Listener.prototype.setup = function() {
  var that = this;
  // Fetch connection string from queue
  var fetched_connection_string = new Promise(function(accept, reject) {
    request
      .get(nconf.get('queue:baseUrl') + '/v1/settings/amqp-connection-string')
      .end(function(res) {
        if (!res.ok) {
          debug("Failed to get connection string from queue");
          return reject(res.body);
        }
        accept(res.body.url);
      });
  });

  // Create a connection
  var conn = null;
  var connected = fetched_connection_string.then(function(connectionString) {
    return new Promise(function(accept, reject) {
      // Create connection
      debug("Creating new AMQP connection!");
      conn = amqp.createConnection({url: connectionString});
      conn.on('ready', accept);
    });
  })

  var queue = null;
  var subscribed = connected.then(function() {
    return new Promise(function(accept, reject) {
      debug('Create exclusive queue');
      queue = conn.queue("", {
        passive:                    false,
        durable:                    false,
        exclusive:                  true,
        autoDelete:                 true,
        closeChannelOnUnsubscribe:  true
      }, function() {
        debug('Subscribe to messages on queue');
        queue.subscribe(function(message) {
          debug("Listener following message:", message);
          that.emit('message', message);
        });
        debug('Bind queue to exchange');
        queue.bind(
          that.exchange,
          '_._._._._._.' + nconf.get('scheduler:taskGraphSchdulerId') + '.#',
          function() {
            accept();
          }
        );
      });
    });
  });

  return subscribed.then(function() {
    that.queue = queue;
    that.conn = conn;
  })
};

Listener.prototype.destroy = function() {
  this.queue.destroy();
  this.conn.destroy();
};

module.exports = Listener;