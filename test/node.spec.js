"use strict";
const {Node, Handler} = require("../lib/node");
const assert = require("assert");
const util = require('util');
const {Utils} = require('../lib/utils');

function createEntity(data, owner) {
  var n = new Node({'@id':data['@id'], '@reverse':{}});
  for (const k in data) {
    n[k] = Utils.clone(data[k]);
  }
  var p = Proxy.revocable(n, new Handler(owner));
  return p.proxy;
}

describe("Entity wrapper", function () {
  let entities = {
    "#1": {
      "@id": "#1",
      "@type": "Dataset",
      "name": "d1",
      "description": "abc",
      "nested": { "@id": "#2" }
    },
    "#2": {
      "@id": "#2",
      "name": "d2",
      "nested": { "@id": "#3" }
    }
  };
  let g = {
    config: { resolveLinks: false, alwaysAsArray: false },
    getEntity: function (id) {
      let e = entities[id];
      if (e) return createEntity(e, g);
    },
    getProperty: function (entity, prop) {
      let vals = Utils.asArray(entity[prop]).map(v => (v?.['@id'] && this.config.resolveLinks) ? this.getEntity(v["@id"]) || v : v);
      return (vals.length > 1 || this.config.alwaysAsArray) ? vals : vals[0];
    },
    setProperty: function (entity, prop, value) {
      if (prop === '@id') {
        delete entities[entity['@id']];
        entity['@id'] = value;
        entities[value] = entity;
      } else {
        let values = Utils.asArray(value);
        for (let i = 0; i < values.length; ++i) {
          let v = values[i];
          if (v != null && v['@id'] && Object.keys(v).length > 1) {
            entities[v['@id']] = v;
            values[i] = { "@id": v['@id'] };
          }
        }
        entity[prop] = (values.length === 1) ? values[0] : values;
      }
    }
  };

  it("can get any valid property value from underlying entity", function () {
    let d = entities['#1'];
    let e = createEntity(d, g);
    assert.strictEqual(e.name, d.name);
    assert.strictEqual(e.description, d.description);
    assert.equal(e.test, null);
  });

  it("can return nested object", function () {
    g.config.resolveLinks = true;
    let e1 = g.getEntity('#1');
    assert.strictEqual(e1.name, entities['#1'].name);
    assert.strictEqual(e1.nested.name, entities['#2'].name);
    // id does not exist, return as it is
    assert.deepStrictEqual(e1.nested.nested, entities['#2'].nested);
    assert.strictEqual(e1.nested.nested['@id'], '#3');
  });

  it("can return value as array", function () {
    g.config.alwaysAsArray = true;
    let e1 = g.getEntity('#1');
    // no array for @id
    assert.strictEqual(e1['@id'], '#1');
    assert.strictEqual(e1.name[0], entities['#1'].name);
    assert.strictEqual(e1.nested[0].name[0], entities['#2'].name);
    // id does not exist, return as it is
    assert.deepStrictEqual(e1.nested[0].nested[0], entities['#2'].nested);
    assert.strictEqual(e1.nested[0].nested[0]['@id'], '#3');
  });

  it("can set property value", function () {
    let d = entities['#1'];
    g.config.alwaysAsArray = false;
    let e = createEntity(d, g);
    // primitive value
    e.abstract = "abstract 1";
    //assert.strictEqual(e.abstract, d.abstract);
    assert.strictEqual(e.abstract, "abstract 1");
    // complex value
    let d3 = { '@id': '#3', name: 'd3' };
    e.author = d3;
    assert.strictEqual(e.author.name, d3.name);
    assert.strictEqual(entities['#3'], d3);
    e.owner = { '@id': '#3' };
    assert.strictEqual(e.owner.name, d3.name);
  });

  it("can change the id", function () {
    let d4 = { '@id': '#4', name: 'd4' };
    entities[d4['@id']] = d4;
    let e = createEntity(d4, g);
    assert.strictEqual(entities['#4']['@id'], '#4');
    e['@id'] = "#4a";
    assert.equal(entities['#4'], null);
    assert.strictEqual(entities['#4a']['@id'], '#4a');
  });

  it("can check the type", function () {
    let d = entities['#1'];
    let e = createEntity(d, g);
    assert.ok(e.$$hasType("Dataset"));
  });

  it("can detect override of internal methods", function () {
    let d = entities['#1'];
    let e = createEntity(d, g);
    assert.throws(() => { e.toJSON = false });
    //assert.ok(e.$$hasType("Dataset"));
  });

  it("can return data as flat jsonld object", function () {
    let d = entities['#1'];
    let e = createEntity(d, g);
    //console.log(util.inspect(e, {showProxy: true}));
    assert.deepStrictEqual(e.toJSON(), d);
  });

  it("can return right content when used in JSON.stringify", function () {
    let d = { '@id': '#test-stringify', name: 'test stringify', count: 1, test: [1, 2, 3] };
    let e = createEntity(d, g);
    assert.strictEqual(JSON.stringify(e), JSON.stringify(d));
  });

  it("can enumerate properties", function () {
    let d = entities['#1'];
    let e = createEntity(d, g);
    var keys = Object.keys(d);
    keys.push('num');
    e.num = 1;
    let keys2 = [];
    for (const k in e) keys2.push(k);
    assert.deepStrictEqual(keys, keys2);
    assert.deepStrictEqual(keys, Object.keys(e));
  });

  it("can handle 'in' operator", function () {
    let d = entities['#1'];
    let e = createEntity(d, g);
    assert.ok('@id' in e);
    assert.ok('name' in e);
    assert.ok(!('test' in e));
  });

});
