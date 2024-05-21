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
//const expect = require("chai").expect;
const { ROCrate } = require("../lib/rocrate");
const { Utils } = require("../lib/utils");
const defaults = require("../lib/defaults");
const uuid = require('uuid').v4;


function newCrate(graph) {
  if (!graph) { graph = [defaults.datasetTemplate, defaults.metadataFileDescriptorTemplate]; };
  return new ROCrate({ '@context': defaults.context, '@graph': graph });
}

//const testData = JSON.parse(fs.readFileSync('test_data/simple-test.json', 'utf8'));
const testData = require('../test_data/simple-test.json');
var crateOptions = { array: true, link: true };

describe("ROCrate Create new graph", function () {
  it("can create a new empty graph using defaults", function () {
    let crate = new ROCrate();
    let raw = crate.toJSON();
    assert.ok(Utils.asArray(raw['@context']).includes('https://w3id.org/ro/crate/1.1/context'));
    //assert.strictEqual(raw["@graph"]);
    //assert.deepStrictEqual(crate.json_ld['@graph'], [defaults.datasetTemplate,defaults.metadataFileDescriptorTemplate]);
  });

  it("can create a new graph using existing jsonld", function () {
    let crate = new ROCrate(testData);
    assert.strictEqual(crate.graphSize, 9);
    //assert.deepStrictEqual(crate.json_ld, json);
    // test with data in which the rooId is not "./"
    var testData2 = JSON.parse(fs.readFileSync('test_data/ro-crate-metadata.json', 'utf8'));
    crate = new ROCrate(testData2, { array: true, link: true });
    assert.strictEqual(crate.rootId, testData2["@graph"][1].about["@id"]);
    assert.strictEqual(crate.rootDataset?.name[0], testData2["@graph"][0].name);
  });
});

describe("hasEntity", function () {
  it("can find existing entity", function () {
    let crate = new ROCrate(testData);
    let e = crate.hasEntity('https://orcid.org/0000');
    assert.ok(e);
    e = crate.hasEntity('https://orcid.org/non-existant');
    assert.ok(!e);
  });
});

describe("getEntity", function () {
  it("can get a raw entity", function () {
    let crate = new ROCrate(testData);
    let e = crate.getEntity('https://orcid.org/0000');
    assert.ok(e);
    assert.strictEqual(e.name, "John Doe");
    assert.ok(crate.hasType(e, "Person"));
    assert.strictEqual(e.contactPoint['@id'], "john.doe@uq.edu.au");
    assert.strictEqual(Object.keys(e.contactPoint).length, 1);
  });
  it("can get a linked entity", function () {
    let crate = new ROCrate(testData, { link: true });
    let e = crate.getEntity('https://orcid.org/0000');
    assert.ok(e);
    assert.strictEqual(e.contactPoint.email, "john.doe@uq.edu.au");
    assert.strictEqual(e.contactPoint.contactType, "support");
    assert.strictEqual(e.contactPoint.availableLanguage[0].name, "English");
  });
  it("can always get property value as array", function () {
    let crate = new ROCrate(testData, { link: true, array: true });
    let e = crate.getEntity('https://orcid.org/0000');
    assert.strictEqual(e?.name[0], "John Doe");
  });
  it("can handle non existant id", function () {
    let crate = new ROCrate();
    assert(!crate.getEntity('abc'));
    assert(!crate.getEntity(''));
    // @ts-ignore
    assert(!crate.getEntity());
    // @ts-ignore
    assert(!crate.getEntity(null));
  });
});

describe("entities", function () {
  it("can iterate all entities", function () {
    let crate = new ROCrate();
    for (const e of crate.entities()) {
      assert.equal(e, crate.getEntity(e['@id']));
    }
    let iter = crate.entities();
    let e = iter.next().value;
    assert.equal(e, crate.getEntity(e['@id']));
    e = iter.next().value;
    assert.equal(e, crate.getEntity(e['@id']));
  });
  it("can iterate filtered entities", function () {
    let crate = new ROCrate();
    let result = Array.from(crate.entities({ filter: { '@type': /^Dataset$/ } }));
    assert.equal(result.length, 1);
    assert.equal(result[0], crate.rootDataset);
  });
});

