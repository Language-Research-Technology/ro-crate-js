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
The Root Data Entity MUST have the following properties:

@type: MUST be [Dataset] or an array that contain Dataset
@id: SHOULD be the string ./ or an absolute URI (see below)
name: SHOULD identify the dataset to humans well enough to disambiguate it from other RO-Crates
description: SHOULD further elaborate on the name to provide a summary of the context in which the dataset is important.
datePublished: MUST be a string in [ISO 8601 date format][DateTime] and SHOULD be specified to at least the precision of a day, MAY be a timestamp down to the millisecond.
license: SHOULD link to a Contextual Entity or Data Entity in the RO-Crate Metadata Document with a name and description (see section on licensing). MAY, if necessary be a textual description of how the RO-Crate may be used.




*/

const assert = require("assert");
const {Checker} = require("../lib/checker");
const chai = require("chai");
chai.use(require("chai-fs"));
const defaults = require("../lib/defaults");
const {ROCrate} = require("../lib/rocrate");

describe("Incremental checking", async function () {
  it("should trigger all the right reporting", async function () {
    this.timeout(10000);
    //json = JSON.parse(fs.readFileSync("test_data/sample-ro-crate-metadata.jsonld"));
    var crate = new ROCrate();
    var json = crate.toJSON(); // should be a minimal viable datacrate
    json["@context"] = [];
    var checker = new Checker(new ROCrate(json));
    assert(!(await checker.hasContext()).status, "Does not have a @context");
    // Now with context
    json["@context"] = defaults.context;
    var checker = new Checker(new ROCrate(json));
    assert((await checker.hasContext()).status, "Has a @context");
    // Don't have a dataset tho yet

    var checker = new Checker(new ROCrate(json));
    assert(checker.hasRootDataset().status, "Does have a root dataset");
    // No name yet
    assert(!checker.hasName().status, "Does not have a name");
    //var dataset = crate.getRootDataset();
    var dataset = json["@graph"][0];
    dataset.name = "";


    var checker = new Checker(new ROCrate(json));
    assert(!checker.hasName().status, "Does not have a name");
    dataset.name = "Name!";

    var checker = new Checker(new ROCrate(json));
    assert(checker.hasName().status, "Does have a name");


    var checker = new Checker(new ROCrate(json));
    assert(!checker.hasDescription().status, "Does not have a description");
    dataset.description = "Description!";

    var checker = new Checker(new ROCrate(json));
    assert(checker.hasName().status, "Does have a description");

    // License
    // No name, description
    console.log(checker.hasLicense());
    assert(
      !checker.hasLicense().status,
      "Has a license"
    );

    var license = {
      "@id": "http://example.com/some_kind_of_license",
      "@type": "CreativeWork",
      URL: "http://example.com/some_kind_of_license",
    };
    dataset.license = { "@id": license["@id"] };

    json["@graph"].push(license);
    crate = new ROCrate(json);
    var checker = new Checker(crate);
    assert(
      checker.hasLicense().status,
      "Has a license"
    );

    license.name = "Some license";
    license.description = "Description of at least 20 characters.";

    assert(
      checker.hasLicense().status,
      "Has a license"
    );

    // datePublished
    assert(
      !checker.hasDatePublished().status,
      "Does not have a datePublished"
    );


    crate.rootDataset.datePublished = "2017"; // Not enough detail!
    assert(
      checker.hasDatePublished().status,
    );

    crate.rootDataset.datePublished = ["2017-07-21", "2019-08-09"]; 
    assert(
      !checker.hasDatePublished().status,
      "Does not have a single datePublished"
    );

    crate.rootDataset.datePublished = ["2017-07-21"]; // this should do it
    assert(checker.hasDatePublished().status, "Does have a datePublished");

    

    await checker.check();
    console.log(checker.report());
  });
});

after(function () {
  //TODO: destroy test repoPath
});
