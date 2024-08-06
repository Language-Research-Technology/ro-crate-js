# Research Object Crate (RO-Crate) JavaScript Library

This is a JavaScript library to create and manipulate [Research Object Crate](https://www.researchobject.org/ro-crate/).


## Install

Install the library:

    npm install ro-crate

**Note**: The minimum Node.js version is 16.11.0.

## Docs & Other Resources

- [**API documentation**](https://language-research-technology.github.io/ro-crate-js/)
- [**ROCrate documentation and specification**](https://www.researchobject.org/ro-crate/)
- [**Validate Crates**](validation) NEW!!! -- there is a new (2023-09) Validator class in development, we have a rudimentary command line interface to this -- documentation for how to include this as a library will follow soon.

## Usage

Import the `ROCrate` class and create a new empty crate with default configurations:

```js
const {ROCrate} = require('ro-crate');
const crate = new ROCrate();
```

The `ROCrate` constructor accepts two optional arguments:

```js
const fs = require('fs');

// load existing metadata
const data = JSON.parse(fs.readFileSync('ro-crate-metadata.json', 'utf8'));

// create a crate using the existing data and
// configure the crate to return a property of an Entity as an array and resolve linked entity as nested object
const crate = new ROCrate(data, { array: true, link: true });
```

To add an Entity to the crate:

```js
// A license
const license = {
    '@id': 'https://creativecommons.org/licenses/by/4.0/',
    '@type': 'CreativeWork',
    'description': 'Attribution 4.0 International (CC BY 4.0) ...',
    'name': 'CC BY 4.0'
};
// add the license as an unconnected Entity
crate.addEntity(license);

// add the license to the root dataset
crate.rootDataset.license = {'@id': license['@id']};
// or alternatively, add a new entity directly into a property of other entity :
crate.rootDataset.license = license;
```

Use an entity just like a normal object:

```js
let lic = create.getEntity(license['@id']);
console.log(lic.name); // prints 'CC BY 4.0';
// set a property directly
lic.name = 'CC BY 4.0 dummy';
// or with the setProperty method
crate.setProperty(license['@id'], 'name', 'CC BY 4.0 dummy');

console.log(lic.name); // prints 'CC BY 4.0 dummy';
```

Modifying an array of values in the property is not supported yet:

```js
lic.test = [1,2,3];
lic.test.push(4); // this does not work
console.log(lic.test); // prints '[1,2,3]';
// use this instead
lic.test = lic.test.concat(4);
// or this
crate.addValues(license['@id'], 'test', 4);
```

Root Dataset is a special entity that is mandated by the standard:

```js
const rootDataset = crate.rootDataset;
rootDataset.name = 'Tutorial Crate';
rootDataset.description = 'This is an example crate for educational purposes.'
const today = new Date().toISOString().split('T')[0]
rootDataset.datePublished = today;
```

The value of the returned property can be set to be always as an array:

```js
const crate1 = new ROCrate();
const crate2 = new ROCrate({array: true});
crate1.rootDataset.name = 'Tutorial Crate';
crate1.rootDataset.test = ['test1', 'test2'];
crate2.rootDataset.name = 'Tutorial Crate';
crate2.rootDataset.test = ['test1', 'test2'];
console.log(crate1.rootDataset.name); // return 'Tutorial Crate'
console.log(crate1.rootDataset.name); // return ['test1', 'test2']
console.log(crate2.rootDataset.name); // return ['Tutorial Crate']
console.log(crate2.rootDataset.name); // return ['test1', 'test2']
```

Linked entities can be automatically resolved as nested objects:

```js
const crate1 = new ROCrate();
const crate2 = new ROCrate({link: true});
const crate3 = new ROCrate({link: true, array: true});
crate1.rootDataset.license = license;
crate2.rootDataset.license = license;
crate3.rootDataset.license = license;
console.log(crate1.rootDataset.license.name); // return undefined
console.log(crate1.rootDataset.license); // return {'@id': 'https://creativecommons.org/licenses/by/4.0/'}
console.log(crate2.rootDataset.license.name); // return 'CC BY 4.0'
console.log(crate3.rootDataset.license.name); // return undefined, property license is a array
console.log(crate3.rootDataset.license[0].name); // return 'CC BY 4.0'
```

To save the rocrate data to a file, use `JSON.stringify`:

```js
// Write pretty-printed JSONLD into the directory
fs.writeFileSync('ro-crate-metadata.json', JSON.stringify(crate, null, 2));
```
For more usage examples, see the test files under the [test directory](test).

For more details, refer to the full [API documentation](https://arkisto-platform.github.io/ro-crate-js/).   


## HTML Rendering

Use the [RO-Crate-HTML](https://www.npmjs.com/package/ro-crate-html-js) to generate a HTML preview from the RO-Crate Metadata File `ro-crate-metadata.json`.

## Simple crate checker

There is a script included with this library that can check crates.

Check a crate:

`roccheck /path/to/crate/directory`

This is produce a simple report.

