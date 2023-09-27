#!/usr/bin/env node

const program = require('commander');
const fs = require('fs/promises');
const path = require('path');
const { ROCrate } = require('./lib/rocrate');
const { Validator } = require('./lib/validator');

var crateDir;

program
  .version('0.1.0')
  .description('Runs a minimal RO-Crate validation')
  .option('-f, --files <csv-path>', 
      'Path to a csv file into which the tool will write a summary of which files are in the crate directory and mentioned in the crate.',
  )
  .arguments('<dir>')
  .action((dir) => {
    crateDir = dir;
  })

program.parse(process.argv);
const outPath = program.outputPath ? program.outputPath : crateDir;

async function main() {
  const rawJson = await fs.readFile(
    path.join(crateDir, 'ro-crate-metadata.json'),
    'utf8'
  );
  const validator = new Validator();
  validator.parseJSON(rawJson);
  await validator.validate();

  if (program.files) {
    const files = await fs.readdir(crateDir, { recursive: true });
    // Initialise a files object which has all the files found in the crate
    const filesObj = Object.fromEntries(
      files.map((value) => [value, { exists: true, inCrate: false }])
    );
    validator.checkFiles(filesObj);

    var csvString = 'file,exists,inCrate\n';
    for (let key of Object.keys(filesObj)) {
      csvString += `"${key.replace(/([,"])/g, '$1$1')}",${
        filesObj[key].exists
      },${filesObj[key].inCrate}\n`;
    }
    fs.writeFile(program.files, csvString);
  }
  console.log(validator.result)
}

main();