describe("getGraph", function () {
  it("can return an array of entities", function () {
    let crate = new ROCrate(crateOptions);
    let graph = crate.getGraph();
    assert.equal(graph.length, 2);
    let e = graph.find(e => e['@id'] === 'ro-crate-metadata.json');
    assert.equal(e.about[0]['@id'], './');
    assert.equal(e.about[0]['@type'][0], 'Dataset');
    e.test = 'test';
    assert.equal(e.test[0], crate.getEntity(e['@id'])?.test[0]);
  });
  it("can return an array of copy of entities data", function () {
    let crate = new ROCrate(crateOptions);
    let graph = crate.getGraph(true);
    let e = graph[0];
    e.test = 'test';
    assert(!crate.getProperty(e['@id'], 'test'));
  });
});


describe("addEntity", function () {
  it("can add empty entity", function () {
    let crate = new ROCrate();
    crate.addEntity({ '@id': 'abc' });
    let e = crate.getEntity('abc');
    assert(e);
    assert.strictEqual(Object.keys(e.toJSON()).length, 2);
  });
  it("can replace existing entity with empty entity", function () {
    let crate = new ROCrate();
    crate.addEntity({ '@id': 'abc', name: 'abc' });
    let e = crate.getEntity('abc');
    assert(e);
    assert.strictEqual(e.name, 'abc');
    crate.addEntity({ '@id': 'abc' }, { replace: true });
    assert(!e.name);
  });
  it("can set default @type", function () {
    let crate = new ROCrate(crateOptions);
    crate.addEntity({ '@id': 'test1' });
    let e = crate.getEntity('test1');
    assert(e);
    assert.strictEqual(e['@type'][0], 'Thing');
    crate.addEntity({ '@id': 'test2', '@type': 'Person' });
    e = crate.getEntity('test2');
    assert.strictEqual(e?.['@type'][0], 'Person');
  });
});

describe("deleteEntity", function () {
  let id = 'https://orcid.org/0000';
  it("can delete existing entity", function () {
    let crate = new ROCrate(testData);
    let root = crate.rootDataset;
    let data = crate.getEntity(id)?.toJSON();
    crate.deleteEntity(id);
    assert.ok(!crate.getEntity(id));
    assert.ok(root);
    assert.equal(root.author['@id'], id);
    crate.addEntity(data);
    assert.equal(crate.getEntity(id)?.["@reverse"].author['@id'], root["@id"]);
  });
  it("can delete existing entity and its references", function () {
    let crate = new ROCrate(testData);
    crate.deleteEntity(id, { references: true });
    assert.ok(!crate.getEntity(id));
    assert.ok(crate.rootDataset);
    assert.ok(!crate.rootDataset.author);
  });
});

describe("updateEntity", function () {
  it("can correctly update existing entity", function () {
    let crate = new ROCrate(testData);
    let e0 = { '@id': 'https://orcid.org/0000', name: 'test0' };
    let e1 = { '@id': 'https://orcid.org/0001', name: 'test1' };
    assert.equal(crate.getEntity(e0['@id'])?.name, "John Doe");
    crate.updateEntity(e0);
    //console.log(crate.getEntity(e0['@id'])?.toJSON());
    assert.equal(crate.getEntity(e0['@id'])?.name, e0.name);
    crate.updateEntity(e1);
    assert.ok(!crate.getEntity(e1['@id']));
  });

  it("can update nested entity", function () {
    let crate = new ROCrate(testData);
    let e = {
      '@id': 'https://orcid.org/0000', name: 'test0', contactPoint: {
        '@id': 'john.doe@uq.edu.au', contactType: 'general'
      }
    };
    crate.updateEntity(e, { merge: true });
    assert.strictEqual(crate.getEntity('https://orcid.org/0000')?.name, 'test0');
    assert.strictEqual(crate.getEntity('john.doe@uq.edu.au')?.contactType, 'support');
    crate.updateEntity(e, { merge: true, recurse: true });
    assert.strictEqual(crate.getEntity('john.doe@uq.edu.au')?.contactType, 'general');
  });
});


