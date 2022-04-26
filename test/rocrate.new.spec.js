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
    // test with data in which the rooId is not "./"
    var testData2 = JSON.parse(fs.readFileSync("test_data/ro-crate-metadata.json"));
    crate = new ROCrate(testData2, {alwaysAsArray: true, resolveLinks: true});
    assert.strictEqual(crate.rootId, testData2["@graph"][1].about["@id"]);
    assert.strictEqual(crate.rootDataset.name[0], testData2["@graph"][0].name);
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

describe("Mutators", function () {
  it("can correctly update existing entity", function () {
    let crate = new ROCrate(testData);
    let e0 = {'@id': 'https://orcid.org/0000', name: 'test0' };
    let e1 = {'@id': 'https://orcid.org/0001', name: 'test1' }
    assert.equal(crate.getEntity('https://orcid.org/0000').name, "John Doe");
    crate.updateEntity(e0);
    assert.equal(crate.getEntity(e0['@id']).name, e0.name);
    crate.updateEntity(e1);
    assert.ok(!crate.getEntity(e1['@id']));
  });

  it("can rename IDs", function () {
    let crate = new ROCrate(testData);

    const parent = crate.getEntity("https://orcid.org/0000");
    const child = crate.getEntity("john.doe@uq.edu.au")
    assert.equal(child['@id'], "john.doe@uq.edu.au")
    assert.equal(child['@id'], parent.contactPoint['@id']);
    crate.updateEntityId(child, "jane.doe@uq.edu.au");
    assert.equal(child['@id'], "jane.doe@uq.edu.au")
    assert.equal(child['@id'], parent.contactPoint['@id']);
  });

  it("can rename root ID", function () {
    let crate = new ROCrate(testData);
    //let crate = new ROCrate(testData, { resolveLinks: true, alwaysAsArray: true });

    assert.equal(crate.rootId, "./")
    crate.updateEntityId(crate.rootId, "#root");
    assert.equal(crate.rootId, "#root");
    assert.equal(crate.rootDataset['@id'], "#root");
    crate.rootId = "#root2"
    assert.equal(crate.rootId, "#root2");
    assert.equal(crate.rootDataset['@id'], "#root2");
    crate.rootDataset['@id'] = "#root3"
    assert.equal(crate.rootId, "#root3");
    assert.equal(crate.rootDataset['@id'], "#root3");
    assert.equal(crate.metadataFileEntity.about['@id'], "#root3");
  });

  it("can correctly assign existing entity", function () {
    let crate = new ROCrate(testData);
    crate.metadataFileEntity.about = crate.rootDataset;
    data = crate.toJSON();
    assert.equal(Object.keys(data['@graph'][0].about).length, 1);
  });
  
  it("can correctly add Identifier", function () {
    let crate = new ROCrate(testData);
    let identifier = {name:"test", identifier:"undefined"};
    let entityId = `_:local-id:${identifier.name}:${identifier.identifier}`;
    crate.addIdentifier(identifier);
    assert.ok(crate.getEntity(entityId));
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

  it("can add a new entity to a property (nested objects)", function () {
    const crate = new ROCrate(testData);
    const root = crate.rootDataset;
    const newAuthor = {
      "@id": "#pt",
      "name": "Petie",
      "affiliation": [
        { "@id": "#home", "name": "home" },
        { "@id": "#home2", "name": "home2" }],
      "contactPoint": {
        "@id": "pete@uq.edu.au",
        "@type": "ContactPoint",
        "email": "pete@uq.edu.au",
        "availableLanguage": [
          { "@id": "#lang-en" },
          { "@id": "#lang-fr", "@type": "Language", name: "French" }
        ]
      }
    };
    assert.equal(crate.graphLength, 9);
    crate.addValues(root, "author", newAuthor);
    assert.equal(crate.graphLength, 14);
    assert.equal(crate.getEntity("#pt").name, "Petie");
    assert.equal(crate.getEntity("#pt").affiliation[1]['@id'], "#home2");
    assert.equal(crate.getEntity("#home").name, "home");
    assert.equal(crate.getEntity("#home2").name, "home2");
    assert.equal(crate.getEntity("#lang-fr").name, "French");
    //console.log(crate.getGraph(true)[12]);
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

describe("getTree", function () {
  it("can generate a tree from any node", function () {
    const crate = new ROCrate(testData);
    const root = crate.getTree({ root: 'https://orcid.org/0000' });
    assert.equal(root.name[0]['@value'], "John Doe");
    assert.equal(root.contactPoint[0].contactType[0]['@value'], "support");
    assert.equal(root.contactPoint[0].availableLanguage[1].name[0]['@value'], "Spanish");
  });
  it("can generate a tree without circular dependencies", function () {
    const crate = new ROCrate(testData);
    crate.addValues('#lang-en', 'subjectOf', { '@id': 'ro-crate-metadata.jsonld' });
    const root = crate.getTree();
    assert.equal(root.author[0].contactPoint[0].email[0]['@value'], root.contactPoint[0].email[0]['@value']);
    const s = JSON.stringify(root);
    assert.equal(root.contactPoint[0].availableLanguage[0].subjectOf[0].about[0]['@id'], './');
  });
});

describe("toJSON", function () {
  it("can return an array of plain flat entities", function () {
    let crate = new ROCrate(testData);
    const lang_fr = { '@id': '#lang-fr', "@type": "Language", name: "French" };
    crate.addValues("john.doe@uq.edu.au", "availableLanguage", lang_fr);
    let i = crate.getEntityIndex("john.doe@uq.edu.au");
    let data = crate.toJSON();
    assert.equal(Object.keys(data['@graph'][0].about).length, 1);
    assert.equal(Object.keys(data['@graph'][i].availableLanguage[2]).length, 1);

    // test with resolveLinks enabled
    crate = new ROCrate(testData, { alwaysAsArray: true, resolveLinks: true });
    crate.addValues("john.doe@uq.edu.au", "availableLanguage", lang_fr);
    i = crate.getEntityIndex("john.doe@uq.edu.au");
    data = crate.toJSON();
    assert.equal(Object.keys(data['@graph'][0].about).length, 1);
    assert.equal(Object.keys(data['@graph'][i].availableLanguage[2]).length, 1);
    //console.log(JSON.stringify(data, null, 2));
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

// pushing value to array of property
// get disconnected entity