/* This is part of rocrate-js a node library for implementing the RO-Crate data
packaging spec. Copyright (C) 2019 University of Technology Sydney

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

const fs = require("fs");
const assert = require("assert").strict;
const _ = require('lodash');
const expect = require("chai").expect;
const ROCrate = require("../lib/rocrate");
const utils = require("../lib/utils");
const defaults = require("../lib/defaults");
const uuid = require('uuid').v4;
const { create } = require("lodash");


function newCrate(graph) {
  if (!graph) { graph = [defaults.datasetTemplate, defaults.metadataFileDescriptorTemplate] };
  return new ROCrate({ '@context': defaults.context, '@graph': graph });
}
/** @type ROCrate */
var testData = JSON.parse(fs.readFileSync("test_data/simple-test.json"));


describe("ROCrate Create new graph", function () {
  it("can create a new empty graph using defaults", function () {
    let crate = new ROCrate();
    //assert.deepStrictEqual(crate.json_ld['@context'], defaults.context);
    //assert.deepStrictEqual(crate.json_ld['@graph'], [defaults.datasetTemplate,defaults.metadataFileDescriptorTemplate]);
  });

  it("can create a new graph using existing jsonld", function () {
    let crate = new ROCrate(testData);
    assert.strictEqual(crate.getGraph().length, 9);
    //assert.deepStrictEqual(crate.json_ld, json);
  });
});

describe("ROCrate get entity", function () {
  it("can get a raw entity", function () {
    let crate = new ROCrate(testData);
    let e = crate.getEntity('https://orcid.org/0000');
    assert.strictEqual(e.name, "John Doe");
    assert.ok(crate.hasType(e, "Person"));
    assert.strictEqual(e.contactPoint['@id'], "john.doe@uq.edu.au");
    assert.strictEqual(Object.keys(e.contactPoint).length, 1);
  });

  it("can get an linked entity", function () {
    let crate = new ROCrate(testData, { resolveLinks: true });
    let e = crate.getEntity('https://orcid.org/0000');
    assert.strictEqual(e.contactPoint.email, "john.doe@uq.edu.au");
    assert.strictEqual(e.contactPoint.contactType, "support");
    assert.strictEqual(e.contactPoint.availableLanguage[0].name, "English");
  });

  it("can get property always as array", function () {
    let crate = new ROCrate(testData, { resolveLinks: true, alwaysAsArray: true });
    let e = crate.getEntity('https://orcid.org/0000');
    assert.strictEqual(e.name[0], "John Doe");
  });
});

describe("AddValues", function () {

  it("cannot add @id", function () {
    let crate = new ROCrate(testData);
    crate.addValues("./", "@id", "test");
    assert.strictEqual(crate.getProperty("./", "@id"), "./");
  });

  it("can add values allowing duplicates", function () {
    let crate = new ROCrate(testData);
    let e = crate.getEntity('./');
    assert.strictEqual(e.author['@id'], "https://orcid.org/0000");
    crate.addValues(e, "author", { "@id": "https://orcid.org/0000" }, true);
    assert.strictEqual(e.author.length, 2);
    assert.strictEqual(e.author[0]['@id'], "https://orcid.org/0000");
    assert.strictEqual(e.author[1]['@id'], "https://orcid.org/0000");
    crate.addValues(e, "keywords", "Test", true);
    assert.strictEqual(e.keywords[1], "Test");
    crate.addValues(e, "keywords", ["Test"], true);
    crate.addValues(e, "keywords", ["Test", "Test"], true);
    assert.strictEqual(e.keywords.length, 5);
    assert.strictEqual(e.keywords[2], "Test");
    assert.strictEqual(e.keywords[3], "Test");
    assert.strictEqual(e.keywords[4], "Test");
  });

  it("can add values without duplicate", function () {
    let crate = new ROCrate(testData);
    let e = crate.getEntity('./');
    assert.strictEqual(e.author['@id'], "https://orcid.org/0000");
    crate.addValues(e, "author", { "@id": "https://orcid.org/0000" });
    assert.strictEqual(e.author['@id'], "https://orcid.org/0000");
    crate.addValues(e, "author", { "@id": "https://orcid.org/0001" });
    assert.strictEqual(e.author.length, 2);
    assert.strictEqual(e.author[0]['@id'], "https://orcid.org/0000");
    assert.strictEqual(e.author[1]['@id'], "https://orcid.org/0001");
    crate.addValues(e, "keywords", "Test");
    crate.addValues(e, "keywords", ["Test"]);
    crate.addValues(e, "keywords", ["Test", "Test"]);
    assert.strictEqual(e.keywords, "Test");
    crate.addValues(e, "keywords", ["Test1", "Test2"]);
    assert.strictEqual(e.keywords[1], "Test1");
    assert.strictEqual(e.keywords[2], "Test2");
  });

  it("it can add a new entity to a property (nested objects)", function () {
    const crate = new ROCrate(testData);
    const root = crate.rootDataset;
    const newAuthor = {
      "@id": "#pt",
      "name": "Petie",
      "affiliation": [
        { "@id": "#home", "name": "home" },
        { "@id": "#home2", "name": "home2" }]
    };
    crate.addValues(root, "author", newAuthor)
    assert.equal(crate.getEntity("#pt").name, "Petie");
    assert.equal(crate.getEntity("#pt").affiliation[1]['@id'], "#home2");
    assert.equal(crate.getEntity("#home").name, "home");
    assert.equal(crate.getEntity("#home2").name, "home2");

  });

  it("generate correct @reverse nodes", function () {
    const crate = new ROCrate(testData);
    const root = crate.rootDataset;
    const e1 = crate.getEntity("https://orcid.org/0000");
    assert.equal(e1['@reverse'].author['@id'], "./");
    const e2 = crate.getEntity("#lang-es");
    assert.equal(e2['@reverse'].availableLanguage['@id'], "john.doe@uq.edu.au");
  });

});

describe("Context", function () {
  it("can return locally defined properties and classes", async function () {

    // const crate2 = new ROCrate(JSON.parse(j));
    // var c = await crate2.resolveContext();
    // assert.equal(c.getDefinition("name")["@id"], "http://schema.org/name");
  });
});

/*
{
author: [{@id: 1, @reverse:{author:[{@id:0}]}},{@id: 2, @reverse:{author:[]}}]
}
{
  @id: 1
  name: a
}
*/

// add entity with references to other entities
	// other entity exists
	// other entity does not exists

// check for stray objects, object inserted as a property of another object
// test nested
// test propery as array
// test clean up @reverse property

// test get graph
// validate jsonld in constructor
// check deleted node

// create @reverse index  ['@reverse'].name = [ parentobj1, parentobj2]
// check for add, get, delete operations

// test duplicate

// check assigning an array of plain objects or entity proxy objects to a property
// getnormalisedtree check circular