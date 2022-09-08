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
const defaults = require("../lib/defaults");
const jsonUtils = require("../lib/utils");
const uuid = require('uuid').v4;

const PERSONID = '#person___VICFP_18551934_14_8';
const NCONVICTIONS = 58;
const COURTS = [
	"#place_MELBOURNE PETTY SESSIONS",
	"#place_CARLTON PETTY SESSIONS",
	"#place_NORTH MELBOURNE PETTY SESSIONS",
	"#place_COBURG PRISON POLICE MAGISTRATE",
	"#place_UNKNOWN",
	"#place_FITZROY PETTY SESSIONS",
	"#place_CALRTON PETTY SESSIONS",
	"#place_SOUTH MELBOURNE PETTY SESSIONS",
	"#place_RICHMOND PETTY SESSIONS"
];

const COUNT_FORS = 3;
const COUNT_SEOS = 2;
const COUNT_INCLUDERS = 2;

describe("Resolving linked items with multiple values", function() {

	it("can resolve multiple links two hops from an item", async function () {
		const json = JSON.parse(fs.readFileSync("test_data/ro-crate-metadata-resolve.json", 'utf-8'));
		const crate = new ROCrate(json);
		crate.index();
		crate.addBackLinks();
		const root = crate.getRootDataset();

		const pItem = crate.getItem(PERSONID);
		expect(pItem).to.not.be.empty;

		const sentences = crate.resolve(pItem, [ { property: "conviction"} ]);

		expect(sentences).to.not.be.empty;
		expect(sentences.length).to.equal(NCONVICTIONS);

		const conv_locations = crate.resolve(pItem, [ { property: "conviction" }, { property: "location"} ]);

		expect(conv_locations).to.not.be.empty;	
		expect(conv_locations.length).to.equal(COURTS.length);

		// all of the location ids from the convictions are in the location list

		const loc_ids = conv_locations.map((l) => l['@id']);
		for( let s of sentences ) {
			expect(loc_ids).to.include(s['location']['@id']);
		}
	});


	it("can resolve multiple reverse links", async function () {
		const json = JSON.parse(fs.readFileSync("test_data/ro-crate-metadata-resolve.json", 'utf-8'));
		const crate = new ROCrate(json);
		crate.index();
		crate.addBackLinks();
		const root = crate.getRootDataset();

		const pItem = crate.getItem(PERSONID);
		expect(pItem).to.not.be.empty;

		const convictions = crate.resolve(pItem, [ { property: "conviction" }]);
		const convictions_r = crate.resolve(pItem, [ { property: "object", "@reverse": true }]);

		expect(convictions_r).to.not.be.empty;
		expect(convictions_r.length).to.equal(NCONVICTIONS);
		expect(convictions_r.length).to.equal(convictions.length);

		const locations_r = crate.resolve(pItem, [
			{ property: "object", "@reverse": true },
			{ property: "location"}
		]);

		expect(locations_r).to.not.be.empty;	
		expect(locations_r.length).to.equal(COURTS.length);

		// all of the location ids from the convictions are in the reverse 
		// location list

		const loc_ids = locations_r.map((l) => l['@id']);
		for( let c of convictions ) {
			expect(loc_ids).to.include(c['location']['@id']);
		}

	});


});


describe("Conditional resolution with include", function() {

	it("can resolve items of a particular type, via include", async function () {
		const json = JSON.parse(fs.readFileSync("test_data/ro-crate-metadata-conditional.jsonld", 'utf-8'));
		const crate = new ROCrate(json);
		crate.index();

		const root = crate.getRootDataset();

		const includers = crate.resolve(root, [ {
			property: "hasPart",
			includes: { "@type": "ImageObject" }
		}]);

		expect(includers).to.not.be.empty;
		expect(includers.length).to.equal(COUNT_INCLUDERS);

		for( let i of includers ) {
			expect(i['@type']).to.equal('ImageObject');
		}

	});

});




describe("Conditional resolution with matchFn", function() {

	it("can resolve items which match a regexp", async function () {
		const json = JSON.parse(fs.readFileSync("test_data/ro-crate-metadata-conditional.jsonld", 'utf-8'));
		const crate = new ROCrate(json);
		crate.index();

		const root = crate.getRootDataset();

		const for_codes = crate.resolve(root, [ {
			property: "about",
			matchFn: (item) => item['@id'].match(/anzsrc-for/)
		}]);

		const seo_codes = crate.resolve(root, [ {
			property: "about",
			matchFn: (item) => item['@id'].match(/anzsrc-seo/)
		}]);

		expect(for_codes).to.not.be.empty;
		expect(for_codes.length).to.equal(COUNT_FORS);

		expect(seo_codes).to.not.be.empty;
		expect(seo_codes.length).to.equal(COUNT_SEOS);


	});

});



