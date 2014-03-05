var slugid  = require('../utils/slugid');
var uuid    = require('uuid');

// Test that we can encod and get 22 chars with /, + and =
exports.encodeTest = function(test) {
  test.expect(4);

  // Base64 of this one has / and +
  var uid = '804f3fc8-dfcb-4b06-89fb-aefad5e18754';

  // Encode
  var slug = slugid.encode(uid);

  // Test that it doesn't contain bad things
  test.ok(slug.indexOf('/') == -1, "Slug contains /");
  test.ok(slug.indexOf('+') == -1, "Slug contains +");
  test.ok(slug.indexOf('=') == -1, "Slug contains =");

  test.ok(slug.length == 22, "Length isn't 22");

  test.done()
};

// Test that we can encode and decode
exports.encodeDecodeTest = function(test) {
  test.expect(1);

  // Generate uuid
  var uid = uuid.v4();

  // Encode
  var slug = slugid.encode(uid);

  // Test that decode uuid matches original
  test.ok(slugid.decode(slug) == uid, "Encode and decode isn't identity");

  test.done();
};

// Test that we can encode and decode
exports.v4EncodeDecodeTest = function(test) {
  test.expect(5);

  // Generate slug
  var slug1 = slugid.v4();

  // Test that it doesn't contain bad things
  test.ok(slug1.indexOf('/') == -1, "Slug contains /");
  test.ok(slug1.indexOf('+') == -1, "Slug contains +");
  test.ok(slug1.indexOf('=') == -1, "Slug contains =");

  test.ok(slug1.length == 22, "Length isn't 22");

  // Decode slugid
  var uid = slugid.decode(slug1);

  // Encode
  var slug2 = slugid.encode(uid);

  // Test that decode uuid matches original
  test.ok(slug1 == slug2, "Encode and decode isn't identity");

  test.done();
};