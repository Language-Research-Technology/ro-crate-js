# Validation tools

RO-Crate-js has a basic RO-Crate validation tool as part of the library. RO-Crate is a very relaxed and permissive specification| so there are only a few requirements that count as validation errors - though the validator will also issue some warnings and some summary information.

## Install

To use validation from the command line.

-  Clone this repository
-  Install: `npm install .`
-  Enable the scripts: `npm link .`

## Usage

To see the usage info:

```
>> rocval --help
Usage: rocval [options] <dir>

Runs a minimal RO-Crate validation

Options:
  -V, --version           output the version number
  -f, --files <csv-path>  Path to a csv file into which the tool will write a summary of which files are in the crate directory and mentioned in the crate.
  -h, --help              output usage information


```

To get a summary CSV of which data entites are included or not included in the RO-Crate directory, type:

```
rocval -f file-summary.csv path/to/crate/
```

The CSV file has three columns.

1. `file`:  is a path relative to the RO-Crate Root
2. `exists`: is a boolean with value `true` if the path exists on the file system and `false` if it does not
3. `inCrate`: is a boolean with value `true` if the path is the `@id` of and RO-Crate Data Entity and `false` if it is not. 

The following example shows the three possible combinations of these. 

The first is a directory that is on the file system but is not mentioned in the crate as a `Dataset` the second is a file which is present in the crate but not described. Neither of these is an error but this report might be of use in analysing crates -- maybe you do want to describe the `.sql` files in a crate or the directory they are in but forgot. 

The fourth line shows a file which IS included as a Data Entity in the crate but is not included in the crate directory. In most cases this would be considered an error.

| file | exists | inCrate |
| ---  | ---- | --- |
|.DS_Store | true | false |
sql|true|false
sql/XYZ.sql|true|false
objects/thumbs/3453.jpg|true|true
objects/thumbs/G899/56h.png|false|true





