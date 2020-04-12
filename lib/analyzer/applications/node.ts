import * as lockFileParser from 'snyk-nodejs-lockfile-parser';

import * as types from '../../types';

export interface NodeScanResult extends types.ScanResult {
  type: string;
  version: string;
  data: any; // type to whatever the parser returns?
}

// here we need something to specify the scanner type and version
// for example node:0.0.1
// will be used by our backend to understand how to read the specific scan result

export function nodeLockFilesToData(filePathToContent: {
  [filePath: string]: string;
}): NodeScanResult[] {

  let bogusResult: NodeScanResult = {
    type:'node',
    version:'0.0.1',
    data: undefined,
  };

  // for each file
  // check if yarn or npm
  // attach package.json to yarn.lock or package-lock.file
  // skip if we can't match package.json to lock file

  // ASSUMPTION: package.json and package-lock.json (or yarn.lock)
  // will always be in the same directory. otherwise, ignore them.

  // TODO what about dev dependencies?

  //lockFileParser.buildDepTree

  return [bogusResult];
}
