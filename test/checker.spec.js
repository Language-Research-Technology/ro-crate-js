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

const assert = require("assert");
const {Checker} = require("../lib/checker");
const chai = require("chai");
chai.use(require("chai-fs"));
const defaults = require("../lib/defaults");
const {ROCrate} = require("../lib/rocrate");

describe("Incremental checking", async function () {
  it("should trigger all the right reporting", async function () {
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
    assert(!checker.hasAuthor().status, "Does not have author");

    // Author
    var author1 = {
      "@id": "http://orcid.org/some-orcid",
      name: "Some Person",
    };
    dataset.author = [{ "@id": "http://orcid.org/some-orcid" }];
    json["@graph"].push(author1);
    var checker = new Checker(new ROCrate(json));
    assert(
      !checker.hasAuthor().status,
      "Does not have one or more authors with @type Person or Organization"
    );

    // One good author and one dodgy one
    var author2 = {
      "@id": "http://orcid.org/some-other-orcid",
      name: "Some Person",
      "@type": "Person",
    };
    dataset.author = [{ "@id": "http://orcid.org/some-orcid" }, { "@id": "http://orcid.org/some-other-orcid" }];
    json["@graph"].push(author1, author2);
    var checker = new Checker(new ROCrate(json));
    assert(
      !checker.hasAuthor().status,
      "Does not have one or more authors with @type Person or Organization"
    );

    // One good author
    dataset.author = [author2];
    json["@graph"] = [
      defaults.metadataFileDescriptorTemplate,
      dataset,
      author2,
    ];
    var checker = new Checker(new ROCrate(json));
    assert(
      checker.hasAuthor().status,
      "Does have a author with @type Person or Organization"
    );

    // License
    // No name, description
    assert(
      !checker.hasLicense().status,
      "Does not have a license with @type CreativeWork"
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
      "Has a license with @type CreativeWork"
    );
    license.name = "Some license";
    license.description = "Description of at least 20 characters.";

    assert(
      checker.hasLicense().status,
      "Does have a license with @type CreativeWork and a name and description"
    );

    // datePublished
    assert(
      !checker.hasDatePublished().status,
      "Does not have a datePublished"
    );
    crate.rootDataset.datePublished = "2017"; // Not enough detail!
    assert(
      !checker.hasDatePublished().status,
      "Does not have a datePublished (not enough detail)"
    );

    crate.rootDataset.datePublished = ["2017-07-21", "2019-08-09"]; // this should do it
    assert(
      !checker.hasDatePublished().status,
      "Does not have a single datePublished"
    );

    crate.rootDataset.datePublished = ["2017-07-21"]; // this should do it
    assert(checker.hasDatePublished().status, "Does have a datePublished");

    //contactPoint missing
    assert(
      !checker.hasContactPoint().status,
      "Does not have  a single contact point"
    );
    var contact = {
      "@id": "some.email@example.com",
      "@type": "ContactPoint",
    }; // Not enough
    dataset.contactPoint = [{ "@id": "some.email@example.com" }];
    json["@graph"].push(contact);
    var checker = new Checker(new ROCrate(json));
    assert(
      !checker.hasContactPoint().status,
      "Does not have   a contact point with enough properties"
    );
    contact.contactType = "customer service";
    contact.email = "some@email"; // TODO: Not validated!
    var checker = new Checker(new ROCrate(json));
    assert(
      checker.hasContactPoint().status,
      "Does have a proper contact point"
    );

    await checker.check();
    //console.log(checker.report());
  });
});

after(function () {
  //TODO: destroy test repoPath
});