describe("Collect items when resolving links", function() {

	it("generates a subgraph of all items traversed when resolving", async function () {
		const json = JSON.parse(fs.readFileSync("test_data/ro-crate-metadata-resolve.json", 'utf-8'));
		const crate = new ROCrate(json);
		crate.index();
		crate.addBackLinks();
		const root = crate.getRootDataset();

		const pItem = crate.getItem(PERSONID);
		expect(pItem).to.not.be.empty;

		const convictions = crate.resolve(pItem, [ { property: "conviction" }] );
		const courts = crate.resolve(pItem, [ { property: "conviction"}, { property: "location" }]);

		const [ items, subgraph ] = crate.resolveAll(pItem, [ { property: "conviction" }, { property: "location"} ]);

		expect(subgraph).to.not.be.empty;

		expect(items).to.not.be.empty;

		// the subgraph should contain all of the convictions it traversed,
		// and all of the locations, and nothing else

		const c_ids = convictions.map((i) => i['@id']);
		const cl_ids = courts.map((i) => i['@id']);

		const sg_ids = subgraph.map((i) => i['@id']).sort();

		const expect_ids = _.concat(c_ids, cl_ids).sort();
		
		expect(sg_ids).to.deep.equal(expect_ids);

	});

	it("collates and deduplicates subgraphs", async function () {

		// the metaphor here is bad, or belongs to some alien plant where
		// multiple branches can share a leaf? But that's the point so
		// that we can use dedupeSubgraph to merge them

		const N_TRUNKS = 5;
		const N_BRANCHES = 40;
		const N_LEAVES = 30;
		const leaves = [];
		const branches = [];

		const crate = new ROCrate({
			'@context': defaults.context,
			'@graph': [
				defaults.metadataFileDescriptorTemplate,
				{
					'@id': './',
					'@type': 'Dataset',
					'name': 'Root',
					'description': 'Root element',
					'hasPart': '#trunk'
				}
			]
		});

		crate.index();


		for( let i = 0; i < N_LEAVES; i++ ) {
			const leaf = {
				'@id': `#leaf${i}`,
				'@type': 'Dataset',
				'name': `Leaf ${i}`,
				'description': 'A leaf'
			}
			leaves.push(leaf);
			crate.addItem(leaf);
		}

		for( let i = 0 ; i < N_BRANCHES; i++ ) {
			const leaf_ids = _.sampleSize(leaves, 5).map((i) => { return { "@id": i["@id"] } });
			const branch = {
				'@id': `#branch${i}`,
				'@type': 'Dataset',
				'name': `Branch ${i}`,
				'description': 'A branch',
				'leaves': leaf_ids
			}
			branches.push(branch);
			crate.addItem(branch);
		}

		for( let i = 0; i < N_TRUNKS; i++ ) {
			const branch_ids = _.sampleSize(branches, 5).map((i) => { return { "@id": i["@id"] } });
			crate.addItem({
				'@id': `#trunk${i}`,
				'@type': 'Dataset',
				'name': `Trunk ${i}`,
				'description': 'A trunk',
				'branches': branch_ids 
			});
		}

		// create a subgraph for each pair (a, b) of trunks, merge them,
		// and check that everything in a/b is in the subgraph, and that
		// the subgraph has no duplicates

		for( let a = 0; a < N_TRUNKS - 1; a++ ) {
			for( let b = a; b < N_TRUNKS; b++ ) {
				const trunk_a = crate.getItem(`#trunk${a}`);
				const trunk_b = crate.getItem(`#trunk${b}`);
				expect(trunk_a).to.not.be.undefined;
				expect(trunk_b).to.not.be.undefined;
				const [items_a, subgraph_a] = crate.resolveAll(trunk_a, [ { property: 'branches' }, { property: 'leaves'}]);
				const [items_b, subgraph_b] = crate.resolveAll(trunk_b, [ { property: 'branches' }, { property: 'leaves'}]);
				expect(subgraph_a).to.not.be.null;
				expect(subgraph_b).to.not.be.null;
				
				const merged = crate.dedupeSubgraphs([ subgraph_a, subgraph_b ]);

				const unique_ids = {};

				for( let sg of [ subgraph_a, subgraph_b ] ) {
					for( let item of sg ) {
						if(! unique_ids[item['@id']] ) {
							unique_ids[item['@id']] = 1;
						}
					}
				}

				// is every descendent of trunk a and trunk b in the subgraph?

				for( let t of [ trunk_a, trunk_b ] ) {
					for( let b of t.branches ) {
						const branch = crate.getItem(b['@id']);
						expect(branch).to.not.be.null;
						expect(unique_ids).to.have.property(b['@id']);
						for( let l of branch.leaves ) {
							const leaf = crate.getItem(l['@id']);
							expect(leaf).to.not.be.null;
							expect(unique_ids).to.have.property(l['@id']);
						}
					}
				}

				// are any ids duplicated in the merged subgraph?

				const dd_merge = _.uniqBy(merged, (i) => i['@id']);
				expect(dd_merge.length).to.equal(merged.length);
			}
		}


	});





});







