const {ROCrate} = require('./lib/rocrate.js');
const {Checker} = require('./lib/checker.js');
const {Utils} = require('./lib/utils.js');
const {Validator, validate} = require('./lib/validator.js');
const Defaults = require('./lib/defaults.js');

module.exports = {
  ROCrate,
  Checker,
  Utils,
  Validator,
  validate,
  Defaults,
};

// module.exports = {
//   ROCrate: require('./lib/rocrate.js'),
//   Checker: require('./lib/checker.js'),
//   Utils: require('./lib/utils.js'),
//   Defaults: require('./lib/defaults.js')
// }