describe("Mutators", function () {

  it("can rename IDs", function () {
    let crate = new ROCrate(testData);

    const parent = crate.getEntity("https://orcid.org/0000");
    const child = crate.getEntity("john.doe@uq.edu.au");
    assert.ok(parent);
    assert.ok(child);
    assert.equal(child['@id'], "john.doe@uq.edu.au");
    assert.equal(child['@id'], parent.contactPoint['@id']);
    crate.updateEntityId(child, "jane.doe@uq.edu.au");
    assert(!crate.getEntity('john.doe@uq.edu.au'));
    assert.equal(child['@id'], "jane.doe@uq.edu.au");
    assert.equal(child['@id'], parent.contactPoint['@id']);
  });

  it("can rename root ID", function () {
    let crate = new ROCrate(testData);
    //let crate = new ROCrate(testData, { resolveLinks: true, alwaysAsArray: true });
    assert.ok(crate);
    assert.equal(crate.rootId, "./");
    crate.updateEntityId(crate.rootId, "#root");
    assert.equal(crate.rootId, "#root");
    assert.equal(crate.rootDataset['@id'], "#root");
    crate.rootId = "#root2";
    assert.equal(crate.rootId, "#root2");
    assert.equal(crate.rootDataset['@id'], "#root2");
    crate.rootDataset['@id'] = "#root3";
    assert.equal(crate.rootId, "#root3");
    assert.equal(crate.rootDataset['@id'], "#root3");
    assert.equal(crate.metadataFileEntity.about['@id'], "#root3");
  });

  it("can correctly assign existing entity", function () {
    let crate = new ROCrate(testData);
    crate.metadataFileEntity.about = crate.rootDataset;
    let data = crate.toJSON();
    assert.equal(Object.keys(data['@graph'][0].about).length, 1);
  });

  it("can correctly add Identifier", function () {
    let crate = new ROCrate(testData);
    let identifier = { name: "test", identifier: "undefined" };
    let entityId = `_:local-id:${identifier.name}:${identifier.identifier}`;
    crate.addIdentifier(identifier);
    assert.ok(crate.getEntity(entityId));
  });

});

