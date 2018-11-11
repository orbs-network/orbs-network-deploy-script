import * as _ from "lodash";
import * as nconf from "nconf";
import { config, getBaseConfig, execute, getDockerImageName, getDockerImageTag } from "./deploy";
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "fs";
import { join } from "path";

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

function getStreletsTemplates(): any {
  return {
    keys: {
      template: _.template(readFileSync("./strelets/keys.template.json").toString()),
      path: "keys.json"
    },
    network: {
      template: JSON.stringify,
      path: "network.json"
    },
    vchain: {
      template: _.template(readFileSync("./strelets/vchain.template.json").toString()),
      path: "chain.json"
    }
  };
}

function copyDir(source: string, target: string) {
  console.log(`Copying from ${source} to ${target}`);

  _.map(readdirSync(source), (f) => {
    const contents = readFileSync(join(source, f)).toString();
    writeFileSync(join(target, f), contents);
  });
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

  const step = config.get("step") || 2;
  const batchedRegionsList = _.chunk(regions, step);

  for (const batch of batchedRegionsList) {
    try {
      await Promise.all(batch.map((region: string) => {
        const baseConfig = getBaseConfig();

        // TODO: fix staging
        const publicKey = keys[region][0];
        const secretKey = keys[region][1];
        const peerKeys = _.map(keys, (v, k) => v[0]);
        const leader = peerKeys[0];
        const waitUntilSync = leader == publicKey;

        const bootstrap = mkdtempSync(`/tmp/bootstrap-${region}-`);
        copyDir(baseConfig.bootstrap, bootstrap);

        const regionalConfig = _.extend({}, baseConfig, {
          credentials,
          accountId,
          region,
          bucketName,
          publicKey,
          secretKey,
          peerKeys,
          peers,
          leader,
          bootstrap,
          waitUntilSync,
        });

        const templates = getStreletsTemplates();

        writeFileSync(join(bootstrap, templates.keys.path), templates.keys.template({
          publicKey,
          secretKey,
          leader
        }));

        writeFileSync(join(bootstrap, templates.vchain.path), templates.vchain.template({
          dockerImage: getDockerImageName(regionalConfig),
          dockerTag: getDockerImageTag(regionalConfig)
        }));

        writeFileSync(join(bootstrap, templates.network.path), templates.network.template(_.map(peers, (ip, idx) => {
          return {
            Key: peerKeys[idx],
            IP: ip
          };
        })));

        return execute(regionalConfig);
      }));
    } catch (e) {
      console.error(e);
    }
  }
}

main();
