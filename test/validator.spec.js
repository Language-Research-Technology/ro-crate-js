/* This is part of Calcyte a tool for implementing the DataCrate data packaging
spec.  Copyright (C) 2018  University of Technology Sydney

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

/*
The Root Data Entity MUST have the following properties: ["@type", "@id", "name", "description", "datePublished", "license"]

@type: MUST be [Dataset] or an array that contain Dataset
@id: SHOULD be the string ./ or an absolute URI (see below)
name: SHOULD identify the dataset to humans well enough to disambiguate it from other RO-Crates
description: SHOULD further elaborate on the name to provide a summary of the context in which the dataset is important.
datePublished: MUST be a string in [ISO 8601 date format][DateTime] and SHOULD be specified to at least the precision of a day, MAY be a timestamp down to the millisecond.
license: SHOULD link to a Contextual Entity or Data Entity in the RO-Crate Metadata Document with a name and description (see section on licensing). MAY, if necessary be a textual description of how the RO-Crate may be used.
*/

const assert = require('assert');
const {Validator, validate} = require('../lib/validator');
const chai = require('chai');
chai.use(require('chai-fs'));
const defaults = require('../lib/defaults');
const {ROCrate} = require('../lib/rocrate');

function hasClause(results, rule, id) {
  if (id) {
    results.some((r) => r.clause === rule.clause && rule.entity === id);
  }
  return results.some((r) => r.clause === rule.clause);
}

function hasMessage(results, messageId, status) {
  return results.some(r => r.id === messageId && r.status === status)
}

describe('Incremental checking', function () {
  it('should trigger all the right reporting', async function () {
    var validator = new Validator();
    validator.parseJSON('THIS IS NOT JSON IT IS A STRING');
    assert(
      hasMessage(validator.results, "validJson", "error"), "not a valid json"
    );
    assert(validator.crate === null);

    var validator = new Validator();
    validator.parseJSON(
      JSON.stringify({
        Something: ['THIS IS JSON but RO-Crate will not like it one bit'],
      })
    );
    // TODO -- Actually - RO Crate does not care -- need to add some more validation :)
    assert(
      hasMessage(validator.results, "validCrateNoGraph", "error", 'JSON Object does not have a @graph')
    );
    assert(
      hasMessage(
        validator.results,
        "validCrateInvalidKeys",
        "error"
      ),
      'JSON object contains keys other than @graph and @context'
    );

    //assert(validator.result.errors.length === 2);
    this.timeout(10000);
    var crate = new ROCrate();
    var json = crate.toJSON(); // should be a minimal viable datacrate
    json['@context'] = [];
    var validator = new Validator();
    validator.parseJSON(json)
    await validator.hasContext();
    assert(
      hasMessage(validator.results, "hasContext", "warning")
    );

    // Now with context
    json['@context'] = defaults.context;
    var validator = new Validator();
    validator.parseJSON(json);

    // Don't have a dataset tho yet

    // Check that the RootDatset exists
    var crate = new ROCrate();
    crate.rootDataset['@id'] = 'Nothing special';
    var validator = new Validator();
    validator.parseJSON(crate.toJSON());
    validator.rootDataEntity();

    assert(
      hasMessage(
        validator.results,
        "rootDataEntityId",
        "warning"
      ), 'Root Data Entity has appropriate @id. Is: Nothing special',
    );

    // Check that the Root Data Entity has the right @type
    var crate = new ROCrate();
    crate.rootDataset['@type'] = ['Nothing', 'Special'];
    var validator = new Validator();
    validator.parseJSON(crate.toJSON());
    validator.rootDataEntity();
    assert(
      hasMessage(
        validator.results,
        "rootDatasetType",
        "error"
      ), 'Root Data Entity has appropriate @id. Is: Nothing special',
    );

    // Check that the Root Data Entity has the right Type -- change the context so it doesn't
    var crate = new ROCrate();
    crate.addContext({Dataset: 'some:dodgy-definiton-of-dataset'});
    var validator = new Validator();
    validator.parseJSON(crate.toJSON());
    validator.rootDataEntity();
    assert(
      hasMessage(
        validator.results,
        "rootDatasetType",
        "error"
      ), 'Root Data Entity has appropriate @id. Is: Nothing special',
    );
    assert(
      hasMessage(
        validator.results,
        "rootDatasetType",
        "error"
      ), 'Root Data Entity has appropriate @id. Is: Nothing special',
    );

    // Check required props on Root Data Entity
    var crate = new ROCrate();
    var validator = new Validator();
    validator.parseJSON(crate.toJSON());
    validator.rootDataEntity();

    assert(
      hasMessage(validator.results, 'licenseRequired', 'error')
    );
    assert(
      hasMessage(validator.results, 'nameRequired', 'error')
    );
    assert(
      hasMessage(validator.results, 'descriptionRequired', 'error')
    );
    assert(
      hasMessage(validator.results, 'datePublishedRequired', 'error')
    );

    // Check required props on Root Data Entity are properly defined  -- and if the context is wrong then they are not
    var crate = new ROCrate();
    var validator = new Validator();
    validator.parseJSON(crate.toJSON());

    crate.addContext({
      name: 'some:dodgy-definiton-of-name',
      license: 'some:dodgy-definiton-of-license',
      description: 'some:dodgy-definiton-of-description',
      datePublished: 'some:dodgy-definiton-of-name',
    });
    crate.rootDataset.name = 'name';
    crate.rootDataset.description = 'description';
    crate.rootDataset.license = 'license';
    crate.rootDataset.datePublished = '1983';
    validator.rootDataEntity();

    assert(
      hasMessage(validator.results, 'licenseRequired', 'error')
    );
    assert(
      hasMessage(validator.results, 'nameRequired', 'error')
    );
    assert(
      hasMessage(validator.results, 'descriptionRequired', 'error')
    );
    assert(
      hasMessage(validator.results, 'datePublishedRequired', 'error')
    );

    // Check required props on Root Data Entity are properly defined
    var crate = new ROCrate();
    crate.rootDataset.name = 'name';
    crate.rootDataset.description = 'description';
    crate.rootDataset.license = 'bad license';
    crate.rootDataset.datePublished = '1983';
    var validator = new Validator();
    validator.parseJSON(crate.toJSON());
    validator.rootDataEntity();

    assert(
      hasMessage(validator.results, 'licenseRequired', 'success')
    );
    assert(
      hasMessage(validator.results, 'nameRequired', 'success')
    );
    assert(
      hasMessage(validator.results, 'descriptionRequired', 'success')
    );
    assert(
      hasMessage(validator.results, 'datePublishedRequired', 'success')
    );
  });
  
});


