#!/usr/bin/env node


const program = require('commander');
const fs = require('fs/promises');
const path = require('path');
const ROCrate = require("./lib/rocrate");
const Checker = require("./lib/checker");

var crateDir;

program
  .version("0.1.0")
  .description(
    "Runs a simple crate-checking process (not a full validation) "
  )
  .arguments("<dir>")
  .action((dir) => { crateDir = dir })


program.parse(process.argv);
const outPath = program.outputPath ? program.outputPath : crateDir;


async function main() {
  const crate = new ROCrate(JSON.parse(await fs.readFile(path.join(crateDir, "ro-crate-metadata.jsonld"), 'utf8')));
  const checker = new Checker(crate);
  console.log(await checker.validate());
}

main();

