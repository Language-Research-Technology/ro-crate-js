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
const assert = require("assert");
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


describe("Simple tests", function () {
  var test_path;

  it("Test basic setup", function (done) {
    // No Dataset
    const dudCrate = newCrate();
    try {
      dudCrate.index();
    } catch (e) {
      assert.strictEqual(e.message, 'There is no root dataset');
    }
    const crate = new ROCrate();
    crate.index();
    const rootDataset = crate.getRootDataset();
    assert(utils.hasType(rootDataset, "Dataset"));
    assert.equal(crate.utils.asArray(crate.getJson()["@context"])[0], "https://w3id.org/ro/crate/1.1/context", "Has standard context (defined in ./lib/defaults.js)")

    done();
  });
});

describe("Context", function () {
  it("can read context", async function () {
    this.timeout(5000);
    // No Dataset
    const crate = new ROCrate();
    crate.index();
    await crate.resolveContext();
    assert.equal(crate.resolveTerm("name"), "http://schema.org/name")
    assert.equal(crate.resolveTerm("@vocab"), "http://schema.org/")

    crate.addContext({ "new_term": "http://example.com/new_term" });
    assert.equal(crate.resolveTerm("new_term"), "http://example.com/new_term")
  });

  it("can return locally defined properties and classes", async function () {
    this.timeout(5000);
    const j = fs.readFileSync("test_data/heurist_crate/ro-crate-metadata.json", 'utf8');
    const crate = new ROCrate(JSON.parse(j));
    crate.index();

    await crate.resolveContext();
    assert.equal(crate.getDefinition("name")["@id"], "http://schema.org/name")
    assert.equal(crate.getDefinition("Death")["rdfs:label"], "Death")
    crate.getJson()["@context"][1]["new_term"] = "http://example.com/new_term"
    await crate.resolveContext();
    assert.equal(crate.getDefinition("new_term")["@id"], "http://example.com/new_term")
    crate.addItem({ "@id": "http://example.com/new_term", "sameAs": { "@id": "http://schema.org/name" } })
    assert.equal(crate.getDefinition("new_term")["@id"], "http://schema.org/name")
  });
});


// Schema.org no longer supports content negotiation

/* describe("schema.org Context", function() {
  it("Can undersdand indirection", async function () {
  this.timeout(15000); 
  // No Dataset
  const crate = new ROCrate();
  crate.index();
  crate.__json_ld["@context"] = "http://schema.org/"
  await crate.resolveContext();
  assert.equal(crate.resolveTerm("name"), "http://schema.org/name")
  assert.equal(crate.resolveTerm("@vocab"), "http://schema.org/")
  });
}); */

describe("Basic graph item operations", function () {
  const graph = [
    defaults.metadataFileDescriptorTemplate,
    defaults.datasetTemplate,
    { '@id': 'https://foo/bar/oid1', 'name': 'oid1', 'description': 'Test item 1' },
    { '@id': 'https://foo/bar/oid2', 'name': 'oid2', 'description': 'Test item 2' }
  ];

  it("can fetch items by id", function () {
    const crate = newCrate(_.clone(graph));
    crate.index();
    const item = crate.getItem('https://foo/bar/oid1');
    expect(item).to.have.property('@id', 'https://foo/bar/oid1');

  });

  it("can add an item", function () {
    const crate = newCrate(_.clone(graph));
    crate.index();

    const result = crate.addItem({
      '@id': 'https://foo/bar/oid3', 'name': 'oid3', 'description': 'Test item 3'
    });
    expect(result).to.be.true;
    const item = crate.getItem('https://foo/bar/oid3');
    expect(item).to.have.property('@id', 'https://foo/bar/oid3');


  });

  it("can't add an item with an already existing id", function () {
    const crate = newCrate(_.clone(graph));
    crate.index();

    const result = crate.addItem({
      '@id': 'https://foo/bar/oid1', 'name': 'oid1', 'description': 'Duplicate ID'
    });
    expect(result).to.be.false;


  });

});

