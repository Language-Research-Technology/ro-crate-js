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
const path = require("path");
const assert = require("assert");
const {Utils} = require("../lib/utils");
const {ROCrate} = require("../lib/rocrate");

describe("JSON-LD utils", function () {
  it("Test basic indexing", function (done) {
    const testItem = { "@type": "Person" }
    assert(!Utils.hasType(testItem, "Dataset"), "No false positive");
    Utils.addType(testItem, "Dataset")
    assert(Utils.hasType(testItem, "Dataset"), "Has type Dataset");
    done();
  });
  it("can clone objects", function () {
    const o1 = {}, o2 = {};
    const a = [{a:1},{a:2}];
    const o = { "@type": "Person", name: 'test', nested: [{a:1},{a:2}] };
    const cloned = Utils.clone(o);
    assert.deepStrictEqual(o, cloned);
    o.name = 'abc';
    assert.strictEqual(cloned.name, 'test');
  });
  it("Can clone entities", function () {
    const json = JSON.parse(fs.readFileSync("test_data/f2f-ro-crate-metadata.json", 'utf8'));
    const rocrateOpts = { alwaysAsArray: true, resolveLinks: true };
    const crate = new ROCrate(json, rocrateOpts);
    const item = crate.getEntity('#165');
    const clonedItem = Utils.clone(item);
    assert.deepEqual(item, clonedItem);
  });
});



