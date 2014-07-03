suite('jsonsubs', function() {
  var jsonsubs  = require('../utils/jsonsubs');
  var assert    = require('assert');

  test('substitute string', function() {
    var template = "Hello {{key}}";
    var params = {
      key: "World"
    };
    var result = jsonsubs(template, params);

    assert(result == "Hello World");
  });

  test('substitute key', function() {
    var template = {"Hello {{key}}": 42};
    var params = {
      key: "World"
    };
    var result = jsonsubs(template, params);

    assert(result["Hello World"] === 42);
  });

  test('substitute array', function() {
    var template = ["Hello {{key}}", 42];
    var params = {
      key: "World"
    };
    var result = jsonsubs(template, params);

    assert(result instanceof Array);
    assert(result[0] == "Hello World");
  });

  test('ignore undefined', function() {
    var template = "Hello {{key}}";
    var params = {};
    var result = jsonsubs(template, params);

    assert(result === "Hello {{key}}");
  });
});