describe('File Validation', function () {
  it('check for file references', async function () {
    const crate = new ROCrate({array: true});
    //Add a reference to a non-existent entity
    crate.rootDataset.hasPart = [{"@id": "/some/path/to/a/file.txt"}];

    var files = {};
    const results = await validate(crate, files);
    assert(results.length > 0);
    assert(results.find(result =>
      result.id === 'validCrateDataEntityPath' && result.status === 'error'
    ) !== -1, 'error recorded in validCrateDataEntityPath array');
  });

  it('should trigger all the right reporting', async function () {
    var validator = new Validator();

    var crate = new ROCrate({array: true});
    crate.rootDataset.hasPart = [{"@id": "/some/path/to/a/file.txt", "@type": "File"}];

    var validator = new Validator();
    validator.parseJSON(crate.toJSON());
    var result = validator.validate();
    var files = {}; // Pretend we have no files
    validator.checkFiles(files);
    assert(!files["/some/path/to/a/file.txt"].exists)
    assert(files["/some/path/to/a/file.txt"].inCrate)

    // Now add a directory
    crate.rootDataset.hasPart = [{"@id": "/some/path", "@type": "Dataset"}];
    // And file that aint in it
    crate.rootDataset.hasPart = [{"@id": "/someother/path/file", "@type": "File"}];

    validator.parseJSON(crate.toJSON());
    validator.checkFiles(files);
    files["/some/path"].isDir = true;
    files["/some/path"].exists = true;
    validator.checkFiles(files);

    assert(files["/some/path/to/a/file.txt"].dirDescribed)
    assert(!files["/someother/path/file"].dirDescribed)

    let errors = 0;
    for (let result of validator.results) {
      if (result.id === 'validCrateDataEntityPath' && result.status === 'error') {
        errors++;
      }
    }
    assert.strictEqual(errors, 3);

  });

  it('should allow empty hasPart', async function () {
    var crate = new ROCrate({array: true});
    const files = {};
    const results = await validate(crate, files);
    assert.strictEqual(Object.keys(files).length, 0);
  });
});



