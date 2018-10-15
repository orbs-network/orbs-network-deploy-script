import * as _ from "lodash";
import * as nconf from "nconf";
import { config, getBaseConfig, execute } from "./deploy";
import { readFileSync } from "fs";

const parse = require("csv-parse/lib/sync");

function parseCredentials(path: string): any {
  try {
    const csv = parse(readFileSync(path).toString(), { columns: true })[0];

    const credentials = {
      accessKeyId: csv["Access key ID"],
      secretAccessKey: csv["Secret access key"]
    };

    return credentials;
  }
  catch (e) {
    console.warn(`WARNING: Could not find credentials, proceeding without them`);
  }
}

async function main() {
  const credentialsPath = config.get("aws-credentials-path");
  const credentials = parseCredentials(credentialsPath);

  if (credentialsPath && config.get("aws-credentials-export")) {
    console.log(`export AWS_ACCESS_KEY_ID=${credentials.accessKeyId} AWS_SECRET_ACCESS_KEY=${credentials.secretAccessKey}`);
    process.exit();
  }

  const accountId = process.env.AWS_ACCOUNT_ID || credentialsPath.match(/_(\d+)_/)[1];
  const bucketName = process.env.S3_BUCKET_NAME || `orbs-network-${accountId}-config`;

  const regions = config.get("region").split(",");

  const pathToKeys = nconf.get("keys") ? nconf.get("keys") : `${__dirname}/../testnet/keys.json`;
  const keys = _.pick(JSON.parse(readFileSync(pathToKeys).toString()), ...regions);

  const peers = _.map(regions, (r) => `${r}.global.nodes.staging.orbs-test.com`);

  for (const region of regions) {
    const baseConfig = getBaseConfig();

    // TODO: fix staging
    const publicKey = keys[region][0];
    const secretKey = keys[region][1];
    const peerKeys = _.map(keys, (v, k) => v[0]);
    const leader = peerKeys[0];

    const regionalConfig = _.extend({}, baseConfig, {
      credentials,
      accountId,
      region,
      bucketName,
      publicKey,
      secretKey,
      peerKeys,
      peers,
      leader
    });

    await execute(regionalConfig);
  }
}

main();