describe("addValues", function () {

  it("cannot add @id", function () {
    let crate = new ROCrate(testData);
    crate.addValues("./", "@id", "test");
    assert.strictEqual(crate.getProperty("./", "@id"), "./");
  });

  it("can add values allowing duplicates", function () {
    let crate = new ROCrate(testData);
    let e = crate.getEntity('./');
    assert.strictEqual(e.author['@id'], "https://orcid.org/0000");
    crate.addValues(e, "author", { "@id": "https://orcid.org/0000" }, { duplicate: true });
    assert.strictEqual(e.author.length, 2);
    assert.strictEqual(e.author[0]['@id'], "https://orcid.org/0000");
    assert.strictEqual(e.author[1]['@id'], "https://orcid.org/0000");
    crate.addValues(e, "keywords", "Test", { duplicate: true });
    assert.strictEqual(e.keywords[1], "Test");
    crate.addValues(e, "keywords", ["Test"], { duplicate: true });
    crate.addValues(e, "keywords", ["Test", "Test"], { duplicate: true });
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

  it("can recursively update an existing entity or add a new entity given nested objects", function () {
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
    assert.equal(crate.graphSize, 9);
    assert.equal(crate.getEntity("#lang-en")?.name, "English"); // existing entity
    crate.addValues(root, "author", newAuthor);
    var pt = crate.getEntity("#pt");
    assert(pt);
    assert.equal(crate.graphSize, 14);
    assert.equal(crate.getEntity("#lang-en")?.name, "English"); // should be unchanged
    assert.equal(crate.getEntity("pete@uq.edu.au")?.availableLanguage[0], crate.getEntity("john.doe@uq.edu.au")?.availableLanguage[0]); //same ref object
    assert.equal(pt.name, "Petie");
    assert.equal(pt.affiliation[1]['@id'], "#home2");
    assert.equal(crate.getEntity("#home")?.name, "home");
    assert.equal(crate.getEntity("#home")?.['@type'], "Thing");
    assert.equal(crate.getEntity("#home2")?.name, "home2");
    assert.equal(crate.getEntity("#lang-fr")?.name, "French");
    //console.log(crate.getGraph(true)[12]);

    var author2 = {
      '@id': '#john',
      name: 'john',
      contactPoint: { '@id': 'pete@uq.edu.au' }
    };
    crate.addValues(root, 'author', author2);
    assert.equal(crate.getEntity('pete@uq.edu.au')?.email, newAuthor.contactPoint.email);
    crate.addValues(root, 'author2', author2);
    assert.equal(crate.getEntity('pete@uq.edu.au')?.email, newAuthor.contactPoint.email);
  });

  it("can handle blank node nested objects", function () {
    const crate = new ROCrate(testData, crateOptions);
    const root = crate.rootDataset;
    const newAuthor = {
      "name": "Petie",
      "contactPoint": {
        "email": "pete@uq.edu.au",
        "contactType": "Tech"
      }
    };
    var n = root.author.length;
    crate.addValues(root, "author", newAuthor);
    //must have id
    var id1 = root.author[n]['@id'];
    var id2 = root.author[n].contactPoint[0]['@id'];
    assert(id1);
    assert(id2);
    assert.equal(crate.getEntity(id1)?.name[0], newAuthor.name);
    assert.equal(crate.getEntity(id2)?.email[0], newAuthor.contactPoint.email);
  });

  it("can generate correct @reverse nodes", function () {
    const crate = new ROCrate(testData);
    const root = crate.rootDataset;
    const e1 = crate.getEntity("https://orcid.org/0000");
    console.log(e1['@reverse']);
    assert.equal(e1['@reverse'].author['@id'], "./");
    const e2 = crate.getEntity("#lang-es");
    assert.equal(e2['@reverse'].availableLanguage['@id'], "john.doe@uq.edu.au");
  });

  it("does not create an entity when adding references", function () {
    const crate = new ROCrate({ alwaysAsArray: true, resolveLinks: true });
    const root = crate.rootDataset;
    const schemaFile = {
      '@id': "schemaFileName",
      '@type': ['File'],
      'name': 'Frictionless Data Schema for CSV transcript files',
      'encodingFormat': 'application/json',
      'conformsTo': { "@id": "https://specs.frictionlessdata.io/table-schema/" }
    };
    let count = crate.graphSize;
    crate.addValues(crate.rootDataset, 'hasPart', schemaFile);
    assert(!crate.getEntity('https://specs.frictionlessdata.io/table-schema/'));
    assert.equal(crate.graphSize, count + 1);
  });
  it("can handle circular references in the input", function () {
    const crate = new ROCrate(testData, {link: true, array: true});
    const root = crate.rootDataset.toJSON();
    const file = {
      "@id": "BCNT_anon/elan/Bcnt_AEF_032_Camila.eaf",
      "speaker": "Camila",
      "@type": [
        "File",
        "Annotation"
      ],
      "partOf": root,
      "annotationOf": {
        "@id": "Bcnt_AEF_032_Camila.wav"
      },
      "encodingFormat": []
    };
    root.hasPart = [file];
    crate.addValues('./', 'hasPart', file);
  });

  //TODO: it can add an entity already exist in the values and update the nested data
});

describe("getProperty", function () {
  it("can update array", function () {
    let crate = new ROCrate(testData, { array: true });
    let root = crate.rootDataset;
    let keywords = root.keywords;
    assert.strictEqual(keywords[0], "Test");
    assert.strictEqual(keywords.length, 1);
    keywords.push('abc')
    assert.strictEqual(root.keywords[1], "abc");
    keywords[2] = 'def';
    assert.strictEqual(root.keywords[2], "def");
  });

});

describe("setProperty", function () {
  it("can not allow @reverse", function () {
    let crate = new ROCrate(testData);
    assert.throws(() => crate.setProperty("./", "@reverse", "test"));
  });
  it("can accept null or undefined", function () {
    let crate = new ROCrate(testData);
    crate.setProperty("./", "test", null);
    crate.setProperty("./", "test2", undefined);
    assert.strictEqual(crate.getProperty("./", "test"), undefined);
    assert.strictEqual(crate.getProperty("./", "test2"), undefined);
    crate.setProperty("./", "test", "test");
    crate.setProperty("./", "test2", "test2");
    assert.strictEqual(crate.getProperty("./", "test"), "test");
    assert.strictEqual(crate.getProperty("./", "test2"), "test2");
    crate.setProperty("./", "test", null);
    crate.setProperty("./", "test2", undefined);
    assert.strictEqual(crate.getProperty("./", "test"), undefined);
    assert.strictEqual(crate.getProperty("./", "test2"), undefined);
    assert.strictEqual(crate.getEntity("./").test, undefined);
    assert.strictEqual(crate.getEntity("./").test2, undefined);
    assert.strictEqual('test' in crate.getEntity("./").toJSON(), false);
    assert.strictEqual('test2' in crate.getEntity("./").toJSON(), false);
  });
  it("can accept empty string", function () {
    let crate = new ROCrate(testData);
    crate.setProperty("./", "test", "");
    assert.strictEqual(crate.getProperty("./", "test"), "");
    assert.strictEqual(crate.getEntity("./").test, "");
    assert.strictEqual(crate.getEntity("./").toJSON().test, "");
  });
  it("can accept a value or a list", function () {
    let crate = new ROCrate(testData);
    var r = crate.rootDataset;
    assert.ok(r);
    r.test = 'a';
    assert.strictEqual(r.test, 'a');
    r.test = 'b';
    assert.strictEqual(r.test, 'b');
    r.test = ['a'];
    assert.strictEqual(r.test[0], 'a');
    r.test = ['a', 'b'];
    assert.strictEqual(r.test[1], 'b');
    r.test = ['c', 'd'];
    assert.strictEqual(r.test[0], 'c');
    r.test = [];
    assert.strictEqual(r.test.length, 0);
    r.test = '';
    assert.strictEqual(r.test, '');
    // let v1 = { a: { aa: 1 }, b: { bb: 2 }, c: [1, 2] };
    // let v2 = { c: [1, 2, 3.4] };
    // r.test = [v1, v2];
    // assert.deepStrictEqual(r.test[0], v1);
    // assert.deepStrictEqual(r.test[1], v2);
    // v2.d = 1;
    // assert.equal(r.test[1].d, undefined);
  });
  it("can handle nested entities", function () {
    let crate = new ROCrate(testData, { array: true, link: true });
    var r = crate.rootDataset;
    assert.ok(r);
    r.test = { "@id": "https://orcid.org/0000" };
    assert.strictEqual(r.test[0].name[0], 'John Doe');
    r.test = [{ "@id": "https://orcid.org/0000" }, { "@id": "https://uq.edu.au/" }];
    assert.strictEqual(r.test[1].name[0], 'University of Queensland');
    r.test = [{ "@id": "https://uq.edu.au/" }];
    assert.strictEqual(r.test[0].name[0], 'University of Queensland');
    r.hasMember = [{ "@id": "one", "@Type": "File" }, { "@id": "two", "@Type": "File" }];
    assert.strictEqual(r.hasMember.length, 2);
    assert.strictEqual(r.hasMember[0]['@id'], 'one');
    assert(crate.getEntity('one'));
  });
  it("can modify array of values", function () {
    let crate = new ROCrate(testData, { array: true });
    var r = crate.rootDataset;
    r.license[1] = 'test licence';
    r.license.push('test licence 2');
    assert.strictEqual(r.license[1], 'test licence');
    assert.strictEqual(r.license[2], 'test licence 2');

  });
  it("can remove duplicates from the array", function () {
    let crate = new ROCrate(testData, { array: true });
    var r = crate.rootDataset;
    r.license = [{ '@id': 'http://creativecommons.org/licenses/by-sa/3.0/au' }, { '@id': 'http://creativecommons.org/licenses/by-sa/3.0/au' }];
    //console.log(r.license);
    assert.strictEqual(r.license.length, 1);
    //r.licence = 'test licence';
    //r.license = [ 'test licence', 'test licence 2', 'test licence 2' ];
    r.license = ['test licence', 'test licence 2', 'test licence'];
    //crate.setProperty(crate.rootId, 'license', ['test licence', 'test licence 2', 'test licence']);
    //crate.addValues(crate.rootId, "test", ['test licence', 'test licence 2', 'test licence']);
    assert.strictEqual(r.license.length, 2);
    r.license.push('test licence 2');
    assert.strictEqual(r.license.length, 2);

  });
  it("can replace existing entities", function () {
    let crate = new ROCrate(testData, { link: true, replace: true });
    let e = crate.getEntity('https://orcid.org/0000');
    assert.ok(e);
    assert.strictEqual(e.contactPoint.email, "john.doe@uq.edu.au");
    // ref only, don't replace 
    crate.rootDataset.author = { '@id': 'https://orcid.org/0000' }
    let auth = crate.getEntity('https://orcid.org/0000');
    assert.strictEqual(auth.name, "John Doe");
    assert.strictEqual(auth.contactPoint.email, "john.doe@uq.edu.au");
    // replace here
    crate.rootDataset.author = {
      '@id': 'https://orcid.org/0000',
      '@type': 'Person',
      name: 'Jane Doe'
    };
    auth = crate.getEntity('https://orcid.org/0000');
    assert.ok(!auth.contactPoint);
    assert.strictEqual(auth.name, "Jane Doe");

  });

});

describe("deleteProperty", function () {
  it("can not delete @id and @reverse property", function () {
    let crate = new ROCrate(testData);
    assert.throws(() => crate.deleteProperty("./", "@id"));
    assert.throws(() => crate.deleteProperty("./", "@reverse"));
  });
  it("can delete normal property", function () {
    let crate = new ROCrate(testData);
    assert.ok(crate.getProperty("./", "description"));
    crate.deleteProperty("./", "description");
    assert.strictEqual(crate.getProperty("./", "description"), undefined);
    assert.strictEqual(crate.getEntity("./").description, undefined);

  });
  it("can delete normal property of an entity", function () {
    let crate = new ROCrate(testData);
    let root = crate.rootDataset;
    assert.ok(root.description);
    delete root.description;
    assert.strictEqual(root.description, undefined);
    assert.strictEqual('description' in root, false);
  });
  it("can delete refs", function () {
    let crate = new ROCrate(testData);
    let root = crate.rootDataset;
    assert.ok(root);
    crate.addEntity({ '@id': '#e1', n: 1 });
    crate.addEntity({ '@id': '#e2', n: 2 });
    var e1 = crate.getEntity('#e1');
    var e2 = crate.getEntity('#e2');
    root.test1 = [{ '@id': '#e1' }];
    root.test2 = [{ '@id': '#e2' }];
    assert.strictEqual(e1?.['@reverse'].test1['@id'], './');
    assert.strictEqual(e2?.['@reverse'].test2['@id'], './');
    crate.deleteProperty(root, 'test1');
    assert.ok(!root.test1);
    assert.ok(!e1?.['@reverse'].test1);
    delete root.test2;
    assert.ok(!root.test2);
    assert.ok(!e2?.['@reverse'].test2);
  });
});

describe("deleteValues", function () {
  var crate = new ROCrate(), root;
  beforeEach(function () {
    crate = new ROCrate();
    root = crate.rootDataset;
    assert.ok(root);
  });
  it("can delete one value", function () {
    root.test = ['a', 'b', 'c'];
    crate.deleteValues(root, 'test', 'b');
    assert.deepStrictEqual(root.test, ['a', 'c']);
  });
  it("can delete some values", function () {
    root.test = ['a', 'b', 'c', 'd'];
    crate.deleteValues(root, 'test', ['b', 'c']);
    assert.deepStrictEqual(root.test, ['a', 'd']);
  });
  it("can delete all values", function () {
    root.test = ['a', 'b', 'c'];
    crate.deleteValues(root, 'test', ['a', 'b', 'c']);
    assert.ok(!root.test);
  });
  it("can delete refs", function () {
    crate.addEntity({ '@id': '#e1', n: 1 });
    crate.addEntity({ '@id': '#e2', n: 2 });
    var e1 = crate.getEntity('#e1');
    var e2 = crate.getEntity('#e2');
    root.test = [{ '@id': '#e1' }, { '@id': '#e2' }];
    assert.strictEqual(e1?.['@reverse'].test['@id'], './');
    crate.deleteValues(root, 'test', { '@id': '#e1' });
    assert.strictEqual(root.test['@id'], '#e2');
    //check @reverse when deleting a ref
    assert.ok(!e1?.['@reverse'].test);
    assert.ok(e2?.['@reverse'].test);
  });
});

describe("getContext", function () {
  it("can return locally defined properties and classes", function () {
    const crate = new ROCrate();
    console.log(crate.context);
    assert.ok(Utils.asArray(crate.context).indexOf(defaults.context[0]) >= 0);
    //assert.equal(crate.context?.name, "http://schema.org/name");
    assert.equal(crate.getDefinition('name')?.['@id'], 'http://schema.org/name');
  });
});

describe("addContext", function () {
  it("can add a new term to context", async function () {
    const crate = new ROCrate();
    await crate.resolveContext();
    crate.addContext({ "new_term": "http://example.com/new_term" });
    assert.equal(crate.getDefinition("new_term")?.['@id'], "http://example.com/new_term");
    assert.equal(crate.resolveTerm("new_term"), "http://example.com/new_term");
    //console.log(crate.getDefinition('new_term'));
    const newCrate = new ROCrate(crate.toJSON());
    assert.equal(newCrate.resolveTerm("new_term"), "http://example.com/new_term");
  });
  it('can add URL entry to context', function(){
    const crate = new ROCrate({array: true});
    let l = crate.context.length;
    crate.addContext('http://example.com/context');
    let c = crate.context;
    assert.equal(c.length, l + 1);
    assert.equal(c.pop(), 'http://example.com/context');
    l = crate.context.length;
    crate.addContext('http://example.com/context');
    assert.equal(crate.context.length, l);
  });
});
describe("addTermDefinition", function () {
  it("can add a new term to existing context", async function () {
    const crate = new ROCrate({array: true});
    await crate.resolveContext();
    assert.ok(!crate.getDefinition('Geometry'));
    crate.addTermDefinition('Geometry', 'http://www.opengis.net/ont/geosparql#Geometry');
    assert.ok(crate.getDefinition('Geometry'));

  });
});
describe("getTerm", function () {
  it("can get a term from default context", async function () {
    const crate = new ROCrate();
    await crate.resolveContext();
    assert.equal(crate.getTerm('http://schema.org/Place'), "Place");
  })
})
describe("resolveTerm", function () {
  const crate = new ROCrate();
  before(async function () {
    await crate.resolveContext();
  });
  it("can return already expanded term", function () {
    assert.equal(crate.resolveTerm("http://schema.org/name"), "http://schema.org/name");
    assert.equal(crate.resolveTerm("https://schema.org/name"), "https://schema.org/name");
  });
  it("can expand term", function () {
    assert.equal(crate.resolveTerm("name"), "http://schema.org/name");
    assert.equal(crate.resolveTerm("@vocab"), "http://schema.org/");
  });
  it("can expand term with prefix", function () {
    assert.equal(crate.resolveTerm("schema:name"), "http://schema.org/name");
    assert.equal(crate.resolveTerm("foaf:name"), "http://xmlns.com/foaf/0.1/name");
  });
  it("can expand simple term definition", function () {
    crate.addContext({ 'FPerson': 'foaf:Person' });
    assert.equal(crate.resolveTerm("FPerson"), "http://xmlns.com/foaf/0.1/Person");
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
  it("should ignore any id reference to a non-existant entity", async function () {
    let json = JSON.parse(fs.readFileSync('test_data/ro-crate-metadata.json', 'utf8'));
    const rocrateOpts = { array: true, link: true };
    const crate = new ROCrate(json, rocrateOpts);
    const root = crate.rootDataset;
    const newItem = crate.getTree({ root, depth: 2, allowCycle: true });
    //console.log(JSON.stringify(newItem, null, 2));
    assert.strictEqual(newItem.name[0]["@value"], json["@graph"][0].name);
  }
  );
});

describe("toJSON", function () {
  it("can return an array of plain flat entities", function () {
    let crate = new ROCrate(testData);
    const lang_fr = { '@id': '#lang-fr', "@type": "Language", name: "French" };
    crate.addValues("john.doe@uq.edu.au", "availableLanguage", lang_fr);
    let i = crate.indexOf("john.doe@uq.edu.au");
    let data = crate.toJSON();
    assert.equal(Object.keys(data['@graph'][0].about).length, 1);
    assert.equal(Object.keys(data['@graph'][i].availableLanguage[2]).length, 1);

    // test with resolveLinks enabled
    crate = new ROCrate(testData, { array: true, link: true });
    crate.addValues("john.doe@uq.edu.au", "availableLanguage", lang_fr);
    i = crate.indexOf("john.doe@uq.edu.au");
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


// test clean up @reverse property

// validate jsonld in constructor

// check for add, get, delete operations

// check assigning an array of plain objects or entity proxy objects to a property
// getnormalisedtree check circular

// get disconnected entity
