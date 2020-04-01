import * as crypto from "crypto";
import { eventLoopSpinner } from "event-loop-spinner";
import * as minimatch from "minimatch";
import * as fspath from "path";
import * as path from "path";
import * as lsu from "./ls-utils";
import { HASH_ALGORITHM_SHA1 } from "./stream-utils";
import * as subProcess from "./sub-process";
import { BinaryFileData } from "./types";

export { Docker, DockerOptions, Globs, FindGlobsResult };

interface DockerOptions {
  host?: string;
  tlsVerify?: string;
  tlsCert?: string;
  tlsCaCert?: string;
  tlsKey?: string;
}

interface Globs {
  manifestGlobs: string[];
  binaryGlobs: string[];
}

interface FindGlobsResult {
  manifestFiles: string[];
  binaryFiles: string[];
}

const SystemDirectories = ["dev", "proc", "sys"];

class Docker {
  public static run(args: string[], options?: DockerOptions) {
    return subProcess.execute("docker", [
      ...Docker.createOptionsList(options),
      ...args,
    ]);
  }

  private static createOptionsList(options: any) {
    const opts: string[] = [];
    if (!options) {
      return opts;
    }
    if (options.host) {
      opts.push(`--host=${options.host}`);
    }
    if (options.tlscert) {
      opts.push(`--tlscert=${options.tlscert}`);
    }
    if (options.tlscacert) {
      opts.push(`--tlscacert=${options.tlscacert}`);
    }
    if (options.tlskey) {
      opts.push(`--tlskey=${options.tlskey}`);
    }
    if (options.tlsverify) {
      opts.push(`--tlsverify=${options.tlsverify}`);
    }
    return opts;
  }

  private optionsList: string[];

  constructor(private targetImage: string, options?: DockerOptions) {
    this.optionsList = Docker.createOptionsList(options);
  }

  /**
   * Runs the command, catching any expected errors and returning them as normal
   * stderr/stdout result.
   */
  public async runSafe(
    cmd: string,
    args: string[] = [],
    // no error is thrown if any of listed errors is found in stderr
    ignoreErrors: string[] = ["No such file", "file not found"],
  ) {
    try {
      return await this.run(cmd, args);
    } catch (error) {
      const stderr: string = error.stderr;
      if (typeof stderr === "string") {
        if (ignoreErrors.some((errMsg) => stderr.indexOf(errMsg) >= 0)) {
          return { stdout: error.stdout, stderr };
        }
      }
      throw error;
    }
  }

  public run(cmd: string, args: string[] = []) {
    return subProcess.execute("docker", [
      ...this.optionsList,
      "run",
      "--rm",
      "--entrypoint",
      '""',
      "--network",
      "none",
      this.targetImage,
      cmd,
      ...args,
    ]);
  }

  public runAsStream(
    cmd: string,
    args: string[] = [],
    cb: subProcess.ExecuteAsStreamCallback,
  ): Promise<any> {
    return subProcess.executeAsStream("docker", cb, [
      ...this.optionsList,
      "run",
      "--rm",
      "--entrypoint",
      '""',
      "--network",
      "none",
      this.targetImage,
      cmd,
      ...args,
    ]);
  }

  public async pull(targetImage: string) {
    return subProcess.execute("docker", ["pull", targetImage]);
  }

  public async save(targetImage: string, destination: string) {
    return subProcess.execute("docker", [
      "save",
      targetImage,
      "-o",
      destination,
    ]);
  }

  public async inspectImage(targetImage: string) {
    return subProcess.execute("docker", [
      ...this.optionsList,
      "inspect",
      targetImage,
    ]);
  }

  public async catSafe(filename: string) {
    return this.runSafe("cat", [filename]);
  }

  public async catBinarySafe(
    filename: string,
    cb: subProcess.ExecuteAsStreamCallback,
  ): Promise<any> {
    return this.runAsStream("cat", [filename], cb);
  }

  public async lsSafe(path: string, recursive?: boolean) {
    let params = "-1ap";
    if (recursive) {
      params += "R";
    }

    const ignoreErrors = [
      "No such file",
      "file not found",
      "Permission denied",
    ];

    return this.runSafe("ls", [params, path], ignoreErrors);
  }

  /**
   * Find files on a docker image according to a given list of glob expressions.
   */
  public async findGlobs(
    globs: Globs,
    exclusionGlobs: string[] = [],
    path: string = "/",
    recursive: boolean = true,
    excludeRootDirectories: string[] = SystemDirectories,
  ): Promise<FindGlobsResult> {
    let root: lsu.DiscoveredDirectory;

    const result: FindGlobsResult = {
      manifestFiles: [],
      binaryFiles: [],
    };

    if (recursive && path === "/") {
      // When scanning from the root of a docker image we need to
      // exclude system files e.g. /proc, /sys, etc. to make the
      // operation less expensive.

      const outputRoot = await this.lsSafe("/", false);
      root = lsu.parseLsOutput(outputRoot.stdout);

      for (const subdir of root.subDirs) {
        if (excludeRootDirectories.includes(subdir.name)) {
          continue;
        }

        const subdirOutput = await this.lsSafe("/" + subdir.name, true);
        const subdirRecursive = lsu.parseLsOutput(subdirOutput.stdout);

        await lsu.iterateFiles(subdirRecursive, (f) => {
          f.path = "/" + subdir.name + f.path;
        });

        subdir.subDirs = subdirRecursive.subDirs;
        subdir.files = subdirRecursive.files;
      }
    } else {
      const output = await this.lsSafe(path, recursive);

      if (eventLoopSpinner.isStarving()) {
        await eventLoopSpinner.spin();
      }

      root = lsu.parseLsOutput(output.stdout);
    }

    await lsu.iterateFiles(root, (f) => {
      const filePath = fspath.join(f.path, f.name);
      let exclude = false;
      for (const g of exclusionGlobs) {
        if (!exclude && minimatch(filePath, g)) {
          exclude = true;
        }
      }

      if (exclude) {
        return;
      }

      if (this.checkMatch(filePath, globs.manifestGlobs)) {
        result.manifestFiles.push(filePath);
        return;
      }

      if (this.checkMatch(filePath, globs.binaryGlobs)) {
        result.binaryFiles.push(filePath);
        return;
      }
    });

    return result;
  }

  public async calcHashOfBinaryFiles(
    files: string[],
    options: any,
  ): Promise<BinaryFileData[]> {
    const resultArr: BinaryFileData[] = [];

    const hashType =
      options && options.hashType ? options.hashType : HASH_ALGORITHM_SHA1;

    for (const file of files) {
      const hash: crypto.Hash = crypto.createHash(hashType);

      await this.catBinarySafe(file, (sd) => {
        const { data, err, exitCode } = sd;

        if (data && !err) {
          hash.update(data);
        }

        if (exitCode === 0) {
          resultArr.push({
            name: path.basename(file),
            path: path.dirname(file),
            hashType,
            hash: hash.digest("hex"),
          });
        }
      });
    }

    return resultArr;
  }

  private checkMatch(filePath: string, globsArr: string[]) {
    if (!filePath) {
      return false;
    }

    if (!globsArr) {
      return false;
    }

    for (const g of globsArr) {
      if (minimatch(filePath, g)) {
        return true;
      }
    }

    return false;
  }
}
