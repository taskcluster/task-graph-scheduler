var jsonsubs  = require('../utils/jsonsubs');

exports.substituteStringTest = function(test) {
  test.expect(1);

  var template = "Hello {{key}}";
  var params = {
    key: "World"
  };
  var result = jsonsubs(template, params);

  test.ok(result == "Hello World");

  test.done()
};

exports.substituteKeyTest = function(test) {
  test.expect(1);

  var template = {"Hello {{key}}": 42};
  var params = {
    key: "World"
  };
  var result = jsonsubs(template, params);

  test.ok(result["Hello World"] === 42);

  test.done()
};

exports.substituteArrayTest = function(test) {
  test.expect(2);

  var template = ["Hello {{key}}", 42];
  var params = {
    key: "World"
  };
  var result = jsonsubs(template, params);

  test.ok(result instanceof Array);
  test.ok(result[0] == "Hello World");

  test.done()
};

exports.ignoreUndefinedTest = function(test) {
  test.expect(1);

  var template = "Hello {{key}}";
  var params = {};
  var result = jsonsubs(template, params);

  test.ok(result === "Hello {{key}}");

  test.done()
};
