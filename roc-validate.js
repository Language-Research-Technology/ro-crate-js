#!/usr/bin/env node


const program = require('commander');
const fs = require('fs/promises');
const path = require('path');
const {ROCrate} = require("./lib/rocrate");
const {Validator} = require("./lib/validator");

var crateDir;

program
  .version("0.1.0")
  .description(
    "Runs a minimal RO-Crate validation"
  )
  .arguments("<dir>")
  .action((dir) => { crateDir = dir })



program.parse(process.argv);
const outPath = program.outputPath ? program.outputPath : crateDir;



async function main() {
  const rawJson = await fs.readFile(path.join(crateDir, "ro-crate-metadata.json"), 'utf8');
  
  const validator = new Validator(rawJson);
  await validator.validate()

  const files = await fs.readdir(crateDir, {recursive: true})
  const filesObj = Object.fromEntries(files.map(value => [value, {exists: true, inCrate: false}]))
  console.log(filesObj)

  validator.checkFiles(filesObj);
  console.log(console.log(validator.result.warnings));

  var csvString = "file,exists,inCrate\n"
  for (let key of Object.keys(filesObj)) {
    csvString += `"${key.replace(/([,"])/g, "$1$1")}",${filesObj[key].exists},${filesObj[key].inCrate}\n`
  }
  fs.writeFile("file-summary.csv", csvString)
  
}

main();

