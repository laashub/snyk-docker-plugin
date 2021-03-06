import { getPackages } from "@snyk/rpm-parser";
import * as Debug from "debug";
import { getContentAsBuffer } from "../../extractor";
import { ExtractAction, ExtractedLayers } from "../../extractor/types";
import { streamToBuffer } from "../../stream-utils";

const debug = Debug("snyk");

export const getRpmDbFileContentAction: ExtractAction = {
  actionName: "rpm-db",
  filePathMatches: (filePath) => filePath === "/var/lib/rpm/Packages",
  callback: streamToBuffer,
};

export async function getRpmDbFileContent(
  extractedLayers: ExtractedLayers,
): Promise<string> {
  const rpmDb = getContentAsBuffer(extractedLayers, getRpmDbFileContentAction);
  if (!rpmDb) {
    return "";
  }

  try {
    const parserResponse = await getPackages(rpmDb);
    if (parserResponse.error !== undefined) {
      throw parserResponse.error;
    }
    return parserResponse.response;
  } catch (error) {
    debug("An error occurred while analysing RPM packages");
    debug(error);
    return "";
  }
}