describe("IDs and identifiers", function () {

  it("can generate unique ids", function () {
    const crate = newCrate();
    crate.index();
    const N = 20;

    _.times(N, () => {
      const id = crate.uniqueId('_:a');
      const success = crate.addItem({ '@id': id });
      expect(success).to.be.true;
    });

    expect(crate.getGraph()).to.have.lengthOf(N + 2) //+1 Cos of root metdata file descriptor;
  });

  it("Can resolve stuff", async function () {
    const json = JSON.parse(fs.readFileSync("test_data/sample-ro-crate-metadata.json", 'utf8'));
    const crate = new ROCrate(json);
    crate.index();
    crate.addBackLinks();
    const root = crate.getRootDataset();
    const results = crate.resolve(root, [{ "property": "author" }]);
    expect(results[0].name).to.equal("Peter Sefton");
    const actions = crate.resolve(root, [{ "property": "author" }, { "@reverse": true, "property": "agent" }]);
    expect(actions.length).to.equal(2);
    expect(actions[0].name).to.equal("Took dog picture");

    const newAction = {
      "@id": "#1",
      "@type": "UpdateAction",
      "agent": { '@id': 'http://orcid.org/0000-0002-3545-944X' }
    }
    crate.addItem(newAction);
    crate.addBackLinks();

    const upActions = crate.resolve(root, [
      { "property": "author" },
      { "@reverse": true, "property": "agent", "includes": { "@type": "UpdateAction" } }
    ]);
    expect(upActions.length).to.equal(1);


  }

  );

  it("Can resolve stuff after it's turned into a graph with .toGraph()", async function () {
    const json = JSON.parse(fs.readFileSync("test_data/sample-ro-crate-metadata.json", 'utf8'));
    const crate = new ROCrate(json);
    crate.toGraph();
    const root = crate.getRootDataset();
    const results = crate.resolve(root, [{ "property": "author" }]);
    expect(results[0].name[0]).to.equal("Peter Sefton");
    const actions = crate.resolve(root, [{ "property": "author" }, { "@reverse": true, "property": "agent" }]);
    expect(actions.length).to.equal(2);
    expect(actions[0].name[0]).to.equal("Took dog picture");

    const newAction = {
      "@id": "#1",
      "@type": "UpdateAction",
      "agent": { '@id': 'http://orcid.org/0000-0002-3545-944X' }
    }
    crate.addItem(newAction);
    crate.addBackLinks(); // This won't do anything as we're in graph mode but leaving it in to show that nothing breaks
    const upActions = crate.resolve(root, [
      { "property": "author" },
      { "@reverse": true, "property": "agent", "includes": { "@type": "UpdateAction" } }
    ]);
    expect(upActions.length).to.equal(1);


  }

  );

  it("Can create a JSON-serializable tree object (for indexing and display)", async function () {
    const json = JSON.parse(fs.readFileSync("test_data/sample-ro-crate-metadata.json", 'utf8'));
    const crate = new ROCrate(json);
    crate.toGraph();
    const root = crate.getRootDataset();
    const newItem = crate.getNormalizedTree(root, 2);
    //console.log(JSON.stringify(newItem, null, 2));
    expect(newItem.author[0].name[0]["@value"]).to.equal("Peter Sefton")

  }

  );

  it("Can create a JSON-serializable tree object of a non root @id = './'  (for indexing and display)", async function () {
    const json = JSON.parse(fs.readFileSync("test_data/ro-crate-metadata.json", 'utf8'));
    const rocrateOpts = { alwaysAsArray: true, resolveLinks: true };
    const crate = new ROCrate(json, rocrateOpts);
    const root = crate.getRootDataset();
    const newItem = crate.getNormalizedTree(root, 2);
    //console.log(JSON.stringify(newItem, null, 2));
    expect(newItem.name[0]["@value"]).to.equal("Benefits Spinner Availability Mips");
  });

  it("Can create JSON-serializable tree objects from scratch (for indexing and display)", async function () {
    const crate = new ROCrate();
    crate.toGraph();
    const root = crate.getRootDataset();
    crate.pushValue(root, "name", 'This is my name')
    const newItem = crate.getNormalizedTree(root, 1);
    //console.log(JSON.stringify(newItem, null, 2));
    expect(newItem.name[0]["@value"]).to.equal("This is my name")

  }

  );

  it("can cope with legacy datasets", function () {
    const roCrateMetadataID = "ro-crate-metadata.json";
    const json_ld = {
      "@context": defaults.context,
      "@graph": [
        {
          "@type": "Dataset",
          "@id": "./",
        },
        {
          "@type": "CreativeWork",
          "@id": roCrateMetadataID,
          "identifier": roCrateMetadataID,
          "about": { "@id": "./" }
        }
      ]
    }
    const crate = newCrate();
    crate.index();
    expect(crate.getRootId()).to.equal("./");
  });

  it("can add an identifier to the root dataset", function () {
    const crate = newCrate();
    //crate.index();
    const myId = uuid();
    const idCreated = crate.addIdentifier({
      'identifier': myId,
      "name": "local-id"
    });
    expect(idCreated).to.not.be.false;
    const idItem = crate.getItem(idCreated);
    expect(idItem).to.not.be.undefined;
    expect(idItem).to.have.property("value", myId);
    const rootDataset = crate.getRootDataset();
    expect(rootDataset).to.have.property("identifier");
    const rid = rootDataset['identifier'];
    console.log(rid);
    expect(crate.getNamedIdentifier("local-id")).to.equal(myId);
    assert.equal(rid['@id'], idCreated);
    // expect(rid).to.be.an('array').and.to.not.be.empty;
    // const match = rid.filter((i) => i['@id'] === idCreated);
    // expect(match).to.be.an('array').and.to.have.lengthOf(1);
    // expect(crate.getNamedIdentifier("local-id")).to.equal(myId);
  });


  it("can add an identifier when the existing identifier is a scalar", function () {
    const crate = newCrate();
    crate.index();
    const root = crate.getRootDataset();
    root['identifier'] = 'a_scalar_identifier';
    const myId = uuid();
    const idCreated = crate.addIdentifier({
      'identifier': myId,
      "name": "local-id"
    });
    expect(idCreated).to.not.be.false;
    const idItem = crate.getItem(idCreated);
    expect(idItem).to.not.be.undefined;
    expect(idItem).to.have.property("value", myId);
    const rootDataset = crate.getRootDataset();
    expect(rootDataset).to.have.property("identifier");
    const rid = rootDataset['identifier'];
    expect(rid).to.be.an('array').and.to.not.be.empty;
  });

  it("can read an identifier from the root dataset", function () {
    const crate = newCrate();
    crate.index();
    const myId = uuid();
    const namespace = "local-id";
    const idCreated = crate.addIdentifier({
      'identifier': myId,
      "name": namespace
    });

    const jsonld = crate.getJson();

    const crate2 = new ROCrate(jsonld);

    crate2.index();
    const myId2 = crate2.getNamedIdentifier(namespace);
    expect(myId2).to.equal(myId);
  });





  it("can turn a crate into an actual linked (maybe circular javascript object) ", async function () {
    const json = JSON.parse(fs.readFileSync("test_data/sample-ro-crate-metadata.json", 'utf8'));
    const crate = new ROCrate(json);
    crate.toGraph();
    const lens = crate.getItem("Panny20mm");

    assert.equal(lens.name, "Lumix G 20/F1.7 lens");
    crate.changeGraphId(lens, "#Panny20mm");
    assert.equal(lens["@id"], "#Panny20mm");

    const action = crate.getItem("Photo1");
    assert.equal(action.instrument[1]["@id"], "#Panny20mm")
    assert.equal(lens["@reverse"].instrument[0].name[0], action.name[0])

    const newItem = { "@id": "#ABetterLens", "@type": "IndividualProduct", "name": "super lens" }
    crate.addItem(newItem);
    const getNewItemBack = crate.getItem("#ABetterLens");

    const newItem1 = { "@id": "#BestLens", "@type": "IndividualProduct", "name": "bestest lens" }

    const getNewItem1Back = crate.getItem("#BestLens");
    // Did not add newItem1 to the crate
    assert.equal(getNewItemBack.name, "super lens");

    assert.equal(getNewItem1Back, undefined);

    crate.pushValue(action, "instrument", newItem);
    crate.pushValue(action, "instrument", newItem1);

    const numOfInstruments = action.instrument.length;
    crate.pushValue(action, "instrument", newItem1);
    // Check that it does not let you add the same item twice 
    assert.equal(numOfInstruments, action.instrument.length);
    // But it will allow a duplicate with the Allowduplicates flag 
    crate.pushValue(action, "instrument", newItem1, true);
    assert.equal(numOfInstruments + 1, action.instrument.length);


    assert.equal(crate.getItem("#BestLens").name, "bestest lens");

    assert.equal(action.instrument[2].name, "super lens");
    assert.equal(action.instrument[3].name, "bestest lens");

    //fs.writeFileSync("test.json", JSON.stringify(crate.getJson(), null, 2));

    const newCrate = new ROCrate(crate.getJson());
    newCrate.toGraph();
    const newRoot = newCrate.getRootDataset();
    assert.equal(newRoot.name, 'Sample dataset for RO-Crate v0.2');
    const getNewItem1BackAgain = crate.getItem("#BestLens");
    assert.equal(getNewItem1BackAgain.name, "bestest lens");

    //console.log(action.instrument);



    //console.log(crate.objectified);	
  });



  it("can find things of interest and put em in a table", async function () {
    const json = JSON.parse(fs.readFileSync("test_data/f2f-ro-crate-metadata.json", 'utf8'));
    const crate = new ROCrate(json);
    crate.toGraph();
    const newItem = crate.getItem("#interview-#427");

    //console.log(newItem.name)

    assert(Array.isArray(newItem.name));
    //consol.og(crate.flatify(newItem, 2));
    //console.log(crate.objectified);	
  });

  it("can rename IDs", async function (done) {
    const json = JSON.parse(fs.readFileSync("test_data/f2f-ro-crate-metadata.json", 'utf8'));
    const crate = new ROCrate(json);
    crate.toGraph();

    const newItem = crate.getItem("#interview-#429");
    const fileItem = crate.getItem("files/429/original_301212cc7bd4fa7dd92c08f24f210069.csv")
    assert.equal(newItem.hasFile[5]["@id"], "files/429/original_301212cc7bd4fa7dd92c08f24f210069.csv")
    crate.changeGraphId(fileItem, "new-file-id.csv");
    assert.equal(newItem.hasFile[5]["@id"], "new-file-id.csv")
    //console.log(fileItem);

    //consol.og(crate.flatify(newItem, 2));
    //console.log(crate.objectified);	
    done();
  });



  it("can turn a flattened graph into a nested object", async function () {
    const json = JSON.parse(fs.readFileSync("test_data/sample-ro-crate-metadata.json", 'utf8'));
    const crate = new ROCrate(json);
    const root = crate.objectify();
    assert(Array.isArray(root.name))
    assert.equal(root.name.length, 1)
    //console.log(crate.objectified);

  });


  it("it doesn't die if you feed it circular references", async function () {
    const json = JSON.parse(fs.readFileSync("test_data/sample-ro-crate-metadata.json", 'utf8'));
    const crate = new ROCrate(json);
    crate.index();
    const root = crate.getRootDataset();
    const author = crate.getItem(root.author["@id"]);
    author.partOf = [{ "@id": "./" }];
    const root2 = crate.objectify();
    //console.log(JSON.stringify(crate.objectified,null,2));
    assert.equal(root2.author[0].name[0], "Peter Sefton")
  });



  it("it can add nested objects", async function () {
    const crate = new ROCrate();
    crate.toGraph();
    const root = crate.getRootDataset();
    crate.pushValue(root, "author",
      { "@id": "#pt", "name": "Petie", "affiliation": { "@id": "#home", "name": "home" } })
    assert.equal(crate.getItem("#pt").name, "Petie");
    assert.equal(crate.getItem("#pt").affiliation[0].name, "home");

  });

  it("Test a normal root with depth 0", function (done) {
    const json = JSON.parse(fs.readFileSync("test_data/arcp---name,farms-to-freeways-corpus-root.json", 'utf8'));
    const rocrateOpts = { alwaysAsArray: true, resolveLinks: true };
    const crate = new ROCrate(json, rocrateOpts);
    assert.equal(crate.rootId, "arcp://name,farms-to-freeways/corpus/root");
    const root = crate.getRootDataset();
    const normalRoot = crate.getNormalizedTree(root, 0);
    assert.equal(normalRoot.identifier[1]['@id'], '_:local-id:ATAP:arcp://name,farms-to-freeways/corpus/root', 'normal root 2 depth');
    done();
  });

	it("Test nullify a property", function (done) {
		const json = JSON.parse(fs.readFileSync("test_data/arcp---name,farms-to-freeways-corpus-root.json"));
		const rocrateOpts = {alwaysAsArray: true, resolveLinks: true};
		const crate = new ROCrate(json, rocrateOpts);
		assert.equal(crate.rootId, "arcp://name,farms-to-freeways/corpus/root");
		const rootDataset = JSON.parse(JSON.stringify(crate.rootDataset));
		rootDataset.license = null;
		assert.equal(rootDataset.license, null);
		done();
	});
});


